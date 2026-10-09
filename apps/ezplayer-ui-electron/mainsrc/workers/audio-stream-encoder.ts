/**
 * Turns ring-buffer audio chunks into wire frames for browser listeners.
 *
 * Every chunk from the playback master is hop + ~10 ms raised-cosine crossfade
 * tail at the source sample rate (silence chunks are mono 48 kHz, no tail).
 * The encoder normalizes to stereo 48 kHz and runs ONE continuous opus
 * stream: it overlap-adds each chunk's ramped tail into the next chunk's
 * ramped head (exactly what the local speakers do when they play the chunks
 * overlapped), so the codec sees contiguous, un-ramped audio and never
 * restarts. A per-chunk encoder reset — the first version of this file — made
 * libopus redo its mode/bandwidth decisions every 100 ms: 10 dB down at
 * 14 kHz and ~1 dB of level wobble at chunk rate, which is what "dull treble
 * with warps and chirps" was.
 *
 * Wire frames carry whole 20 ms packets, so the stream is re-chunked through
 * a FIFO: each wire frame is EMIT_PACKETS packets (100 ms) with `playAt` of
 * its first input sample. Decoded output lags input by the codec lookahead,
 * sent as `preSkip` with FLAG_CONTINUOUS; the client schedules decoded audio
 * at `playAt - preSkip/48000`. The first frame after an encoder (re)start is
 * tagged FLAG_STREAM_START so the client can zero the startup transient.
 *
 * A timestamp discontinuity (seek, pump restart after idle) flushes the FIFO,
 * resets the codec and starts a new tagged stream. The stream also keeps
 * running through silence (a few bytes per packet) so song boundaries and
 * fades decode seamlessly.
 *
 * Opus is wasm (`opusscript`) so nothing native has to be packaged. If the
 * codec fails to initialize the encoder falls back to raw Float32 PCM chunks
 * (hop + tail, overlapped by the client), which every listener also accepts.
 */

import type { AudioChunkReadResult } from '@ezplayer/ezplayer-core';
import {
    AUDIO_WIRE_FLAG_CONTINUOUS,
    AUDIO_WIRE_FLAG_STREAM_START,
    AudioWireCodec,
    buildAudioWireFrame,
    joinOpusPackets,
} from '@ezplayer/ezplayer-core';
import OpusScript from 'opusscript';

export const OPUS_SAMPLE_RATE = 48000;
export const OPUS_CHANNELS = 2;
/** 20 ms at 48 kHz. */
export const OPUS_FRAME_SIZE = 960;
/** Packets per wire frame (100 ms). */
export const EMIT_PACKETS = 5;
const EMIT_FRAMES = OPUS_FRAME_SIZE * EMIT_PACKETS;
/** Chunks are stamped in whole ms; anything further off than this is a jump. */
const CONTIGUITY_TOLERANCE_MS = 1.5;

// libopus CTLs (opus_defines.h).
const OPUS_SET_VBR = 4006;
const OPUS_SET_BANDWIDTH = 4008;
const OPUS_SET_COMPLEXITY = 4010;
const OPUS_SET_SIGNAL = 4024;
const OPUS_RESET_STATE = 4028;
const OPUS_SIGNAL_MUSIC = 3002;
const OPUS_BANDWIDTH_FULLBAND = 1105;

export interface AudioStreamEncoderOptions {
    /** Target bitrate in bits/s. Default 128 kbps: measured transparent on
     *  real music (every octave band within 0.1 dB); still ~4% of raw PCM. */
    bitrate?: number;
    /** libopus complexity 0–10. Default 8. */
    complexity?: number;
    /** Force the PCM fallback (tests / diagnostics). */
    disableOpus?: boolean;
}

export class AudioStreamEncoder {
    private codec?: OpusScript;
    private codecFailed = false;
    private preSkip = 0;
    private readonly bitrate: number;
    private readonly complexity: number;
    private readonly disableOpus: boolean;

    // Continuous-stream state (opus path).
    private fifo = new Float32Array(EMIT_FRAMES * OPUS_CHANNELS * 3);
    private fifoFrames = 0;
    /** playAt (ms, player clock) of fifo frame 0. */
    private fifoStartPlayAt = 0;
    private fifoIncarnation = 0;
    private expectedNextPlayAt: number | undefined;
    /** Ramped-down tail of the previous chunk, awaiting the next chunk's head. */
    private pendingTail: Float32Array | undefined;
    private streamStart = true;
    private seq = 0;
    private pcm16 = new Int16Array(EMIT_FRAMES * OPUS_CHANNELS);

    constructor(opts: AudioStreamEncoderOptions = {}) {
        this.bitrate = opts.bitrate ?? 128_000;
        this.complexity = opts.complexity ?? 8;
        this.disableOpus = opts.disableOpus ?? false;
    }

    /** True once the opus codec is up (after the first push). */
    get usingOpus(): boolean {
        return !!this.codec;
    }

    /** Measured codec lookahead in frames (0 until the codec is up). */
    get lookaheadFrames(): number {
        return this.preSkip;
    }

    close(): void {
        try {
            this.codec?.delete();
        } catch {
            /* ignore */
        }
        this.codec = undefined;
    }

    /**
     * Feed one ring chunk; returns zero or more wire frames to send.
     * `serverNow` is the player's Date.now() at send time.
     */
    push(chunk: AudioChunkReadResult, serverNow: number): Uint8Array[] {
        const srcChannels = Math.max(1, chunk.channels);
        const srcFrames = Math.floor(chunk.samples.length / srcChannels);
        if (srcFrames <= 0) return [];
        const srcHop = Math.max(1, Math.min(srcFrames, Math.floor(chunk.advanceSamples / srcChannels) || srcFrames));
        const ratio = OPUS_SAMPLE_RATE / chunk.sampleRate;
        const frames = Math.max(1, Math.round(srcFrames * ratio));
        const hopFrames = Math.max(1, Math.min(frames, Math.round(srcHop * ratio)));
        const stereo = toStereo48k(chunk.samples, srcChannels, srcFrames, chunk.sampleRate, frames);

        if (!this.ensureCodec()) {
            return [this.pcmFrame(chunk, serverNow, stereo, frames, hopFrames)];
        }

        const out: Uint8Array[] = [];
        // Discontinuity: flush what we have as its own tail, then start a new stream.
        if (
            this.expectedNextPlayAt !== undefined &&
            Math.abs(chunk.playAtRealTime - this.expectedNextPlayAt) > CONTIGUITY_TOLERANCE_MS
        ) {
            out.push(...this.flush(serverNow));
            this.restartStream();
        }
        if (this.fifoFrames === 0) {
            this.fifoStartPlayAt = chunk.playAtRealTime;
            this.fifoIncarnation = chunk.incarnation;
        }

        // Undo the player's crossfade: previous tail (ramped down) + this head (ramped up).
        if (this.pendingTail) {
            const n = Math.min(this.pendingTail.length, hopFrames * OPUS_CHANNELS);
            for (let i = 0; i < n; i++) stereo[i] = stereo[i]! + this.pendingTail[i]!;
        }
        this.appendToFifo(stereo, hopFrames);
        this.pendingTail =
            frames > hopFrames ? stereo.slice(hopFrames * OPUS_CHANNELS, frames * OPUS_CHANNELS) : undefined;
        this.expectedNextPlayAt = chunk.playAtRealTime + (hopFrames * 1000) / OPUS_SAMPLE_RATE;

        while (this.fifoFrames >= EMIT_FRAMES) out.push(this.emit(serverNow, EMIT_PACKETS));
        return out;
    }

    /** Encode whatever is queued (zero-padded to whole packets) and reset the
     *  stream. Call when the pump stops so listeners get the last samples. */
    flush(serverNow: number): Uint8Array[] {
        if (!this.codec) return [];
        const out: Uint8Array[] = [];
        if (
            this.pendingTail &&
            this.fifoFrames + this.pendingTail.length / OPUS_CHANNELS <= this.fifo.length / OPUS_CHANNELS
        ) {
            // Let the final fade-out be heard.
            this.appendToFifo(this.pendingTail, this.pendingTail.length / OPUS_CHANNELS);
            this.pendingTail = undefined;
        }
        if (this.fifoFrames > 0) {
            const packets = Math.ceil(this.fifoFrames / OPUS_FRAME_SIZE);
            const need = packets * OPUS_FRAME_SIZE;
            this.fifo.fill(0, this.fifoFrames * OPUS_CHANNELS, need * OPUS_CHANNELS);
            this.fifoFrames = need;
            out.push(this.emit(serverNow, packets));
        }
        this.restartStream();
        return out;
    }

    private restartStream(): void {
        this.fifoFrames = 0;
        this.pendingTail = undefined;
        this.expectedNextPlayAt = undefined;
        this.streamStart = true;
        this.codec?.encoderCTL(OPUS_RESET_STATE, 0);
    }

    private appendToFifo(stereo: Float32Array, frames: number): void {
        const need = (this.fifoFrames + frames) * OPUS_CHANNELS;
        if (need > this.fifo.length) {
            const grown = new Float32Array(Math.max(need, this.fifo.length * 2));
            grown.set(this.fifo.subarray(0, this.fifoFrames * OPUS_CHANNELS));
            this.fifo = grown;
        }
        this.fifo.set(stereo.subarray(0, frames * OPUS_CHANNELS), this.fifoFrames * OPUS_CHANNELS);
        this.fifoFrames += frames;
    }

    /** Encode `packets` packets from the FIFO head into one wire frame. */
    private emit(serverNow: number, packets: number): Uint8Array {
        const codec = this.codec!;
        const frames = packets * OPUS_FRAME_SIZE;
        const samples = frames * OPUS_CHANNELS;
        if (this.pcm16.length < samples) this.pcm16 = new Int16Array(samples);
        const pcm16 = this.pcm16;
        for (let i = 0; i < samples; i++) {
            const v = this.fifo[i]!;
            pcm16[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : (v * 32767) | 0;
        }
        const pkts: Uint8Array[] = [];
        const frameBytes = OPUS_FRAME_SIZE * OPUS_CHANNELS * 2;
        for (let p = 0; p < packets; p++) {
            pkts.push(
                codec.encode(Buffer.from(pcm16.buffer, pcm16.byteOffset + p * frameBytes, frameBytes), OPUS_FRAME_SIZE),
            );
        }
        const frame = buildAudioWireFrame(
            {
                codec: AudioWireCodec.Opus,
                flags: AUDIO_WIRE_FLAG_CONTINUOUS | (this.streamStart ? AUDIO_WIRE_FLAG_STREAM_START : 0),
                serverNow,
                playAt: this.fifoStartPlayAt,
                incarnation: this.fifoIncarnation,
                seq: this.seq++,
                sampleRate: OPUS_SAMPLE_RATE,
                channels: OPUS_CHANNELS,
                preSkip: this.preSkip,
                frames,
                hopFrames: frames,
            },
            joinOpusPackets(pkts),
        );
        this.streamStart = false;
        // Consume from the FIFO.
        this.fifo.copyWithin(0, samples, this.fifoFrames * OPUS_CHANNELS);
        this.fifoFrames -= frames;
        this.fifoStartPlayAt += (frames * 1000) / OPUS_SAMPLE_RATE;
        return frame;
    }

    private pcmFrame(
        chunk: AudioChunkReadResult,
        serverNow: number,
        stereo: Float32Array,
        frames: number,
        hopFrames: number,
    ): Uint8Array {
        const header = {
            flags: 0,
            serverNow,
            playAt: chunk.playAtRealTime,
            incarnation: chunk.incarnation,
            seq: this.seq++,
            sampleRate: OPUS_SAMPLE_RATE,
            channels: OPUS_CHANNELS,
            preSkip: 0,
            frames,
            hopFrames,
        };
        if (isSilent(chunk.samples)) {
            return buildAudioWireFrame({ ...header, codec: AudioWireCodec.Silence }, new Uint8Array(0));
        }
        return buildAudioWireFrame(
            { ...header, codec: AudioWireCodec.PcmF32 },
            new Uint8Array(stereo.buffer, stereo.byteOffset, frames * OPUS_CHANNELS * 4),
        );
    }

    private ensureCodec(): boolean {
        if (this.codec) return true;
        if (this.codecFailed || this.disableOpus) return false;
        try {
            const codec = new OpusScript(OPUS_SAMPLE_RATE, OPUS_CHANNELS, OpusScript.Application.AUDIO);
            codec.setBitrate(this.bitrate);
            codec.encoderCTL(OPUS_SET_VBR, 1);
            codec.encoderCTL(OPUS_SET_COMPLEXITY, this.complexity);
            codec.encoderCTL(OPUS_SET_SIGNAL, OPUS_SIGNAL_MUSIC);
            codec.encoderCTL(OPUS_SET_BANDWIDTH, OPUS_BANDWIDTH_FULLBAND);
            this.preSkip = measureLookahead(codec);
            codec.encoderCTL(OPUS_RESET_STATE, 0);
            codec.decoderCTL(OPUS_RESET_STATE, 0);
            this.codec = codec;
            this.streamStart = true;
            console.log(`[audio-stream] opus encoder ready: ${this.bitrate} bps, lookahead ${this.preSkip} frames`);
            return true;
        } catch (err) {
            this.codecFailed = true;
            console.error('[audio-stream] opus unavailable, streaming PCM:', err);
            return false;
        }
    }
}

/** Encoder lookahead in frames, measured by round-tripping an impulse: the
 *  wire carries it as `preSkip` so listeners compensate exactly what this
 *  build of libopus delays by, whatever mode it picks. */
function measureLookahead(codec: OpusScript): number {
    const PACKETS = 10;
    const IMPULSE_AT = OPUS_FRAME_SIZE * 3;
    const pcm = new Int16Array(PACKETS * OPUS_FRAME_SIZE * OPUS_CHANNELS);
    pcm[IMPULSE_AT * OPUS_CHANNELS] = 24000;
    pcm[IMPULSE_AT * OPUS_CHANNELS + 1] = 24000;
    codec.encoderCTL(OPUS_RESET_STATE, 0);
    codec.decoderCTL(OPUS_RESET_STATE, 0);
    const frameBytes = OPUS_FRAME_SIZE * OPUS_CHANNELS * 2;
    let bestIdx = -1;
    let best = 0;
    for (let p = 0; p < PACKETS; p++) {
        const packet = codec.encode(Buffer.from(pcm.buffer, p * frameBytes, frameBytes), OPUS_FRAME_SIZE);
        const out = codec.decode(packet);
        const s16 = new Int16Array(out.buffer, out.byteOffset, out.byteLength / 2);
        for (let i = 0; i < s16.length; i += OPUS_CHANNELS) {
            const v = Math.abs(s16[i]!);
            if (v > best) {
                best = v;
                bestIdx = p * OPUS_FRAME_SIZE + i / OPUS_CHANNELS;
            }
        }
    }
    const lookahead = bestIdx - IMPULSE_AT;
    // Sanity: libopus lookahead is 2.5–6.5 ms (120–312 frames at 48 kHz).
    return lookahead >= 0 && lookahead <= OPUS_FRAME_SIZE ? lookahead : 312;
}

export function isSilent(samples: Float32Array): boolean {
    for (let i = 0; i < samples.length; i++) if (samples[i] !== 0) return false;
    return true;
}

/**
 * Interleaved source → interleaved stereo at 48 kHz with `outFrames` frames.
 * Mono is duplicated; extra channels beyond two are dropped. Resampling is
 * 4-point cubic Hermite per chunk: the chunk edges are inside the crossfade
 * overlap, so per-chunk interpolation edge effects never reach the ear.
 */
export function toStereo48k(
    src: Float32Array,
    srcChannels: number,
    srcFrames: number,
    srcRate: number,
    outFrames: number,
): Float32Array {
    const out = new Float32Array(outFrames * OPUS_CHANNELS);
    const left = 0;
    const right = srcChannels >= 2 ? 1 : 0;
    if (srcRate === OPUS_SAMPLE_RATE && outFrames === srcFrames) {
        for (let f = 0; f < srcFrames; f++) {
            out[f * 2] = src[f * srcChannels + left]!;
            out[f * 2 + 1] = src[f * srcChannels + right]!;
        }
        return out;
    }
    const step = srcFrames / outFrames;
    const last = srcFrames - 1;
    for (let f = 0; f < outFrames; f++) {
        const pos = f * step;
        const i1 = Math.min(last, Math.floor(pos));
        const t = pos - i1;
        const i0 = Math.max(0, i1 - 1);
        const i2 = Math.min(last, i1 + 1);
        const i3 = Math.min(last, i1 + 2);
        out[f * 2] = hermite(
            src[i0 * srcChannels + left]!,
            src[i1 * srcChannels + left]!,
            src[i2 * srcChannels + left]!,
            src[i3 * srcChannels + left]!,
            t,
        );
        out[f * 2 + 1] = hermite(
            src[i0 * srcChannels + right]!,
            src[i1 * srcChannels + right]!,
            src[i2 * srcChannels + right]!,
            src[i3 * srcChannels + right]!,
            t,
        );
    }
    return out;
}

/** Catmull-Rom cubic between y1 and y2. */
function hermite(y0: number, y1: number, y2: number, y3: number, t: number): number {
    const c1 = 0.5 * (y2 - y0);
    const c2 = y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3;
    const c3 = 0.5 * (y3 - y0) + 1.5 * (y1 - y2);
    return ((c3 * t + c2) * t + c1) * t + y1;
}
