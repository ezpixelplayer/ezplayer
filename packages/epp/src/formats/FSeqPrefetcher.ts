import { ZSTDDecoder } from 'zstddec';
import { promises as fsp } from 'fs';

import { ArrayBufferPool } from '../util/BufferRecycler';
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache, RefHandle } from '../util/PrefetchCache';
import { CompBlockCache, FSEQHeader, FSEQReaderAsync, summarizeFSEQHeader } from './FSeqUtil';
import { readHandleRange } from '../util/FileUtil';

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
    explen: number,
) => Promise<{ decompBuf: ArrayBuffer; compBuf: ArrayBuffer }>;

export async function defDecompZStd(
    decompbuf: ArrayBuffer,
    compbuf: ArrayBuffer,
    compoff: number,
    complen: number,
    explen: number,
) {
    const decoder = new ZSTDDecoder();
    await decoder.init();
    new Uint8Array(decompbuf, 0, explen).set(decoder.decode(new Uint8Array(compbuf, compoff, complen), explen));
    return { compBuf: compbuf, decompBuf: decompbuf };
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
};

export interface FSeqFileKey {
    fseqfile: string;
}

export interface FSeqFileVal {
    header: FSEQHeader;
    chunkMap: CompBlockCache;
    layout: FileLayout;
}

export interface ScatterRange {
    srcOffset: number; // byte offset within one decompressed sparse frame
    dstOffset: number; // byte offset within one dense frame (= absolute channel)
    length: number; // number of bytes (channels) to copy
}

export interface FileLayout {
    isSparse: boolean;
    fileStride: number; // per-frame byte stride in decompressed file data
    denseStep: number; // per-frame byte stride in dense output (padded to 4)
    scatterPlan: ScatterRange[]; // empty when isSparse=false
}

interface DecompCacheKey {
    fseqfile: string;
    chunknum: number;
    fileOffset: number;
    fileLen: number;
    compression: number;
    decompLen: number; // dense output size: nframes * denseStep
    nframes: number;
    fileStride: number;
    denseStep: number;
    scatterPlan: ScatterRange[];
}

interface DecompCacheVal {
    decompChunk: ArrayBuffer;
}

function computeFileLayout(header: FSEQHeader): FileLayout {
    if (header.nsparseranges === 0) {
        return {
            isSparse: false,
            fileStride: header.stepsize,
            denseStep: header.stepsize,
            scatterPlan: [],
        };
    }
    const scatterPlan: ScatterRange[] = [];
    let cumulativeSrc = 0;
    let maxCh = 0;
    for (const r of header.chranges) {
        scatterPlan.push({ srcOffset: cumulativeSrc, dstOffset: r.startch, length: r.chcount });
        cumulativeSrc += r.chcount;
        if (r.startch + r.chcount > maxCh) maxCh = r.startch + r.chcount;
    }
    const denseStep = (maxCh + 3) & ~3;
    return {
        isSparse: true,
        fileStride: cumulativeSrc, // xLights packs sparse frames tight: sum of chcounts
        denseStep,
        scatterPlan,
    };
}

function scatterChunk(
    dense: Uint8Array,
    sparse: Uint8Array,
    nframes: number,
    fileStride: number,
    denseStep: number,
    plan: ScatterRange[],
): void {
    for (let f = 0; f < nframes; ++f) {
        const sBase = f * fileStride;
        const dBase = f * denseStep;
        let dCursor = 0;
        for (const r of plan) {
            if (r.dstOffset > dCursor) {
                dense.subarray(dBase + dCursor, dBase + r.dstOffset).fill(0);
            }
            dense.set(sparse.subarray(sBase + r.srcOffset, sBase + r.srcOffset + r.length), dBase + r.dstOffset);
            dCursor = r.dstOffset + r.length;
        }
        if (dCursor < denseStep) {
            dense.subarray(dBase + dCursor, dBase + denseStep).fill(0);
        }
    }
}

export type FrameTimeOrNumber = { num?: number; time?: number };

export class FrameReference {
    private static registry = new FinalizationRegistry<string>((info) => {
        // Runs sometime after the wrapper is GC'd.
        // If we get here, the wrapper was collected without being dereferenced.
        const msg = `Leaked FrameReference (not dereferenced): ${info}\n`;
        // Be noisy. You can escalate to process.abort() if you want to fail hard.
        process.emitWarning(msg, { code: 'FSEQ_FRAME_LEAK' });
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

    get frame(): Uint8Array<ArrayBufferLike> | undefined {
        return this._v;
    }

    get isReleased(): boolean {
        return this.underlyingHandle == undefined;
    }
}

/**
 * Handles fseq prefetching
 */
export class FSeqPrefetchCache {
    constructor(
        arg: {
            now: number;
            fseqSpace?: number;
            decompZstd?: DecompZStd; // Allow a worker thread...
        },
        emitError: (msg: string) => void,
        emitWarning?: (msg: string) => void,
        emitInfo?: (msg: string) => void,
    ) {
        this.now = arg.now;
        this.emitWarning = emitWarning ?? emitError;
        this.emitInfo = emitInfo;
        this.decompDataPool = new ArrayBufferPool();
        this.decompFunc = arg.decompZstd ?? defDecompZStd;
        this.decompPrefetchCache = new PrefetchCache<DecompCacheKey, DecompCacheVal, NeededTimePriority>({
            fetchFunction: async (key, _abort) => {
                // Fetch file data
                let readBuf = this.decompDataPool.get(key.fileLen);
                let readBufReleased = false;
                const isSparse = key.scatterPlan.length > 0;
                const fileChunkLen = key.nframes * key.fileStride;
                const denseChunkLen = key.decompLen; // = nframes * denseStep
                const start = performance.now();
                try {
                    const fh = await fsp.open(key.fseqfile);
                    try {
                        const rlen = await readHandleRange(fh, {
                            buf: readBuf,
                            offset: key.fileOffset,
                            length: key.fileLen,
                        });
                        this.fileReadTimeCumulative += performance.now() - start;
                        if (rlen !== key.fileLen)
                            throw new Error(
                                `File read of ${key.fseqfile} expected ${key.fileLen} bytes but could only read ${rlen}`,
                            );

                        // Non-sparse path: decode (or pass through) straight into the dense buffer;
                        // the file's on-disk frame stride already equals denseStep.
                        if (!isSparse) {
                            if (key.compression === 1) {
                                const dbuf = this.decompDataPool.get(denseChunkLen);
                                if (dbuf.byteLength < denseChunkLen) {
                                    this.emitWarning(
                                        `[fseq] decomp pool buffer smaller than requested: ` +
                                            `file=${key.fseqfile} chunk=${key.chunknum} ` +
                                            `got=${dbuf.byteLength} want=${denseChunkLen}`,
                                    );
                                }
                                const decres = await this.decompFunc(dbuf, readBuf, 0, key.fileLen, denseChunkLen);
                                readBuf = decres.compBuf;
                                return { decompChunk: decres.decompBuf };
                            } else if (key.compression === 2) {
                                throw new Error('Compression type 2 not supported');
                            } else {
                                readBufReleased = true;
                                return { decompChunk: readBuf };
                            }
                        }

                        // Sparse path: decode (or view) file data at fileStride, then scatter into
                        // a dense buffer with gap bytes zeroed.
                        const denseBuf = this.decompDataPool.get(denseChunkLen);
                        let sparseBuf: ArrayBuffer;
                        let sparseBufIsReadBuf = false;
                        if (key.compression === 1) {
                            sparseBuf = this.decompDataPool.get(fileChunkLen);
                            const decres = await this.decompFunc(sparseBuf, readBuf, 0, key.fileLen, fileChunkLen);
                            readBuf = decres.compBuf;
                            sparseBuf = decres.decompBuf;
                            if (sparseBuf.byteLength < fileChunkLen) {
                                this.emitWarning(
                                    `[fseq] sparse decomp returned buffer smaller than expected: ` +
                                        `file=${key.fseqfile} chunk=${key.chunknum} ` +
                                        `got=${sparseBuf.byteLength} want=${fileChunkLen}`,
                                );
                            }
                        } else if (key.compression === 0) {
                            sparseBuf = readBuf;
                            sparseBufIsReadBuf = true;
                        } else {
                            throw new Error('Compression type 2 not supported');
                        }
                        try {
                            scatterChunk(
                                new Uint8Array(denseBuf, 0, denseChunkLen),
                                new Uint8Array(sparseBuf, 0, fileChunkLen),
                                key.nframes,
                                key.fileStride,
                                key.denseStep,
                                key.scatterPlan,
                            );
                        } finally {
                            if (!sparseBufIsReadBuf) this.decompDataPool.release(sparseBuf);
                        }
                        return { decompChunk: denseBuf };
                    } catch (e) {
                        emitError((e as Error).message);
                        throw e;
                    } finally {
                        try {
                            await fh.close();
                        } catch (_e) {}
                    }
                } finally {
                    if (!readBufReleased) this.decompDataPool.release(readBuf);
                }
            },
            budgetPredictor: (key) => key.decompLen,
            budgetCalculator: (key) => key.decompLen,
            keyToId: (key) => `${key.fseqfile}:${key.chunknum}`,
            budgetLimit: arg.fseqSpace ?? 512_000_000,
            maxConcurrency: 4,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => {
                this.decompDataPool.release(v.decompChunk);
            },
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
            key: { fseqfile: req.fseqfile },
            priority: { neededTime: req.needByTime },
            now: this.now,
            expiry: req.expiry ?? this.now + 24 * 3600 * 1000,
        });
    }

    getHeaderInfo(key: FSeqFileKey): { ref?: FSeqFileVal; err?: Error } | undefined {
        const r = this.headerPrefetchCache.reference(key, this.now);
        if (!r) {
            return undefined;
        }
        if (!r.ref) {
            return { err: r.err };
        }
        // These headers are just GC'd
        const rv = { ref: r.ref.v };
        r.ref.release();
        return rv;
    }

    prefetchSeqFrames(req: PrefetchSeqFramesRequest) {
        //console.log(`  PrefetchSeqFrames: ${req.fseqfile} ${req.startFrame}-${req.nFrames}`);
        const hdr = this.getHeaderInfo({ fseqfile: req.fseqfile });
        if (!hdr || !hdr.ref) {
            // We can't prefetch without knowing the
            this.prefetchSeqMetadata(req);
            return;
        }

        for (let cframe = req.startFrame; cframe < req.startFrame + req.nFrames; ) {
            const fk = this.getFrameKey(req.fseqfile, { num: cframe });
            if (!fk) return;
            //console.log(`Prefetch chunk: ${fk.dk.chunknum} ${fk.hdr.chunkMap.index[fk.dk.chunknum].startFrame}-${fk.hdr.chunkMap.index[fk.dk.chunknum].endFrame}`);
            this.decompPrefetchCache.prefetch({
                key: fk.dk,
                now: this.now,
                expiry: req.expiry ?? this.now + 24 * 3600_000,
                priority: { neededTime: req.needByTime + hdr.ref.header.msperframe * (cframe - req.startFrame) },
            });
            cframe = fk.hdr.chunkMap.index[fk.dk.chunknum].endFrame;
        }
    }

    prefetchSeqTimes(req: PrefetchSeqTime) {
        //console.log(`PrefetchSeqTimes: ${req.fseqfile} ${req.startTime}-${req.durationms}`);
        if (req.durationms < 0) return;
        const hdr = this.getHeaderInfo({ fseqfile: req.fseqfile });
        if (!hdr || !hdr.ref) {
            // We can't prefetch without knowing the
            this.prefetchSeqMetadata(req);
            return;
        }
        const sf = Math.floor(req.startTime / hdr.ref.header.msperframe);
        let ef = Math.ceil((req.startTime + req.durationms) / hdr.ref.header.msperframe);
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

    private getFrameKey(fseq: string, frame: { num?: number; time?: number }, needByTime?: number) {
        const hdr = this.getHeaderInfo({ fseqfile: fseq })?.ref;
        if (!hdr) {
            // We can't prefetch without knowing the
            if (needByTime !== undefined) {
                this.prefetchSeqMetadata({ fseqfile: fseq, needByTime: needByTime });
            }
            return;
        }

        if (frame.num === undefined) {
            if (frame.time === undefined) throw new TypeError('Should set frame num or time');
            frame.num = Math.floor(frame.time / hdr.header.msperframe);
        }

        const chunk = hdr.chunkMap.findChunk(frame.num);
        if (chunk === undefined) return undefined;
        const cidx = hdr.chunkMap.index[chunk];

        const nframes = cidx.endFrame - cidx.startFrame;
        const comptype = hdr.header.compression;
        const layout = hdr.layout;

        const dk: DecompCacheKey = {
            fseqfile: fseq,
            chunknum: chunk,
            fileLen: cidx.fileSize,
            fileOffset: cidx.fileOffset,
            decompLen: nframes * layout.denseStep,
            compression: comptype,
            nframes,
            fileStride: layout.fileStride,
            denseStep: layout.denseStep,
            scatterPlan: layout.scatterPlan,
        };
        return { dk, hdr };
    }

    getFrame(fseq: string, frame: FrameTimeOrNumber): { ref?: FrameReference; err?: Error } | undefined {
        const fk = this.getFrameKey(fseq, frame, undefined);
        if (!fk || frame.num === undefined) return undefined;

        // Fetch the chunk and wrap as a frame reference
        const cref = this.decompPrefetchCache.reference(fk.dk, this.now);
        if (!cref) return undefined;
        if (!cref.ref?.v) return { err: cref.err };

        const cnum = fk.dk.chunknum;
        const chunk = fk.hdr.chunkMap.index[cnum];
        const denseStep = fk.hdr.layout.denseStep;
        const frameOffset = (frame.num - chunk.startFrame) * denseStep;
        const decompBytes = cref.ref.v.decompChunk.byteLength;
        if (frameOffset + denseStep > decompBytes) {
            this.emitWarning(
                `[fseq] frame ${frame.num} view out of bounds: ` +
                    `file=${fseq} chunk=${cnum} offset=${frameOffset} denseStep=${denseStep} ` +
                    `decompBuf=${decompBytes} chunkFrames=[${chunk.startFrame},${chunk.endFrame})`,
            );
        }

        return {
            ref: new FrameReference(
                cref.ref,
                new Uint8Array(cref.ref.v.decompChunk, frameOffset, denseStep),
                `${fseq}:${frame}`,
            ),
        };
    }

    dispatch(ageout?: number) {
        this.headerPrefetchCache.cleanupAndDispatchRequests(this.now, this.now - (ageout ?? 60000));

        this.decompPrefetchCache.cleanupAndDispatchRequests(this.now, this.now - (ageout ?? 60000));
    }

    now: number;

    headerPrefetchCache = new PrefetchCache<FSeqFileKey, FSeqFileVal, NeededTimePriority>({
        fetchFunction: async (key, _abort) => {
            const header = await FSEQReaderAsync.readFSEQHeaderAsync(key.fseqfile);
            const chunkMap = new CompBlockCache();
            FSEQReaderAsync.createCompBlockCache(header, chunkMap);
            const layout = computeFileLayout(header);
            if (this.emitInfo) {
                this.emitInfo(
                    `[fseq] opened ${key.fseqfile}; ${summarizeFSEQHeader(header)}; ` +
                        `layout: isSparse=${layout.isSparse} fileStride=${layout.fileStride} denseStep=${layout.denseStep}`,
                );
            }
            return {
                header,
                chunkMap,
                layout,
            };
        },
        budgetPredictor: (_key) => 1,
        budgetCalculator: (_key) => 1,
        keyToId: (key) => `${key.fseqfile}`,
        budgetLimit: 10000,
        maxConcurrency: 2,
        priorityComparator: needTimePriorityCompare,
        onDispose: (_k, _v) => {},
    });

    decompDataPool: ArrayBufferPool;
    decompFunc: DecompZStd;
    decompPrefetchCache: PrefetchCache<DecompCacheKey, DecompCacheVal, NeededTimePriority>;
    fileReadTimeCumulative: number = 0;
    private emitWarning: (msg: string) => void;
    private emitInfo?: (msg: string) => void;

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
        };
    }

    resetStats() {
        this.fileReadTimeCumulative = 0;
        this.headerPrefetchCache.resetStats();
        this.decompPrefetchCache.resetStats();
    }
    // TODO:
    //   Cache invalidation for updated .fseq files?
}
