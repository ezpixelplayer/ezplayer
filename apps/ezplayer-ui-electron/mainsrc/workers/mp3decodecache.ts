import * as path from 'path';

import { ArrayBufferPool } from '@ezplayer/epp';
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache, RefHandle } from '@ezplayer/epp';

import { Worker } from 'node:worker_threads';
import { DecodeReq, DecodedAudio, DecodedAudioResp } from './mp3decodeworker';
import { fileURLToPath } from 'node:url';

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

    if (channels === 0) throw new Error('channelData must have at least 1 channel');

    // Infer segmentSize if not provided
    const inferredSegSize = channelData[0]?.[0]?.length ?? 0;

    if (inferredSegSize <= 0) {
        throw new Error('segmentSize could not be inferred (channelData[0][0] missing/empty)');
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
    /** Estimated decoded length in seconds, if known (e.g. from the action duration).
     *  Used to size the pending-budget estimate; falls back to a constant otherwise. */
    estDurationSec?: number;
    /** Confidence tier (0 = happy-path/fg, 2 = speculative skip/down-stack). */
    tier?: number;
    /** Record's loudness-normalization flag; selects the derived variant. */
    normalize?: boolean;
};

export interface MP3FileKey {
    mp3file: string;
    normalize: boolean;
}

interface MP3FileCacheVal {
    decompAudio: DecodedAudio;
}

export type MP3Reference = RefHandle<MP3FileCacheVal>;

/**
 * Handles fseq prefetching
 */
export class MP3PrefetchCache {
    constructor(arg: {
        readonly log: (msg: string) => void;
        now: number;
        mp3SpaceSeconds?: number;
        /** Map a record audio path to the file to decode (its precomputed derivation). */
        resolveFile?: (audioFile: string, opts: { normalize: boolean }) => Promise<string>;
    }) {
        this.now = arg.now;
        this.readBufPool = new ArrayBufferPool();
        this.decodewc = new Mp3DecodeWorkerClient(arg.log);
        this.mp3PrefetchCache = new PrefetchCache<MP3FileKey, MP3FileCacheVal, NeededTimePriority>({
            fetchFunction: async (key, _abort) => {
                arg.log(`Starting mp3 load of ${key.mp3file}`);
                try {
                    const filePath = arg.resolveFile
                        ? await arg.resolveFile(key.mp3file, { normalize: key.normalize })
                        : key.mp3file;
                    if (filePath !== key.mp3file) arg.log(`Decoding derived audio ${filePath}`);
                    return { decompAudio: await this.decodewc.decodeFile({ filePath }) };
                } finally {
                    arg.log(`Done mp3 decode of ${key.mp3file}`);
                }
            },
            // Estimate pending cost from the known song length when we have it, else a ~5 min fallback.
            budgetPredictor: (key) => this.estimateBudgetSec(this.durationHints.get(key.mp3file)),
            budgetCalculator: (_key, val) =>
                Math.ceil(val.decompAudio.nSamples / (val.decompAudio.sampleRate ?? 1) / 5 + 1) * 5,
            keyToId: (key) => (key.normalize ? `${key.mp3file}|norm` : key.mp3file),
            budgetLimit: arg.mp3SpaceSeconds ?? 5400,
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

    /** Start a new prefetch generation (call once per pass, before prefetching). */
    beginGeneration() {
        this.mp3PrefetchCache.beginGeneration();
    }

    async shutdown() {
        await this.mp3PrefetchCache.shutdown();
    }

    /** Same units as budgetCalculator: round seconds up to a 5s bucket (+1). */
    private estimateBudgetSec(durationSec?: number): number {
        const sec = durationSec && durationSec > 0 ? durationSec : 300; // ~5 min fallback
        return Math.ceil(sec / 5 + 1) * 5;
    }

    /** Prefetch mp3 */
    prefetchMP3(req: PrefetchMP3Request) {
        if (req.estDurationSec && req.estDurationSec > 0) {
            this.durationHints.set(req.mp3file, req.estDurationSec);
        }
        this.mp3PrefetchCache.prefetch({
            key: { mp3file: req.mp3file, normalize: !!req.normalize },
            priority: { neededTime: req.needByTime, neededThroughTime: req.neededThroughTime, tier: req.tier },
            now: this.now,
            expiry: req.expiry ?? this.now + 24 * 3600 * 1000,
        });
    }

    /** Decode settled (ready or failed)? Unlike getMp3 this neither counts as a miss nor
     *  references the entry, so it is safe to ask every tick. False when not requested. */
    isSettled(mp3file: string, normalize?: boolean): boolean {
        return this.mp3PrefetchCache.check({ mp3file, normalize: !!normalize }, this.now);
    }

    getMp3(mp3file: string, normalize?: boolean): { ref?: MP3Reference; err?: Error } | undefined {
        const mp3ref = this.mp3PrefetchCache.reference({ mp3file, normalize: !!normalize }, this.now);
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
    /** mp3file -> estimated decoded length (sec), fed from prefetch hints. */
    private durationHints = new Map<string, number>();

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

/** A decode that takes longer than this has wedged (a 15-minute song decodes in
 *  a few seconds even on a small player). The worker is replaced. */
const DECODE_TIMEOUT_MS = 120_000;

/**
 * Talks to mp3decodeworker.js. The worker is a separate thread that can die at
 * load (a broken decoder module) or wedge. A dead worker is logged, in-flight
 * and later requests fail with the reason, and the worker is respawned for the
 * next request.
 */
export class Mp3DecodeWorkerClient {
    private worker: Worker | undefined;
    private dead: Error | undefined;
    private nextId = 1;
    private inflight = new Map<
        number,
        {
            resolve: (v: DecodedAudio) => void;
            reject: (e: Error) => void;
            timer: ReturnType<typeof setTimeout>;
            filePath: string;
        }
    >();
    private readonly log: (msg: string) => void;

    fileReadTimeCumulative: number = 0;
    decodeTimeCumulative: number = 0;

    resetStats() {
        this.fileReadTimeCumulative = 0;
        this.decodeTimeCumulative = 0;
    }

    constructor(log?: (msg: string) => void) {
        this.log = log ?? ((m) => console.error(m));
        this.spawn();
    }

    private spawn(): Worker {
        const worker = new Worker(path.join(__dirname, 'mp3decodeworker.js'), {
            workerData: {
                name: 'mp3decode',
            },
        });
        this.worker = worker;
        this.dead = undefined;

        worker.on('message', (msg: DecodedAudioResp) => {
            if (msg.type !== 'result') return;
            const pending = this.inflight.get(msg.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.inflight.delete(msg.id);

            this.fileReadTimeCumulative += msg.fileReadTime;
            this.decodeTimeCumulative += msg.decodeTime;

            if (!msg.ok || !msg.result) {
                pending.reject(new Error(msg.error));
                return;
            }
            pending.resolve(msg.result!);
        });

        worker.on('error', (e) => {
            if (this.worker !== worker) return;
            this.markDead(new Error(`mp3 decode worker failed: ${e?.stack ?? e?.message ?? String(e)}`));
        });

        worker.on('exit', (code) => {
            if (this.worker !== worker) return;
            if (code !== 0 || this.inflight.size > 0) {
                this.markDead(new Error(`mp3 decode worker exited with code ${code}`));
            }
        });
        return worker;
    }

    /** Record the death, fail everything waiting, and drop the worker so the
     *  next request spawns a fresh one. */
    private markDead(reason: Error): void {
        this.log(`[mp3decode] ${reason.message}`);
        this.dead = reason;
        const w = this.worker;
        this.worker = undefined;
        if (w) void w.terminate().catch(() => undefined);
        const errs = Array.from(this.inflight.values());
        this.inflight.clear();
        for (const p of errs) {
            clearTimeout(p.timer);
            p.reject(reason);
        }
    }

    async decodeFile({ filePath }: { filePath: string }): Promise<DecodedAudio> {
        const worker = this.worker ?? this.respawn();
        const id = this.nextId++;
        return new Promise<DecodedAudio>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (!this.inflight.has(id)) return;
                this.markDead(new Error(`mp3 decode of ${filePath} timed out after ${DECODE_TIMEOUT_MS / 1000} s`));
            }, DECODE_TIMEOUT_MS);
            this.inflight.set(id, { resolve, reject, timer, filePath });
            try {
                worker.postMessage({
                    type: 'decode',
                    id,
                    filePath,
                } satisfies DecodeReq);
            } catch (err) {
                clearTimeout(timer);
                this.inflight.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
            }
        });
    }

    private respawn(): Worker {
        this.log(`[mp3decode] respawning decode worker${this.dead ? ` after: ${this.dead.message}` : ''}`);
        return this.spawn();
    }

    returnBuffer(v: DecodedAudio) {
        const worker = this.worker;
        if (!worker) return; // a fresh worker allocates its own pool
        const buffers: ArrayBuffer[] = [];
        for (const bo of v.channelData) {
            for (const b of bo) {
                buffers.push(b.buffer);
            }
        }
        try {
            worker.postMessage(
                {
                    type: 'return',
                    buffers,
                } satisfies DecodeReq,
                buffers,
            );
        } catch {
            /* worker is going away; buffers are just garbage-collected */
        }
    }

    terminate() {
        const w = this.worker;
        this.worker = undefined;
        return w ? w.terminate() : Promise.resolve(0);
    }
}
