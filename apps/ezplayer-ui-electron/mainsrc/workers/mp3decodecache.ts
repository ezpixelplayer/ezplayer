import * as path from 'path';

import { ArrayBufferPool } from '@ezplayer/epp';
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache, RefHandle } from '@ezplayer/epp';

import { Worker } from 'node:worker_threads';
import { DecodeReq, DecodedAudio, DecodedAudioResp } from './mp3decodeworker';
import { fileURLToPath } from 'node:url';

type SegmentedAudio = {
    // channelData[channel][segment] = Float32Array of samples
    channelData: Float32Array[][];
    sampleRate: number;
};

/**
 * Build an interleaved audio chunk from segmented audio.
 *
 * - channelData is [channels][segments]
 * - reads starting at sampleOffset (per-channel sample index)
 * - writes interleaved into a newly-allocated Float32Array of length nSamples * channels
 * - applies volume scale
 *
 * Out-of-range reads are treated as 0.
 */
export function buildInterleavedAudioChunkFromSegments(opts: {
    channelData: Float32Array[][];
    nSamplesInAudio: number;
    sampleOffset: number;
    nSamples: number;
    volumeSF: number;
}) {
    const { channelData, sampleOffset, nSamples, volumeSF, nSamplesInAudio } = opts;
    const channels = channelData.length;

    if (nSamples === 0) return new Float32Array(0);

    if (channels === 0) throw new Error("channelData must have at least 1 channel");

    // Infer segmentSize if not provided
    const inferredSegSize = channelData[0]?.[0]?.length ?? 0;

    if (inferredSegSize <= 0) {
        throw new Error("segmentSize could not be inferred (channelData[0][0] missing/empty)");
    }

    // Validate shape
    for (let ch = 0; ch < channels; ch++) {
        if (!Array.isArray(channelData[ch]) || channelData[ch].length === 0) {
            throw new Error(`channelData[${ch}] must be a non-empty array of Float32Array segments`);
        }
        for (let seg = 0; seg < channelData[ch].length; ++seg) {
            if (channelData[ch][seg].length !== inferredSegSize) {
                throw new Error(`channelData[${ch}][${seg}] length does not match the inferred length`);
            }
        }
    }

    const out = new Float32Array(nSamples * channels);

    // read sample at absolute index from segmented array
    const readSample = (segments: Float32Array[], absIndex: number): number => {
        if (absIndex < 0 || absIndex >= nSamplesInAudio) return 0;

        const segIndex = (absIndex / inferredSegSize) | 0;
        if (segIndex < 0 || segIndex >= segments.length) return 0;

        const seg = segments[segIndex];
        const inSeg = absIndex - segIndex * inferredSegSize;

        // If last segment is shorter, guard
        if (inSeg < 0 || inSeg >= seg.length) return 0;

        return seg[inSeg];
    };

    // Fill interleaved output
    for (let ch = 0; ch < channels; ch++) {
        const segments = channelData[ch];
        let abs = sampleOffset;

        for (let i = 0, o = ch; i < nSamples; i++, abs++, o += channels) {
            out[o] = readSample(segments, abs) * volumeSF;
        }
    }

    return out;
}

/**
 * Make a request for mp3 audio...
 */
export type PrefetchMP3Request = {
    expiry?: number;
    mp3file: string;
    needByTime: number;
    neededThroughTime: number;
};

export interface MP3FileKey {
    mp3file: string;
}

interface MP3FileCacheVal {
    decompAudio: DecodedAudio;
}

export type MP3Reference = RefHandle<MP3FileCacheVal>;

/**
 * Handles fseq prefetching
 */
export class MP3PrefetchCache {
    constructor(arg: { readonly log: (msg: string) => void; now: number; mp3Space?: number }) {
        this.now = arg.now;
        this.readBufPool = new ArrayBufferPool();
        this.decodewc = new Mp3DecodeWorkerClient();
        this.mp3PrefetchCache = new PrefetchCache<MP3FileKey, MP3FileCacheVal, NeededTimePriority>({
            fetchFunction: async (key, _abort) => {
                arg.log(`Starting mp3 load of ${key.mp3file}`);
                try {
                    return { decompAudio: await this.decodewc.decodeFile({ filePath: key.mp3file }) };
                } finally {
                    arg.log(`Done mp3 decode of ${key.mp3file}`);
                }
            },
            budgetPredictor: (_key) => 1, // 1 song
            budgetCalculator: (_key, _val) => 1, // 1 song
            keyToId: (key) => `${key.mp3file}`,
            budgetLimit: arg.mp3Space ?? 4, // An hour of CD quality
            maxConcurrency: 1,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => {
                this.decodewc.returnBuffer(v.decompAudio);
            },
        });
    }

    /** Set now */
    setNow(now: number) {
        this.now = now;
    }

    async shutdown() {
        await this.mp3PrefetchCache.shutdown();
    }

    /** Prefetch mp3 */
    prefetchMP3(req: PrefetchMP3Request) {
        this.mp3PrefetchCache.prefetch({
            key: { mp3file: req.mp3file },
            priority: { neededTime: req.needByTime, neededThroughTime: req.neededThroughTime },
            now: this.now,
            expiry: req.expiry ?? this.now + 24 * 3600 * 1000,
        });
    }

    getMp3(mp3file: string): { ref?: MP3Reference; err?: Error } | undefined {
        const mp3ref = this.mp3PrefetchCache.reference({ mp3file }, this.now);
        if (!mp3ref) return undefined;
        if (!mp3ref.ref?.v) return { err: mp3ref.err };
        return { ref: mp3ref.ref };
    }

    dispatch(ageout?: number) {
        this.mp3PrefetchCache.cleanupAndDispatchRequests(this.now, this.now - (ageout ?? 25 * 3600 * 1000)); // Keep for 25 hours
    }

    now: number;
    readBufPool: ArrayBufferPool;
    mp3PrefetchCache: PrefetchCache<MP3FileKey, MP3FileCacheVal, NeededTimePriority>;
    decodewc: Mp3DecodeWorkerClient;

    getStats() {
        const readBufPool = this.readBufPool.getStats();
        let totalReadMem = 0;
        for (const di of readBufPool) {
            totalReadMem += di.size * di.total;
        }
        return {
            mp3Prefetch: this.mp3PrefetchCache.getStats(),
            readBufPool,
            totalDecompMem: totalReadMem,
            fileReadTimeCumulative: this.decodewc.fileReadTimeCumulative,
            decodeTimeCumulative: this.decodewc.decodeTimeCumulative,
        };
    }

    resetStats() {
        this.decodewc.resetStats();
        this.mp3PrefetchCache.resetStats();
    }
}

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class Mp3DecodeWorkerClient {
    private worker: Worker;
    private nextId = 1;
    private inflight = new Map<
        number,
        {
            resolve: (v: DecodedAudio) => void;
            reject: (e: Error) => void;
        }
    >();

    fileReadTimeCumulative: number = 0;
    decodeTimeCumulative: number = 0;

    resetStats() {
        this.fileReadTimeCumulative = 0;
        this.decodeTimeCumulative = 0;
    }

    constructor() {
        this.worker = new Worker(path.join(__dirname, 'mp3decodeworker.js'), {
            workerData: {
                name: 'mp3decode',
            },
        });

        this.worker.on('message', (msg: DecodedAudioResp) => {
            if (msg.type !== 'result') return;
            const pending = this.inflight.get(msg.id);
            if (!pending) return;

            this.fileReadTimeCumulative += msg.fileReadTime;
            this.decodeTimeCumulative += msg.decodeTime;

            this.inflight.delete(msg.id);

            if (!msg.ok || !msg.result) {
                pending.reject(new Error(msg.error));
                return;
            }

            pending.resolve(msg.result!);
        });

        this.worker.on('error', (e) => {
            // Hard error: reject all inflight
            const errs = Array.from(this.inflight.values());
            this.inflight.clear();
            errs.forEach(({ reject }) => reject(e));
        });

        this.worker.on('exit', (code) => {
            if (code !== 0) {
                const e = new Error(`mp3 worker exited with code ${code}`);
                const errs = Array.from(this.inflight.values());
                this.inflight.clear();
                errs.forEach(({ reject }) => reject(e));
            }
        });
    }

    async decodeFile({ filePath }: { filePath: string }): Promise<DecodedAudio> {
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            this.inflight.set(id, { resolve, reject });

            this.worker.postMessage({
                type: 'decode',
                id,
                filePath,
            } satisfies DecodeReq);
        }) as Promise<DecodedAudio>;
    }

    returnBuffer(v: DecodedAudio) {
        this.worker.postMessage(
            {
                type: 'return',
                buffers: v.channelData.map((a) => a.buffer),
            } satisfies DecodeReq,
            v.channelData.map((a) => a.buffer),
        );
    }

    terminate() {
        return this.worker.terminate();
    }
}
