// AsyncBatchLogger.ts
import { appendFile } from 'node:fs/promises';
import { EOL } from 'node:os';

export interface LoggerOptions {
    filePath: string;
    maxQueue?: number; // default 100
    format?: (line: string) => string; // default timestamp prefix
}

export class AsyncBatchLogger {
    private filePath: string;
    private maxQueue: number;
    private format: (line: string) => string;

    private queue: string[] = [];
    private dropping = 0;
    private totaldrops = 0;

    private flushInFlight: Promise<void> | null = null;
    private closing = false;

    constructor(opts: LoggerOptions) {
        this.filePath = opts.filePath;
        this.maxQueue = opts.maxQueue ?? 100;
        this.format = opts.format ?? ((line) => `[${new Date().toISOString()}] ${line}${EOL}`);
    }

    log(line: string): boolean {
        if (this.closing) return false;

        if (this.queue.length >= this.maxQueue) {
            this.dropping++;
            this.totaldrops++;
            return false;
        }

        let out = this.format(line);
        this.queue.push(out);

        // If nothing is flushing or scheduled, schedule a one-shot flush.
        if (!this.flushInFlight) {
            this.kick();
        }

        return true;
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
                    await appendFile(this.filePath, chunk.join(''), { encoding: 'utf8', flag: 'a' });
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
