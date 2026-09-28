/**
 * Wire frame → decoded planar audio. Opus via the wasm `opus-decoder`;
 * legacy / fallback PCM is just de-interleaved.
 */

import { AudioWireCodec, splitOpusPackets, type AudioWireFrame } from '@ezplayer/ezplayer-core';
import { OpusDecoder } from 'opus-decoder';

import type { DecodedChunk } from './chunkScheduler';

export class ChunkDecoder {
    private opus?: OpusDecoder<48000>;
    private opusReady = false;
    private initPromise?: Promise<void>;
    /** Frames whose payload failed to decode. */
    decodeErrors = 0;

    /** Start the opus decoder (async wasm init). Frames arriving before it
     *  resolves are dropped; that is at most the first ~100 ms. */
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
            })().catch((err) => {
                console.warn('[audio] opus decoder unavailable:', err);
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
