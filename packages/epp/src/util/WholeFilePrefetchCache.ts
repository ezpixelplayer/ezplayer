import { BufferPool } from "./BufferRecycler";
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache } from "./PrefetchCache";
import { getFileSize, readFileRange } from './FileUtil';

export interface FileCacheKey {
    filename: string;
};

export interface FileCacheValue {
    data: Buffer;
};

export class WholeFilePrefetchCache extends PrefetchCache<FileCacheKey, FileCacheValue, NeededTimePriority> {
    constructor(readonly pool: BufferPool) {
        super({
            fetchFunction: async (key, abort) => {
                const len = await getFileSize(key.filename);
                const buf = pool.get(len);
                await readFileRange(key.filename, {
                    start: 0,
                    length: len,
                    signal: abort,
                    buffer: buf,
                });
                return {data: buf};
            },
            budgetPredictor: (_key) => 10000000,
            budgetCalculator: (_key, val) => val.data.byteLength,
            keyToId: (key) => `${key.filename}`,
            budgetLimit: 100000000,
            maxConcurrency: 2,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => { pool.release(v.data); }
        });
    }
}

