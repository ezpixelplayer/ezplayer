/* Conductor-side handle on the output worker. */

import { Worker } from 'node:worker_threads';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import type { CompiledOutput, OpenControllerReport } from '@ezplayer/epp';
import type { OutputWorkerInMsg, OutputWorkerOpenMsg, OutputWorkerOutMsg, SerializedOutput } from './outputprotocol';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Copy an output's tables into SharedArrayBuffers so the worker receives them without a copy. */
export function serializeOutput(o: CompiledOutput): SerializedOutput {
    const shareI = (a: Int32Array) => {
        const v = new Int32Array(new SharedArrayBuffer(Math.max(4, a.byteLength)));
        v.set(a);
        return a.length ? v : new Int32Array(new SharedArrayBuffer(0));
    };
    const shareU = (a: Uint8Array) => {
        const v = new Uint8Array(new SharedArrayBuffer(Math.max(1, a.byteLength)));
        v.set(a);
        return a.length ? v : new Uint8Array(new SharedArrayBuffer(0));
    };
    return { id: o.id, wireBytes: o.wireBytes, ops: shareI(o.ops), luts: shareU(o.luts), perms: shareI(o.perms), policy: o.policy };
}

export class OutputWorkerHandle {
    private worker: Worker;
    private ready: Promise<void>;
    private closed: Promise<void>;
    private resolveClosed: () => void = () => {};
    private pendingOpen: ((r: { reports: (OpenControllerReport | undefined)[]; minFrameTimes: number[] }) => void) | undefined;
    onLog: (level: 'info' | 'warn' | 'error', msg: string) => void = () => {};

    constructor() {
        this.worker = new Worker(path.join(__dirname, './outputworker.js'), { workerData: { name: 'output' } });
        this.closed = new Promise<void>((r) => (this.resolveClosed = r));
        this.ready = new Promise<void>((resolve) => {
            const onMsg = (msg: OutputWorkerOutMsg) => {
                if (msg.type === 'ready') {
                    this.worker.off('message', onMsg);
                    resolve();
                }
            };
            this.worker.on('message', onMsg);
        });
        this.worker.on('message', (msg: OutputWorkerOutMsg) => {
            switch (msg.type) {
                case 'opened':
                    this.pendingOpen?.({ reports: msg.reports, minFrameTimes: msg.minFrameTimes });
                    this.pendingOpen = undefined;
                    break;
                case 'log':
                    this.onLog(msg.level, msg.msg);
                    break;
                case 'closed':
                    this.resolveClosed();
                    break;
            }
        });
        this.worker.on('error', (e) => this.onLog('error', `[output worker] ${e.message}`));
        this.worker.on('exit', () => this.resolveClosed());
    }

    async open(msg: Omit<OutputWorkerOpenMsg, 'type'>) {
        await this.ready;
        return new Promise<{ reports: (OpenControllerReport | undefined)[]; minFrameTimes: number[] }>((resolve) => {
            this.pendingOpen = resolve;
            this.post({ type: 'open', ...msg });
        });
    }

    settings(s: { outputEnabled?: boolean; blackFramesEnabled?: boolean; maxSlotFraction?: number }) {
        this.post({ type: 'settings', ...s });
    }

    /** Ask the worker to finish, send a final black, and exit. */
    async close(timeoutMs = 2000) {
        this.post({ type: 'close' });
        await Promise.race([this.closed, new Promise((r) => setTimeout(r, timeoutMs))]);
        await this.worker.terminate();
    }

    private post(msg: OutputWorkerInMsg) {
        this.worker.postMessage(msg);
    }
}
