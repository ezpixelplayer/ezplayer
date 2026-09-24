import { describe, expect, it } from 'vitest';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Readable } from 'stream';
import type { IncomingMessage } from 'http';
import type { FSEQHeader } from '@ezplayer/epp';
import { fseqMeta, readExactBytes, streamExactBytes } from './file-api';

function asIncoming(stream: Readable): IncomingMessage {
    return stream as unknown as IncomingMessage;
}

async function withTempFile(run: (filePath: string) => Promise<void>): Promise<void> {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-stream-exact-'));
    const filePath = path.join(dir, 'out.bin');
    try {
        await run(filePath);
    } finally {
        await fsp.rm(dir, { recursive: true, force: true });
    }
}

describe('streamExactBytes', () => {
    it('writes an exact byte count from a single chunk', async () => {
        await withTempFile(async (filePath) => {
            const req = new PassThrough();
            const pending = streamExactBytes(asIncoming(req), filePath, 5);
            req.write(Buffer.from('hello!!!!'));
            await pending;
            expect(await fsp.readFile(filePath)).toEqual(Buffer.from('hello'));
        });
    });

    it('writes across multiple chunks and leaves leftovers for the next read', async () => {
        await withTempFile(async (filePath) => {
            const req = new PassThrough();
            const first = streamExactBytes(asIncoming(req), filePath, 4);
            req.write(Buffer.from('ab'));
            req.write(Buffer.from('cdefgh'));
            await first;
            expect(await fsp.readFile(filePath)).toEqual(Buffer.from('abcd'));

            const leftover = await readExactBytes(asIncoming(req), 4);
            expect(leftover).toEqual(Buffer.from('efgh'));
        });
    });

    it('accepts a zero-length read as an empty file', async () => {
        await withTempFile(async (filePath) => {
            const req = new PassThrough();
            await streamExactBytes(asIncoming(req), filePath, 0);
            expect(await fsp.readFile(filePath)).toEqual(Buffer.alloc(0));
        });
    });

    it('rejects when the stream ends before enough bytes arrive', async () => {
        await withTempFile(async (filePath) => {
            const req = new PassThrough();
            const pending = streamExactBytes(asIncoming(req), filePath, 8);
            req.write(Buffer.from('short'));
            req.end();
            await expect(pending).rejects.toMatchObject({
                message: 'Unexpected end of upload body',
                status: 400,
            });
        });
    });

    it('rejects invalid byte counts', async () => {
        await withTempFile(async (filePath) => {
            const req = new PassThrough();
            await expect(streamExactBytes(asIncoming(req), filePath, -1)).rejects.toMatchObject({
                message: 'Invalid byte count',
                status: 400,
            });
        });
    });
});

describe('readExactBytes', () => {
    it('reads a length-prefixed manifest then the following payload', async () => {
        const manifest = Buffer.from(JSON.stringify({ files: [{ name: 'a.fseq', size: 3 }] }), 'utf8');
        const prefix = Buffer.alloc(4);
        prefix.writeUInt32BE(manifest.length, 0);
        const payload = Buffer.from('xyz');
        const req = Readable.from([Buffer.concat([prefix, manifest, payload])]);

        const lenBuf = await readExactBytes(asIncoming(req), 4);
        expect(lenBuf.readUInt32BE(0)).toBe(manifest.length);
        const manifestBuf = await readExactBytes(asIncoming(req), manifest.length);
        expect(JSON.parse(manifestBuf.toString('utf8'))).toEqual({
            files: [{ name: 'a.fseq', size: 3 }],
        });
        const fileBuf = await readExactBytes(asIncoming(req), 3);
        expect(fileBuf).toEqual(payload);
    });
});

describe('fseqMeta (FPP fsequtils -j)', () => {
    const header = (over: Partial<FSEQHeader>): FSEQHeader =>
        ({
            majver: 2,
            minver: 0,
            uuid1: 0x89abcdef,
            uuid2: 0x01234567,
            msperframe: 25,
            frames: 400,
            channels: 900,
            compression: 1,
            nsparseranges: 0,
            chranges: [{ startch: 1, chcount: 900 }],
            headers: {},
            ...over,
        }) as FSEQHeader;

    it('reports a plain v2 file without ranges', () => {
        expect(fseqMeta('Song.fseq', header({}))).toEqual({
            Name: 'Song.fseq',
            Version: '2.0',
            ID: 0x0123456789abcdefn.toString(),
            StepTime: 25,
            NumFrames: 400,
            MaxChannel: 900,
            ChannelCount: 900,
            CompressionType: 1,
            CompressionTypeString: 'zstd',
        });
    });

    it('lists sparse ranges and takes MaxChannel from the highest range end', () => {
        const meta = fseqMeta(
            'Sparse.fseq',
            header({
                channels: 300,
                nsparseranges: 2,
                chranges: [
                    { startch: 0, chcount: 150 },
                    { startch: 5000, chcount: 150 },
                ],
                compression: 2,
            }),
        );
        expect(meta).toMatchObject({
            ChannelCount: 300,
            MaxChannel: 5150,
            Ranges: [
                { Start: 0, Length: 150 },
                { Start: 5000, Length: 150 },
            ],
            CompressionTypeString: 'zlib',
        });
    });

    it('includes variable headers, and v1 files have no compression fields', () => {
        const meta = fseqMeta('Old.fseq', header({ majver: 1, minver: 0, headers: { mf: 'Old.mp3' } }));
        expect(meta.variableHeaders).toEqual({ mf: 'Old.mp3' });
        expect(meta).not.toHaveProperty('CompressionType');
        expect(meta.Version).toBe('1.0');
    });
});
