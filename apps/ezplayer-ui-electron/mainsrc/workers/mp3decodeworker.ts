import { parentPort } from 'node:worker_threads';
import * as fsp from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import { MPEGDecoder } from 'mpg123-decoder-ezp';
import { getFileSize } from '@ezplayer/epp';

import { getHeapStatistics } from 'node:v8';

//import { setThreadAffinity } from '../affinity/affinity.js';
//setThreadAffinity([5,6,7,8]);

class ListPool {
    private list: ArrayBuffer[] = [];

    take(): ArrayBuffer | null {
        if (!this.list.length) return null;
        const item = this.list[this.list.length - 1];
        this.list.pop();
        return item;
    }

    give(item: ArrayBuffer) {
        this.list.push(item);
    }

    size() {
        return this.list.length;
    }

    bytes() {
        let sum = 0;
        for (const i of this.list) sum += i.byteLength;
    }
}

const pool = new ListPool();
let suggestedMaxAudioDur: number | undefined = undefined; // 15*60;
function getAudioReserveDur() {
    return suggestedMaxAudioDur || 15 * 60;
}

function getOrAllocate() {
    const e = pool.take();
    if (e) return e;
    return new ArrayBuffer(getAudioReserveDur() * 50_000 * 4);
}
function bufferTooSmall(b: ArrayBuffer) {
    if (b.byteLength >= getAudioReserveDur() * 50_000 * 4) {
        suggestedMaxAudioDur = getAudioReserveDur() * 2;
    }
    // Otherwise this was not full size.
    // Leak this.
    // Should we cap this?
}

if (!parentPort) {
    throw new Error('mp3decodeworker must be run as a worker thread.');
}

console.log(`Decode worker start...`);

export type DecodeReq =
    | {
          type: 'decode';
          id: number;
          filePath: string;
          suggestedMaxAudioDur?: number;
      }
    | {
          type: 'return';
          buffers: ArrayBuffer[];
      };

const decoder = new MPEGDecoder();

export type DecodedAudio = {
    sampleRate: number;
    nSamples: number;
    channelData: Float32Array<ArrayBuffer>[];
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
    if (type === 'return') {
        for (const b of msg.buffers) {
            pool.give(b);
        }
        return;
    }

    if (type !== 'decode') return;
    const { id, filePath, suggestedMaxAudioDur: smad } = msg;
    if (smad) {
        if (!suggestedMaxAudioDur || suggestedMaxAudioDur < smad) {
            suggestedMaxAudioDur = smad;
        }
    }

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
        await decoder.ready;

        // Retry loop: if too small, discard the pair, double cap, allocate a new one
        // (or try the pool again first — optional)
        while (true) {
            // Must reset before retry because decoder state advanced
            await decoder.reset();

            const ldata = getOrAllocate();
            const rdata = getOrAllocate();

            const lsamp = new Float32Array(ldata);
            const rsamp = new Float32Array(rdata);

            const res = decoder.decodeIntoChunks(nodeBuf.subarray(0, fileLen), [lsamp], [rsamp], { allowPartial: true });

            const decodeTime = performance.now() - decodeStart;

            if (res.errors?.length) {
                const e = res.errors[0];
                console.error(`MP3 Decode error: ${e.message} @${e.inputBytes}`);
                throw new Error(`MP3 Decode error: ${e.message} @${e.inputBytes}`);
            }

            if (!res.truncated) {
                const mrv = {
                    channelData: [lsamp, rsamp],
                    sampleRate: res.sampleRate,
                    nSamples: res.samplesDecoded,
                };
                parentPort!.postMessage(
                    {
                        type: 'result',
                        id,
                        ok: true,
                        result: mrv,
                        fileReadTime: fileReadTime,
                        decodeTime,
                        kind: 'decoded',
                    },
                    [ldata, rdata],
                );
                return;
            }

            // Too small: discard these buffers (do NOT return to pool)
            bufferTooSmall(ldata.byteLength < rdata.byteLength ? ldata : rdata);
        }
    } catch (err) {
        console.error(err);
        // Return mp3 buffer if we still own it so the main thread can reclaim
        try {
            parentPort!.postMessage({
                type: 'result',
                id,
                ok: false,
                error: String(err),
                decodeTime: 0,
                fileReadTime: 0,
            } satisfies DecodedAudioResp);
        } catch {
            console.error(err);
        }
    }
});
