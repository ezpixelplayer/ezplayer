/*
 * Extended fseq variable headers: data an `ED` entry points at, stored after
 * the channel data. xLights writes its show files there (`XR` rgbeffects,
 * `XN` networks, `XS` the xsq), zstd-compressed; EZPlayer writes its layout
 * descriptor (`EZ`) the same way.
 */

import { promises as fsp } from 'fs';
import { zstdCompressSync, zstdDecompressSync } from 'node:zlib';
import { ExtendedHeaderRef, FSEQHeader } from './FSeqUtil';

/** xLights embeds these, zstd-compressed. */
export const XL_RGBEFFECTS_HEADER = 'XR';
export const XL_NETWORKS_HEADER = 'XN';
export const XL_SEQUENCE_HEADER = 'XS';

/** Read one extended header's raw bytes. */
export async function readExtendedHeader(fseqfile: string, ref: ExtendedHeaderRef): Promise<Uint8Array> {
    if (ref.length <= 0 || ref.length > 256 * 1024 * 1024) throw new Error(`extended header length ${ref.length} out of range`);
    const fh = await fsp.open(fseqfile, 'r');
    try {
        const buf = new Uint8Array(ref.length);
        let got = 0;
        while (got < ref.length) {
            const { bytesRead } = await fh.read(buf, got, ref.length - got, ref.offset + got);
            if (bytesRead <= 0) throw new Error(`short read of extended header at ${ref.offset}`);
            got += bytesRead;
        }
        return buf;
    } finally {
        await fh.close();
    }
}

/** Zstd magic; xLights compresses every embedded file, but be tolerant of raw data. */
function isZstd(b: Uint8Array): boolean {
    return b.length >= 4 && b[0] === 0x28 && b[1] === 0xb5 && b[2] === 0x2f && b[3] === 0xfd;
}

export function decompressExtended(data: Uint8Array): Uint8Array {
    return isZstd(data) ? new Uint8Array(zstdDecompressSync(data)) : data;
}

export function compressExtended(data: Uint8Array): Uint8Array {
    return new Uint8Array(zstdCompressSync(data));
}

/** Read and decompress an extended header as UTF-8 text, or undefined when absent. */
export async function readExtendedText(fseqfile: string, header: FSEQHeader, code: string): Promise<string | undefined> {
    const ref = header.extendedHeaders[code];
    if (!ref) return undefined;
    return new TextDecoder('utf-8').decode(decompressExtended(await readExtendedHeader(fseqfile, ref)));
}

/**
 * Append extended headers to a file being written. Returns the inline `ED`
 * entries (to place in the header) and the bytes to append after the channel
 * data, given the file offset that data will start at.
 */
export function buildExtendedHeaders(
    entries: { code: string; data: Uint8Array }[],
    dataStartOffset: number,
): { inline: Uint8Array; tail: Uint8Array } {
    const inline = new Uint8Array(entries.length * 18);
    const dv = new DataView(inline.buffer);
    let off = dataStartOffset;
    let total = 0;
    for (const e of entries) total += e.data.length;
    const tail = new Uint8Array(total);
    let tailOff = 0;
    entries.forEach((e, i) => {
        if (e.code.length !== 2) throw new Error(`bad header code ${e.code}`);
        const b = i * 18;
        dv.setUint16(b, 18, true);
        inline[b + 2] = 0x45; // 'E'
        inline[b + 3] = 0x44; // 'D'
        inline[b + 4] = e.code.charCodeAt(0);
        inline[b + 5] = e.code.charCodeAt(1);
        dv.setBigUint64(b + 6, BigInt(off), true);
        dv.setUint32(b + 14, e.data.length, true);
        tail.set(e.data, tailOff);
        tailOff += e.data.length;
        off += e.data.length;
    });
    return { inline, tail };
}
