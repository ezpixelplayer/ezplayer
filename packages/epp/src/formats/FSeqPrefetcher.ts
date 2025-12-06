import { ZSTDDecoder } from "zstddec";
import { promises as fsp } from 'fs';

import { ArrayBufferPool } from "../util/BufferRecycler";
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache, RefHandle } from "../util/PrefetchCache";
import { CompBlockCache, FSEQHeader, FSEQReaderAsync } from "./FSeqUtil";
import { readHandleRange } from "../util/FileUtil";

/**
 * Make a request for the sequence metadata... none of its frames... just let us know about it
 *   Never expires really, they're small.
 */
export type PrefetchSeqMetadataRequest = {
    // TODO - do we need file stamps or something?
    expiry?: number;
    fseqfile: string;
    needByTime: number;
};

/**
 * Make a prefetch request for a frame range
 */
export type PrefetchSeqFramesRequest = {
    expiry?: number;
    fseqfile: string;
    startFrame: number;
    nFrames: number;
    needByTime: number; // For first frame
};

export type DecompZStd = (
    decompbuf: ArrayBuffer,
    compbuf: ArrayBuffer,
    compoff: number,
    complen: number,
    explen: number
) => Promise<{decompBuf: ArrayBuffer, compBuf: ArrayBuffer}>;

export async function defDecompZStd(decompbuf: ArrayBuffer, compbuf: ArrayBuffer, compoff: number, complen: number, explen: number) {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    new Uint8Array(decompbuf, 0, explen).set(decoder.decode(new Uint8Array(compbuf, compoff, complen), explen));
    return {compBuf: compbuf, decompBuf: decompbuf};
}

/**
 * Make a prefetch for a time range
 */
export type PrefetchSeqTime = {
    expiry?: number;
    fseqfile: string;
    startTime: number;
    durationms: number;
    needByTime: number; // For first frame
}

export interface FSeqFileKey {
    fseqfile: string;
};

export interface FSeqFileVal {
    header: FSEQHeader;
    chunkMap: CompBlockCache;
};

interface DecompCacheKey {
    fseqfile: string;
    chunknum: number;
    fileOffset: number;
    fileLen: number;
    compression: number;
    decompLen: number;
};

interface DecompCacheVal {
    decompChunk: ArrayBuffer;
}

export type FrameTimeOrNumber =  {num?:number, time?:number};

export class FrameReference {
    private static registry = new FinalizationRegistry<string>((info) => {
        // Runs sometime after the wrapper is GC'd.
        // If we get here, the wrapper was collected without being dereferenced.
        const msg = `Leaked FrameReference (not dereferenced): ${info}\n`;
        // Be noisy. You can escalate to process.abort() if you want to fail hard.
        process.emitWarning(msg, { code: "FSEQ_FRAME_LEAK" });
    });

    _v: Uint8Array<ArrayBufferLike> | undefined;
    private readonly token = {};
    underlyingHandle: RefHandle<DecompCacheVal> | undefined = undefined;

    constructor(handle: RefHandle<DecompCacheVal>, frame: Uint8Array<ArrayBufferLike>, id: string) {
        this._v = frame;
        this.underlyingHandle = handle;
        if (this.underlyingHandle) {
            FrameReference.registry.register(this, id, this.token);
        }
    }

    release(): void {
        if (this.underlyingHandle) {
            FrameReference.registry.unregister(this.token);
            this.underlyingHandle.release();
            this._v = undefined;
            this.underlyingHandle = undefined;
        }
    }

    get frame(): Uint8Array<ArrayBufferLike> | undefined { return this._v; }

    get isReleased(): boolean {
        return this.underlyingHandle == undefined;
    }
}


/**
 * Handles fseq prefetching
 */
export class FSeqPrefetchCache {
    constructor(arg: {
        now: number,
        fseqSpace?: number,
        decompZstd?: DecompZStd, // Allow a worker thread...
    }) {
        this.now = arg.now;
        this.decompDataPool = new ArrayBufferPool();
        this.decompFunc = arg.decompZstd ?? defDecompZStd;
        this.decompPrefetchCache = new PrefetchCache<DecompCacheKey, DecompCacheVal, NeededTimePriority>({
            fetchFunction: async (key, _abort) => {
                // Fetch file data
                let readBuf = this.decompDataPool.get(key.fileLen);
                let ref = false;
                const start = performance.now();
                try {
                    const fh = await fsp.open(key.fseqfile);
                    try {
                        const rlen = await readHandleRange(fh, {buf: readBuf, offset: key.fileOffset, length: key.fileLen});
                        this.fileReadTimeCumulative += (performance.now() - start);
                        if (rlen !== key.fileLen) throw new Error (`File read of ${key.fseqfile} expected ${key.fileLen} bytes but could only read ${rlen}`);
                        if (key.compression === 1) {
                            // Decompress
                            const dbuf = this.decompDataPool.get(key.decompLen);
                            const decres = await this.decompFunc(dbuf, readBuf, 0, key.fileLen, key.decompLen);
                            readBuf = decres.compBuf; // May not be same as input due to transfer to/from worker
                            return { decompChunk: decres.decompBuf }
                        }
                        else if (key.compression === 2) {
                            throw new Error()
                        }
                        else {
                            ref = true;
                            return {
                                decompChunk: readBuf,
                            };
                        }
                    }
                    finally {
                        try {await fh.close();} catch(_e) {}
                    }
                }
                finally {
                    if (!ref) this.decompDataPool.release(readBuf);
                }
            },
            budgetPredictor: (key) => key.decompLen,
            budgetCalculator: (key) => key.decompLen,
            keyToId: (key) => `${key.fseqfile}:${key.chunknum}`,
            budgetLimit: arg.fseqSpace ?? 512_000_000,
            maxConcurrency: 2,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => {this.decompDataPool.release(v.decompChunk);}
        });
    }

    /** Set now */
    setNow(now: number) {
        this.now = now;
    }

    async shutdown() {
        await this.headerPrefetchCache.shutdown();
        await this.decompPrefetchCache.shutdown();
    }

    /** Prefetch seq metadata */
    prefetchSeqMetadata(req: PrefetchSeqMetadataRequest) {
        this.headerPrefetchCache.prefetch({
            key: {fseqfile: req.fseqfile},
            priority: {neededTime: req.needByTime},
            now: this.now,
            expiry: req.expiry ?? this.now + (24*3600*1000),
        });
    }

    getHeaderInfo(key: FSeqFileKey): {ref?: FSeqFileVal, err?:Error} | undefined {
        const r = this.headerPrefetchCache.reference(key, this.now);
        if (!r) {
            return undefined;
        }
        if (!r.ref) {
            return {err: r.err};
        }
        // These headers are just GC'd
        const rv = {ref: r.ref.v};
        r.ref.release();
        return rv;
    }

    prefetchSeqFrames(req: PrefetchSeqFramesRequest) {
        //console.log(`  PrefetchSeqFrames: ${req.fseqfile} ${req.startFrame}-${req.nFrames}`);
        const hdr = this.getHeaderInfo({fseqfile: req.fseqfile});
        if (!hdr || !hdr.ref) {
            // We can't prefetch without knowing the 
            this.prefetchSeqMetadata(req);
            return;
        }

        for (let cframe = req.startFrame; cframe < req.startFrame + req.nFrames;) {
            const fk = this.getFrameKey(req.fseqfile, {num: cframe});
            if (!fk) return;
            //console.log(`Prefetch chunk: ${fk.dk.chunknum} ${fk.hdr.chunkMap.index[fk.dk.chunknum].startFrame}-${fk.hdr.chunkMap.index[fk.dk.chunknum].endFrame}`);
            this.decompPrefetchCache.prefetch({
                key: fk.dk,
                now: this.now,
                expiry: req.expiry ?? this.now + 24*3600_000, 
                priority: {neededTime: req.needByTime + hdr.ref.header.msperframe * (cframe - req.startFrame)}
            });
            cframe = fk.hdr.chunkMap.index[fk.dk.chunknum].endFrame;
        }
    }

    prefetchSeqTimes(req: PrefetchSeqTime) {
        //console.log(`PrefetchSeqTimes: ${req.fseqfile} ${req.startTime}-${req.durationms}`);
        if (req.durationms < 0) return;
        const hdr = this.getHeaderInfo({fseqfile: req.fseqfile});
        if (!hdr || !hdr.ref) {
            // We can't prefetch without knowing the 
            this.prefetchSeqMetadata(req);
            return;
        }
        const sf = Math.floor(req.startTime / hdr.ref.header.msperframe);
        let ef = Math.ceil((req.startTime+ req.durationms) / hdr.ref.header.msperframe);
        if (req.durationms === 0) {
            ef = sf + 1;
        }
        ef = Math.min(ef, hdr.ref.header.frames);
        this.prefetchSeqFrames({
            fseqfile: req.fseqfile,
            startFrame: sf,
            nFrames: ef - sf,
            needByTime: req.needByTime,
        });
    }

    private getFrameKey(fseq: string, frame: {num?: number, time?:number}, needByTime?: number) {
        const hdr = this.getHeaderInfo({fseqfile: fseq})?.ref;
        if (!hdr) {
            // We can't prefetch without knowing the 
            if (needByTime !== undefined) {
                this.prefetchSeqMetadata({fseqfile: fseq, needByTime: needByTime});
            }
            return;
        }

        if (frame.num === undefined) {
            if (frame.time === undefined) throw new TypeError("Should set frame num or time");
            frame.num = Math.floor(frame.time / hdr.header.msperframe);
        }

        const chunk = hdr.chunkMap.findChunk(frame.num);
        if (chunk === undefined) return undefined;
        const cidx = hdr.chunkMap.index[chunk];

        const nframes = cidx.endFrame-cidx.startFrame;
        const lenraw = nframes*hdr.header.stepsize;
        const comptype = hdr.header.compression;

        const dk: DecompCacheKey = {
            fseqfile: fseq,
            chunknum: chunk,
            fileLen: cidx.fileSize,
            fileOffset: cidx.fileOffset,
            decompLen: lenraw,
            compression: comptype,
        };
        return {dk, hdr};
    }

    getFrame(fseq: string, frame: FrameTimeOrNumber): {ref?: FrameReference, err ?: Error} | undefined {
        const fk = this.getFrameKey(fseq, frame, undefined);
        if (!fk || frame.num === undefined) return undefined;

        // Fetch the chunk and wrap as a frame reference
        const cref = this.decompPrefetchCache.reference(fk.dk, this.now);
        if (!cref) return undefined;
        if (!cref.ref?.v) return {err: cref.err};

        const cnum = fk.dk.chunknum;
        const chunk = fk.hdr.chunkMap.index[cnum];

        return {ref: new FrameReference(
            cref.ref,
            new Uint8Array(cref.ref.v.decompChunk, (frame.num - chunk.startFrame) * fk.hdr.header.stepsize, fk.hdr.header.stepsize),
            `${fseq}:${frame}`
        )};
    }

    dispatch(ageout?: number) {
        this.headerPrefetchCache.cleanup(this.now, this.now - (ageout ?? 60000));
        this.headerPrefetchCache.dispatchRequests(this.now);

        this.decompPrefetchCache.cleanup(this.now, this.now - (ageout ?? 60000));
        this.decompPrefetchCache.dispatchRequests(this.now);
    }

    now: number;

    headerPrefetchCache = new PrefetchCache<FSeqFileKey, FSeqFileVal, NeededTimePriority>({
        fetchFunction: async (key, _abort) => {
            const header = await FSEQReaderAsync.readFSEQHeaderAsync(key.fseqfile);
            const chunkMap = new CompBlockCache();
            FSEQReaderAsync.createCompBlockCache(header, chunkMap);
            return {
                header,
                chunkMap,
            };
        },
        budgetPredictor: (_key) => 1,
        budgetCalculator: (_key) => 1,
        keyToId: (key) => `${key.fseqfile}`,
        budgetLimit: 10000,
        maxConcurrency: 2,
        priorityComparator: needTimePriorityCompare,
        onDispose: (_k, _v) => {}
    });

    decompDataPool: ArrayBufferPool;
    decompFunc: DecompZStd;
    decompPrefetchCache: PrefetchCache<DecompCacheKey, DecompCacheVal, NeededTimePriority>;
    fileReadTimeCumulative: number = 0;

    getStats() {
        const decompPool = this.decompDataPool.getStats();
        let totalDecompMem = 0;
        for (const di of decompPool) {
            totalDecompMem += di.size * di.total;
        }
        return {
            headerPrefetch: this.headerPrefetchCache.getStats(),
            decompPrefetch: this.decompPrefetchCache.getStats(),
            decompPool,
            totalDecompMem,
            fileReadTimeCumulative: this.fileReadTimeCumulative,
        }
    }

    resetStats() {
        this.fileReadTimeCumulative = 0;
    }
    // TODO:
    //   Cache invalidation for updated .fseq files?
}