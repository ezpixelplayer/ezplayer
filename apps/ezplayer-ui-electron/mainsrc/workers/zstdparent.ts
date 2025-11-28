// parent.ts
import { Worker } from 'node:worker_threads';
import * as path from 'path';
import { type DecompZStd } from '@ezplayer/epp';
import { fileURLToPath } from 'node:url';

// Polyfill for `__dirname` in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

type WorkerOk = {
    id: number;
    ok: true;
    decompBuf: ArrayBuffer;
    compBuf: ArrayBuffer;
    decompTime: number;
};
type WorkerErr = {
    id: number;
    ok: false;
    error: string;
    decompBuf: ArrayBuffer;
    compBuf: ArrayBuffer;
};

let nextId = 1;
let decompTime = 0;

const nworkers = 2;
const workers: Worker[] = [];
for (let i=0; i<nworkers; ++i) {
    workers.push(new Worker(path.join(__dirname, './zstdworker.js'), { workerData: {name: 'zstddecode'} }));
}
const inuse: Worker[] = [];

export function getZstdStats() {
    return {
        decompTime,
        nWorkers: nworkers,
    }
}

export const decompressZStdWithWorker: DecompZStd = (
    decomp: ArrayBuffer,
    comp: ArrayBuffer,
    compOff: number,
    compLen: number,
    expLen: number,
) => {
    const id = nextId++;
    const worker = workers.pop();
    if (!worker) throw new Error("Too many outstanding requests");

    return new Promise((resolve, reject) => {
        const onMessage = (msg: WorkerOk | WorkerErr) => {
            workers.push(worker);
            if (msg.id !== id) return;
            worker.off('message', onMessage);

            if (!msg.ok) {
                // The buffers may end up getting GC'd
                // However ... this is a problematic situation w/ a corrupt file or some such...
                reject(new Error(msg.error));
                return;
            }

            decompTime += msg.ok ? msg.decompTime : 0;

            // Recreate views on the returned (transferred-back) buffers
            resolve({ decompBuf: msg.decompBuf, compBuf: msg.compBuf });
        };

        worker.on('message', onMessage);

        // Transfer BOTH buffers to the worker (zero-copy). After this, these views are detached here.
        worker.postMessage({ id, expLen, compOff, compLen, decompBuf: decomp, compBuf: comp }, [decomp, comp]);
    });
};
