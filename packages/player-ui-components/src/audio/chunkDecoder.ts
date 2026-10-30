/**
 * Wire frame → decoded planar audio. Opus via the wasm `opus-decoder`;
 * legacy / fallback PCM is just de-interleaved.
 */

import {
    AUDIO_WIRE_FLAG_CONTINUOUS,
    AUDIO_WIRE_FLAG_STREAM_START,
    AudioWireCodec,
    splitOpusPackets,
    type AudioWireFrame,
} from '@ezplayer/ezplayer-core';
import { OpusDecoder } from 'opus-decoder';

import type { DecodedChunk } from './chunkScheduler';

export class ChunkDecoder {
    private opus?: OpusDecoder<48000>;
    private opusReady = false;
    private initDone = false;
    private initPromise?: Promise<void>;
    /** Frames whose payload failed to decode. */
    decodeErrors = 0;

    /** Init has settled (successfully or not); the session's warm-up gate
     *  waits on this so the first chunks are not thrown away. */
    get ready(): boolean {
        return this.initDone;
    }

    /** Start the opus decoder (async wasm init). Frames arriving before it
     *  resolves are dropped — the session holds them back until `ready`. */
    init(): Promise<void> {
        if (!this.initPromise) {
            this.initPromise = (async () => {
                const dec = new OpusDecoder({
                    channels: 2,
                    sampleRate: 48000,
                    preSkip: 0,
                    streamCount: 1,
                    coupledStreamCount: 1,
                    channelMappingTable: [0, 1],
                });
                await dec.ready;
                this.opus = dec;
                this.opusReady = true;
            })()
                .catch((err) => {
                    console.warn('[audio] opus decoder unavailable:', err);
                })
                .finally(() => {
                    this.initDone = true;
                });
        }
        return this.initPromise;
    }

    free(): void {
        try {
            this.opus?.free();
        } catch {
            /* ignore */
        }
        this.opus = undefined;
        this.opusReady = false;
        this.initDone = false;
        this.initPromise = undefined;
    }

    decode(frame: AudioWireFrame): DecodedChunk | null {
        const base = {
            sampleRate: frame.sampleRate,
            frames: frame.frames,
            hopFrames: frame.hopFrames,
            playAt: frame.playAt,
            incarnation: frame.incarnation,
            serverNow: frame.serverNow,
        };
        switch (frame.codec) {
            case AudioWireCodec.Silence:
                return { ...base, planar: [], silent: true };
            case AudioWireCodec.PcmF32: {
                const channels = frame.channels;
                const p = frame.payload;
                const interleaved = new Float32Array(p.buffer, p.byteOffset, frame.frames * channels);
                const planar: Float32Array[] = [];
                for (let ch = 0; ch < channels; ch++) {
                    const out = new Float32Array(frame.frames);
                    for (let i = 0; i < frame.frames; i++) out[i] = interleaved[i * channels + ch]!;
                    planar.push(out);
                }
                return { ...base, planar, silent: false };
            }
            case AudioWireCodec.Opus: {
                if (!this.opusReady || !this.opus) return null;
                const packets = splitOpusPackets(frame.payload);
                if (packets.length === 0) return null;
                let decoded;
                try {
                    decoded = this.opus.decodeFrames(packets);
                } catch {
                    this.decodeErrors++;
                    return null;
                }
                if (decoded.errors.length) this.decodeErrors += decoded.errors.length;
                const flags = frame.flags ?? 0;
                if (flags & AUDIO_WIRE_FLAG_CONTINUOUS) {
                    // One encoder stream across frames: play everything, shifted earlier by
                    // the codec delay. The startup transient after a (re)start is silenced.
                    const n = decoded.samplesDecoded;
                    if (n <= 0) return null;
                    const planar = decoded.channelData.map((c) => c.slice(0, n));
                    if (flags & AUDIO_WIRE_FLAG_STREAM_START) {
                        const z = Math.min(frame.preSkip, n);
                        for (const c of planar) c.fill(0, 0, z);
                    }
                    return {
                        ...base,
                        sampleRate: decoded.sampleRate,
                        frames: n,
                        hopFrames: n,
                        playAt: frame.playAt - (frame.preSkip * 1000) / decoded.sampleRate,
                        planar,
                        silent: false,
                    };
                }
                // Legacy standalone frames: discard the lookahead, keep `frames`.
                const start = Math.min(frame.preSkip, decoded.samplesDecoded);
                const end = Math.min(start + frame.frames, decoded.samplesDecoded);
                const frames = end - start;
                if (frames <= 0) return null;
                const planar = decoded.channelData.map((c) => c.slice(start, end));
                return { ...base, sampleRate: decoded.sampleRate, frames, planar, silent: false };
            }
            default:
                return null;
        }
    }
}
