import { DOMParser } from '@xmldom/xmldom';
import * as fsp from 'fs/promises';

export async function readJsonFile(filePath: string): Promise<unknown> {
    try {
        const data = await fsp.readFile(filePath, { encoding: 'utf8' });
        return JSON.parse(data);
    } catch (error) {
        throw new Error(`Error reading JSON file: ${error}`);
    }
}

export async function loadXmlFile(filePath: string) {
    const xmlContent = await fsp.readFile(filePath, { encoding: 'utf-8' });
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, 'text/xml');
    return xmlDoc;
}

export async function getFileSize(path: string): Promise<number> {
    const stats = await fsp.stat(path);
    return stats.size; // size in bytes
}

export type ReadFileRangeOptions = {
    start: number; // default 0
    length: number; // cannot be used with end
    buffer: Buffer;
    signal?: AbortSignal; // optional AbortController signal
    encoding?: BufferEncoding; // e.g. "utf8" to get a string back
};

export async function readFileRange(path: string, opts: ReadFileRangeOptions) {
    const start = opts.start ?? 0;
    if (start < 0) throw new RangeError('start must be >= 0');

    let length: number = opts.length;
    const buf = opts.buffer;

    const fh = await fsp.open(path, 'r');
    let aborted = false;

    const { signal } = opts;
    const onAbort = () => {
        aborted = true;
    };

    try {
        if (signal?.aborted) {
            throwAbort();
        }
        signal?.addEventListener('abort', onAbort, { once: true });

        let total = 0;
        while (total < length) {
            if (aborted) throwAbort();

            const { bytesRead } = await fh.read(
                buf,
                total, // bufferOffset
                length - total, // length to read this iteration
                start + total, // absolute file position
            );

            if (bytesRead === 0) {
                // Hit EOF before fulfilling the requested range
                throw new RangeError(
                    `EOF before reading requested ${length} bytes from offset ${start} (got ${total}).`,
                );
            }

            total += bytesRead;
        }
    } finally {
        signal?.removeEventListener('abort', onAbort);
        await fh.close().catch(() => {});
    }

    function throwAbort(): never {
        const err = new Error('The operation was aborted');
        (err as any).name = 'AbortError';
        throw err;
    }
}

export async function readHandleRange(
    handle: fsp.FileHandle,
    req: {
        buf: ArrayBuffer;
        offset: number;
        length: number;
        bufoffset?: number;
    },
) {
    let totalBytesRead = 0;
    while (totalBytesRead < req.length) {
        const { bytesRead } = await handle.read(
            new Int8Array(req.buf),
            (req.bufoffset ?? 0) + totalBytesRead,
            req.length - totalBytesRead,
            req.offset + totalBytesRead,
        );

        if (bytesRead === 0) {
            // EOF
            break;
        }

        totalBytesRead += bytesRead;
    }
    return totalBytesRead;
}
