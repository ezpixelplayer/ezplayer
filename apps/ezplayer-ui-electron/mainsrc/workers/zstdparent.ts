// parent.ts
import { Worker } from 'worker_threads';
import * as path from 'path';
import { type DecompZStd } from '@ezplayer/epp';

type WorkerOk = {
    id: number;
    ok: true;
    decompBuf: ArrayBuffer;
    compBuf: ArrayBuffer;
};
type WorkerErr = {
    id: number;
    ok: false;
    error: string;
    decompBuf: ArrayBuffer;
    compBuf: ArrayBuffer;
};

let nextId = 1;

const worker = new Worker(path.join(__dirname, './zstdworker.js'), { workerData: 'module' });

export const decompressZStdWithWorker: DecompZStd = (
    decomp: ArrayBuffer,
    comp: ArrayBuffer,
    compOff: number,
    compLen: number,
    expLen: number,
) => {
    const id = nextId++;

    return new Promise((resolve, reject) => {
        const onMessage = (msg: WorkerOk | WorkerErr) => {
            if (msg.id !== id) return;
            worker.off('message', onMessage);

            if (!msg.ok) {
                // The buffers may end up getting GC'd
                // However ... this is a problematic situation w/ a corrupt file or some such...
                reject(new Error(msg.error));
                return;
            }

            // Recreate views on the returned (transferred-back) buffers
            resolve({ decompBuf: msg.decompBuf, compBuf: msg.compBuf });
        };

        worker.on('message', onMessage);

        // Transfer BOTH buffers to the worker (zero-copy). After this, these views are detached here.
        worker.postMessage({ id, expLen, compOff, compLen, decompBuf: decomp, compBuf: comp }, [decomp, comp]);
    });
};
