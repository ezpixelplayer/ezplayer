// zstdWorker.ts
import { parentPort } from 'node:worker_threads';
import { ZSTDDecoder } from 'zstddec';

type InMsg = {
    id: number;
    compOff: number;
    compLen: number;
    expLen: number;
    // Raw buffers only (no Uint8Array), so they are transferable
    decompBuf: ArrayBuffer; // target buffer to fill
    compBuf: ArrayBuffer; // compressed data
};

type OutMsg =
    | { id: number; ok: true; decompBuf: ArrayBuffer; compBuf: ArrayBuffer }
    | { id: number; ok: false; error: string; decompBuf: ArrayBuffer; compBuf: ArrayBuffer };

let decoder: ZSTDDecoder | null = null;

async function ensureDecoder() {
    if (!decoder) {
        decoder = new ZSTDDecoder();
        await decoder.init();
    }
}

if (!parentPort) {
    throw new Error('No parentPort available in worker');
}

parentPort.on('message', async (msg: InMsg) => {
    const { id, expLen, decompBuf, compBuf, compOff, compLen } = msg;

    try {
        await ensureDecoder();

        // Recreate views on the transferred buffers
        const decompView = new Uint8Array(decompBuf);
        const compView = new Uint8Array(compBuf, compOff, compLen);

        // Decode into a temporary view, then copy into caller-provided decompView since zstd does not
        //  accept a passed-in buffer
        const decoded = decoder!.decode(compView, expLen);
        if (decoded.byteLength > decompView.byteLength) {
            throw new Error(
                `Decoded output (${decoded.byteLength}) exceeds provided decomp buffer (${decompView.byteLength})`,
            );
        }
        decompView.set(decoded, 0);

        const out: OutMsg = { id, ok: true, decompBuf, compBuf };
        // Transfer BOTH buffers back so the parent can recycle them
        parentPort!.postMessage(out, [decompBuf, compBuf]);
    } catch (e) {
        const err = e as Error;
        const out: OutMsg = {
            id,
            ok: false,
            error: String(err?.message ?? err),
            decompBuf,
            compBuf,
        };
        // Still transfer buffers back so the parent can recycle them
        parentPort!.postMessage(out, [decompBuf, compBuf]);
    }
});
