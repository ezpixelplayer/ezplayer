import { parentPort } from 'node:worker_threads';
import * as fsp from 'node:fs/promises';
import { Buffer } from 'node:buffer';
// If you were using the WebWorker-flavored wrapper before, switch to the direct WASM decoder here.
import { MPEGDecodedAudio, MPEGDecoder } from 'mpg123-decoder'; // same lib, non-WebWorker API
import { getFileSize } from '@ezplayer/epp';

import { setThreadAffinity } from '../affinity/affinity.js';
setThreadAffinity([5,6,7,8]);

if (!parentPort) {
    throw new Error('mp3Worker must be run as a worker thread.');
}

console.log(`Decode worker start...`);

export type DecodeReq = {
    type: 'decode';
    id: number;
    filePath: string;
};

const decoder = new MPEGDecoder();
let readyPromise: Promise<void> | null = null;

function decoderReady() {
    if (!readyPromise) {
        readyPromise = decoder.ready;
    }
    return readyPromise;
}

export type DecodedAudioResp = {
    type: 'result';
    id: number;
    ok: boolean;
    error?: string;
    result?: MPEGDecodedAudio;
};

parentPort.on('message', async (msg: DecodeReq) => {
    const { id, filePath } = msg;

    try {
        await decoder.reset();

        const fileLen = await getFileSize(filePath);
        const nodeBuf = Buffer.alloc(fileLen);

        const fh = await fsp.open(filePath, 'r');
        try {
            let offset = 0;
            while (offset < fileLen) {
                const { bytesRead } = await fh.read(nodeBuf, offset, Math.min(1 << 20, fileLen - offset), offset);
                if (bytesRead === 0) break;
                offset += bytesRead;
            }
            if (offset !== fileLen) {
                throw new Error(`File read of ${filePath} expected ${fileLen} bytes but read ${offset}`);
            }
        } finally {
            try {
                await fh.close();
            } catch {}
        }

        // Decode (mpg123-decoder expects a Uint8Array)
        const decomp = decoder.decode(nodeBuf);

        if (decomp.errors?.length) {
            const e = decomp.errors[0];
            console.error(`MP3 Decode error: ${e.message} @${e.inputBytes}`);
            throw new Error(`MP3 Decode error: ${e.message} @${e.inputBytes}`);
        }

        parentPort!.postMessage({
            type: 'result',
            id,
            ok: true,
            result: decomp,
        } satisfies DecodedAudioResp);
    } catch (err: any) {
        console.error(err);
        // Return mp3 buffer if we still own it so the main thread can reclaim
        try {
            parentPort!.postMessage({ type: 'result', id, ok: false, error: String(err) } satisfies DecodedAudioResp);
        } catch {
            parentPort!.postMessage({ type: 'result', id, ok: false, error: String(err) } satisfies DecodedAudioResp);
        }
    }
});
