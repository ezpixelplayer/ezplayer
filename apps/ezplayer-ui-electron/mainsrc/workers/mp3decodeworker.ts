import { parentPort } from 'node:worker_threads';
import * as fsp from 'node:fs/promises';
import { Buffer } from 'node:buffer';
// If you were using the WebWorker-flavored wrapper before, switch to the direct WASM decoder here.
import { MPEGDecoder } from 'mpg123-decoder';
import { getFileSize } from '@ezplayer/epp';

import {getHeapStatistics} from 'node:v8';

//import { setThreadAffinity } from '../affinity/affinity.js';
//setThreadAffinity([5,6,7,8]);

if (!parentPort) {
    throw new Error('mp3Worker must be run as a worker thread.');
}

console.log(`Decode worker start...`);

export type DecodeReq =
{
    type: 'decode';
    id: number;
    filePath: string;
} | {
    type: 'return';
    buffers: Float32Array<ArrayBuffer>[],
};

const decoder = new MPEGDecoder();
let readyPromise: Promise<void> | null = null;

function decoderReady() {
    if (!readyPromise) {
        readyPromise = decoder.ready;
    }
    return readyPromise;
}

export type DecodedAudio = {
    sampleRate: number,
    nSamples: number,
    channelData: Float32Array<ArrayBuffer>[],
};

export type DecodedAudioResp = {
    type: 'result';
    id: number;
    ok: boolean;
    error?: string;
    result?: DecodedAudio;
    fileReadTime: number;
    decodeTime: number;
};

let scratchBuf: Buffer | null = Buffer.allocUnsafe(32000000);

function getScratchBuf(size: number) {
  if (!scratchBuf || scratchBuf.byteLength < size) {
    scratchBuf = Buffer.allocUnsafe(size);
  }
  return scratchBuf;
}

parentPort.on('message', async (msg: DecodeReq) => {
    const { type } = msg;
    if (type !== 'decode') return;
    const {id, filePath} = msg;

    try {
        const fileLen = await getFileSize(filePath);
        const nodeBuf = getScratchBuf(fileLen);

        const startRead = performance.now();
        //console.log(`Start thread read of ${filePath}`);
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
        const fileReadTime = performance.now() - startRead;
        //console.log(`End read of ${filePath}; took ${fileReadTime}`);

        // Decode (mpg123-decoder expects a Uint8Array)
        const decodeStart = performance.now();
        await decoder.reset();
        const decomp = decoder.decode(nodeBuf.subarray(0, fileLen));
        const decodeTime = performance.now() - decodeStart;

        if (decomp.errors?.length) {
            const e = decomp.errors[0];
            console.error(`MP3 Decode error: ${e.message} @${e.inputBytes}`);
            throw new Error(`MP3 Decode error: ${e.message} @${e.inputBytes}`);
        }

        try {
            const mrv = {
                channelData: decomp.channelData.map((v)=>new Float32Array(v)),
                sampleRate: decomp.sampleRate,
                nSamples: decomp.samplesDecoded,
            };

            parentPort!.postMessage({
                type: 'result',
                id,
                ok: true,
                result: mrv,
                fileReadTime: fileReadTime,
                decodeTime,
            } satisfies DecodedAudioResp, mrv.channelData.map((v)=>v.buffer));
        }
        catch (e) {
            const err = e as Error;
            const hi = getHeapStatistics();
            console.log(`V8 Heap Size Limit: ${hi.heap_size_limit / (1024 * 1024)} MB`);
            console.error(`Allocation of result failed (${err.message}); # elements is ${decomp.channelData[0]?.length}`);
            throw e;
        }
    } catch (err: any) {
        console.error(err);
        // Return mp3 buffer if we still own it so the main thread can reclaim
        try {
            parentPort!.postMessage({ type: 'result', id, ok: false, error: String(err), decodeTime: 0, fileReadTime: 0 } satisfies DecodedAudioResp);
        } catch {
            parentPort!.postMessage({ type: 'result', id, ok: false, error: String(err), decodeTime: 0, fileReadTime: 0 } satisfies DecodedAudioResp);
        }
    }
});
