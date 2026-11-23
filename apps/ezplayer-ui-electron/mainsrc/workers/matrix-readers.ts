/*
 * Who is reading model pixels for a virtual matrix, and how fast.
 *
 * Every request for a model's frame is noted here. Rates come from counters
 * sampled over the last few seconds: frames the player made (the pool's seq),
 * frames sent, and frames the reader says it painted.
 */

import type { VirtualMatrixReader } from '@ezplayer/ezplayer-core';

/** Rates are measured over this long. */
const WINDOW_MS = 3000;
const SAMPLE_EVERY_MS = 200;
/** A reader that has not asked for this long is forgotten. */
export const MATRIX_READER_FORGET_MS = 30_000;
/** A reader that has not asked for this long is not running. */
const STALLED_MS = 2500;

export interface MatrixRequest {
    model: string;
    /** The reader's own id; requests without one are told apart by address. */
    client?: string;
    /** The configured output, when the reader is one of the player's windows. */
    output?: string;
    /** Remote address as the server saw it. */
    ip: string;
    /** Latest frame number of the pool at the time of the request. */
    seq: number;
    /** A frame went out with this request. */
    served: boolean;
    /** Frames the reader has painted since it started. */
    painted?: number;
}

interface Sample {
    t: number;
    seq: number;
    served: number;
    painted?: number;
}

interface Reader {
    model: string;
    output?: string;
    address: string;
    lastSeen: number;
    served: number;
    painted?: number;
    samples: Sample[];
}

const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export class MatrixReaders {
    private readonly readers = new Map<string, Reader>();
    private readonly now: () => number;

    constructor(now: () => number = () => performance.now()) {
        this.now = now;
    }

    note(req: MatrixRequest): void {
        const t = this.now();
        const address = LOCAL.has(req.ip) ? 'local' : req.ip.replace(/^::ffff:/, '');
        const key = `${req.model}|${req.client ?? address}`;
        let r = this.readers.get(key);
        // A painted count that went backwards is a reader that started over.
        if (r && req.painted !== undefined && r.painted !== undefined && req.painted < r.painted) r = undefined;
        if (!r) {
            r = { model: req.model, address, lastSeen: t, served: 0, samples: [] };
            this.readers.set(key, r);
        }
        r.output = req.output;
        r.lastSeen = t;
        if (req.served) r.served++;
        if (req.painted !== undefined) r.painted = req.painted;
        const last = r.samples[r.samples.length - 1];
        if (!last || t - last.t >= SAMPLE_EVERY_MS) {
            r.samples.push({ t, seq: req.seq, served: r.served, painted: r.painted });
            while (r.samples.length > 2 && t - r.samples[0].t > WINDOW_MS) r.samples.shift();
        }
    }

    list(): VirtualMatrixReader[] {
        const t = this.now();
        const out: VirtualMatrixReader[] = [];
        for (const [key, r] of this.readers) {
            const idleMs = Math.round(t - r.lastSeen);
            if (idleMs > MATRIX_READER_FORGET_MS) {
                this.readers.delete(key);
                continue;
            }
            const a = r.samples[0];
            const b = r.samples[r.samples.length - 1];
            const seconds = (b.t - a.t) / 1000;
            const live = idleMs < STALLED_MS && seconds >= 0.5;
            const rate = (n: number) => (live ? Math.round((n / seconds) * 10) / 10 : 0);
            out.push({
                model: r.model,
                output: r.output,
                address: r.address,
                idleMs,
                // seq is a wrapping 32-bit counter.
                sourceFps: rate((b.seq - a.seq) | 0),
                servedFps: rate(b.served - a.served),
                paintedFps:
                    a.painted !== undefined && b.painted !== undefined ? rate(b.painted - a.painted) : undefined,
            });
        }
        return out.sort((x, y) => x.model.localeCompare(y.model) || x.address.localeCompare(y.address));
    }
}
