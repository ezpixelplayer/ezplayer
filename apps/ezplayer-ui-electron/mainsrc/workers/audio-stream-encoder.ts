/**
 * Turns ring-buffer audio chunks into wire frames for browser listeners.
 *
 * Every chunk from the playback master is hop + ~10 ms crossfade tail at the
 * source sample rate (silence chunks are mono 48 kHz). The encoder normalizes
 * to stereo 48 kHz, then opus-encodes the chunk standalone: the encoder is
 * reset per chunk, so a listener can decode any chunk without the previous
 * one — chunks are dropped on slow links and the stream is joined mid-song.
 * The codec warm-up at the head of each chunk lands inside the crossfade
 * region, which is exactly what the overlap is there to mask.
 *
 * Opus is wasm (`opusscript`) so nothing native has to be packaged. If the
 * codec fails to initialize the encoder falls back to raw Float32 PCM, which
 * every listener also accepts.
 */

import type { AudioChunkReadResult } from '@ezplayer/ezplayer-core';
import { AudioWireCodec, buildAudioWireFrame, joinOpusPackets } from '@ezplayer/ezplayer-core';
import OpusScript from 'opusscript';

export const OPUS_SAMPLE_RATE = 48000;
export const OPUS_CHANNELS = 2;
/** 20 ms at 48 kHz. */
export const OPUS_FRAME_SIZE = 960;

// libopus CTLs (opus_defines.h).
const OPUS_SET_VBR = 4006;
const OPUS_SET_COMPLEXITY = 4010;
const OPUS_SET_SIGNAL = 4024;
const OPUS_RESET_STATE = 4028;
const OPUS_SIGNAL_MUSIC = 3002;

export interface AudioStreamEncoderOptions {
    /** Target bitrate in bits/s. Default 64 kbps — transparent enough for a
     *  phone speaker in a driveway, ~2% of the raw PCM stream. */
    bitrate?: number;
    /** libopus complexity 0–10. Lower is cheaper on small players. Default 5. */
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
    /** Scratch int16 buffer, grown on demand. */
    private pcm16 = new Int16Array(0);

    constructor(opts: AudioStreamEncoderOptions = {}) {
        this.bitrate = opts.bitrate ?? 64_000;
        this.complexity = opts.complexity ?? 5;
        this.disableOpus = opts.disableOpus ?? false;
    }

    /** True once the opus codec is up (after the first encode). */
    get usingOpus(): boolean {
        return !!this.codec;
    }

    /** Measured encoder lookahead in frames (0 until the codec is up). */
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

    /** Build one wire frame for a ring chunk. `serverNow` is the player's
     *  Date.now() at send time. */
    encodeChunk(chunk: AudioChunkReadResult, serverNow: number): Uint8Array {
        const srcChannels = Math.max(1, chunk.channels);
        const srcFrames = Math.floor(chunk.samples.length / srcChannels);
        const srcHop = Math.max(1, Math.min(srcFrames, Math.floor(chunk.advanceSamples / srcChannels) || srcFrames));
        const ratio = OPUS_SAMPLE_RATE / chunk.sampleRate;
        const frames = Math.max(1, Math.round(srcFrames * ratio));
        const hopFrames = Math.max(1, Math.min(frames, Math.round(srcHop * ratio)));

        const header = {
            serverNow,
            playAt: chunk.playAtRealTime,
            incarnation: chunk.incarnation,
            seq: chunk.seq,
            sampleRate: OPUS_SAMPLE_RATE,
            channels: OPUS_CHANNELS,
            preSkip: 0,
            frames,
            hopFrames,
        };

        if (isSilent(chunk.samples)) {
            return buildAudioWireFrame({ ...header, codec: AudioWireCodec.Silence }, new Uint8Array(0));
        }

        const stereo = toStereo48k(chunk.samples, srcChannels, srcFrames, chunk.sampleRate, frames);

        if (!this.ensureCodec()) {
            return buildAudioWireFrame(
                { ...header, codec: AudioWireCodec.PcmF32 },
                new Uint8Array(stereo.buffer, stereo.byteOffset, stereo.byteLength),
            );
        }

        const codec = this.codec!;
        const totalFrames = frames + this.preSkip;
        const packetCount = Math.ceil(totalFrames / OPUS_FRAME_SIZE);
        const paddedFrames = packetCount * OPUS_FRAME_SIZE;
        const needed = paddedFrames * OPUS_CHANNELS;
        if (this.pcm16.length < needed) this.pcm16 = new Int16Array(needed);
        const pcm16 = this.pcm16;
        const validSamples = frames * OPUS_CHANNELS;
        for (let i = 0; i < validSamples; i++) {
            const v = stereo[i]!;
            pcm16[i] = v >= 1 ? 32767 : v <= -1 ? -32768 : (v * 32767) | 0;
        }
        pcm16.fill(0, validSamples, needed);

        codec.encoderCTL(OPUS_RESET_STATE, 0);
        const packets: Uint8Array[] = [];
        const frameBytes = OPUS_FRAME_SIZE * OPUS_CHANNELS * 2;
        for (let p = 0; p < packetCount; p++) {
            const view = Buffer.from(pcm16.buffer, pcm16.byteOffset + p * frameBytes, frameBytes);
            packets.push(codec.encode(view, OPUS_FRAME_SIZE));
        }
        return buildAudioWireFrame(
            { ...header, codec: AudioWireCodec.Opus, preSkip: this.preSkip },
            joinOpusPackets(packets),
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
            this.preSkip = measureLookahead(codec);
            codec.encoderCTL(OPUS_RESET_STATE, 0);
            codec.decoderCTL(OPUS_RESET_STATE, 0);
            this.codec = codec;
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
 *  wire carries it as `preSkip` so listeners trim exactly what this build of
 *  libopus delays by, whatever mode it picks. */
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
