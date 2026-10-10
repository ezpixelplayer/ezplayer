// AsyncBatchLogger.ts
import { appendFile, rename, rm, stat } from 'node:fs/promises';
import { EOL } from 'node:os';

export interface LoggerOptions {
    filePath: string;
    maxQueue?: number; // default 100
    /** Rotate once the file passes this many bytes (default 20 MB). */
    maxBytes?: number;
    /** Rotated generations to keep as `<file>.1` … `<file>.N` (default 3). */
    keep?: number;
    format?: (line: string) => string; // default timestamp prefix
}

export class AsyncBatchLogger {
    private filePath: string;
    private maxQueue: number;
    private maxBytes: number;
    private keep: number;
    /** Bytes in the current file; seeded from disk, then counted as we append. */
    private bytes: number | undefined;
    private format: (line: string) => string;

    private queue: string[] = [];
    private dropping = 0;
    private totaldrops = 0;

    private flushInFlight: Promise<void> | null = null;
    private closing = false;

    constructor(opts: LoggerOptions) {
        this.filePath = opts.filePath;
        this.maxQueue = opts.maxQueue ?? 100;
        this.maxBytes = opts.maxBytes ?? 20 * 1024 * 1024;
        this.keep = Math.max(1, opts.keep ?? 3);
        this.format = opts.format ?? ((line) => `[${new Date().toISOString()}] ${line}${EOL}`);
    }

    log(line: string): boolean {
        if (this.closing) return false;

        if (this.queue.length >= this.maxQueue) {
            this.dropping++;
            this.totaldrops++;
            return false;
        }

        const out = this.format(line);
        this.queue.push(out);

        // If nothing is flushing or scheduled, schedule a one-shot flush.
        if (!this.flushInFlight) {
            this.kick();
        }

        return true;
    }

    /**
     * Size-based rotation: when the next write would carry the file past `maxBytes`,
     * shift `<file>.N-1` → `<file>.N` … `<file>` → `<file>.1` and start afresh. A show
     * season otherwise grows one file without bound (tens of MB), which makes the log
     * slow to open and read when it is needed most.
     */
    private async rotateIfNeeded(incoming: number): Promise<void> {
        if (this.bytes === undefined) {
            try {
                this.bytes = (await stat(this.filePath)).size;
            } catch {
                this.bytes = 0;
            }
        }
        if (this.bytes + incoming <= this.maxBytes) return;
        try {
            await rm(`${this.filePath}.${this.keep}`, { force: true });
            for (let i = this.keep - 1; i >= 1; i--) {
                try {
                    await rename(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`);
                } catch {
                    /* that generation does not exist */
                }
            }
            await rename(this.filePath, `${this.filePath}.1`);
        } catch (err) {
            console.error('[logger] rotation failed:', err);
        }
        this.bytes = 0;
    }

    /** Internal: start a flush loop if needed */
    private kick() {
        if (this.flushInFlight) return;

        this.flushInFlight = (async () => {
            try {
                while (this.queue.length > 0) {
                    const chunk = this.queue;
                    this.queue = [];
                    if (this.dropping > 0) {
                        const notice = `[${new Date().toISOString()}] [logger] dropped ${this.dropping} lines due to backlog${EOL}`;
                        chunk.push(notice);
                        this.dropping = 0;
                    }
                    const text = chunk.join('');
                    await this.rotateIfNeeded(Buffer.byteLength(text, 'utf8'));
                    await appendFile(this.filePath, text, { encoding: 'utf8', flag: 'a' });
                    this.bytes = (this.bytes ?? 0) + Buffer.byteLength(text, 'utf8');
                    // loop continues if more accumulated during the write
                }
            } catch (e) {
                console.error(e);
            } finally {
                this.flushInFlight = null;
            }
        })();
    }

    getStats() {
        return {
            queued: this.queue.length,
            drops: this.totaldrops,
            flushInFlight: !!this.flushInFlight,
            closing: this.closing,
            maxQueue: this.maxQueue,
        };
    }

    async close(): Promise<void> {
        if (this.closing) return;
        this.closing = true;
        await this.flushInFlight;
    }
}
