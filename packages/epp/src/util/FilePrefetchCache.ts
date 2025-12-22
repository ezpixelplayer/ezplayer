import { BufferPool } from './BufferRecycler';
import { NeededTimePriority, needTimePriorityCompare, PrefetchCache } from './PrefetchCache';
import { readFileRange } from './FileUtil';

export interface FileCacheKey {
    filename: string;
    offset: number;
    length: number;
}

export interface FileCacheValue {
    data: Buffer;
}

export class FilePrefetchCache extends PrefetchCache<FileCacheKey, FileCacheValue, NeededTimePriority> {
    constructor(readonly pool: BufferPool) {
        super({
            fetchFunction: async (key, abort) => {
                const buf = pool.get(key.length);
                await readFileRange(key.filename, {
                    start: key.offset,
                    length: key.length,
                    signal: abort,
                    buffer: buf,
                });
                return { data: buf };
            },
            budgetPredictor: (key) => key.length,
            budgetCalculator: (key) => key.length,
            keyToId: (key) => `${key.filename}|${key.offset}|${key.length}`,
            budgetLimit: 100000000,
            maxConcurrency: 2,
            priorityComparator: needTimePriorityCompare,
            onDispose: (_k, v) => {
                pool.release(v.data);
            },
        });
    }
}
