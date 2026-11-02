import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { FSEQReaderAsync, type FSEQHeader } from '@ezplayer/epp';
import type { BatchImportSummary, SequenceRecord } from '@ezplayer/ezplayer-core';
import { batchUploadImportSequencesCore } from './file-api';

vi.mock('../data/derived-audio.js', () => ({ deriveAudioForRecord: async () => undefined }));

/** Body framing of the batch-upload-import route: u32 manifest length, manifest, file bytes. */
function upload(files: { name: string; data: string }[], importFseqNames?: string[]): IncomingMessage {
    const manifest = Buffer.from(
        JSON.stringify({
            files: files.map((f) => ({ name: f.name, size: Buffer.byteLength(f.data) })),
            companionAudioNames: files.filter((f) => f.name.endsWith('.mp3')).map((f) => f.name),
            ...(importFseqNames ? { importFseqNames } : {}),
        }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(manifest.length);
    return Readable.from([
        Buffer.concat([prefix, manifest, ...files.map((f) => Buffer.from(f.data))]),
    ]) as unknown as IncomingMessage;
}

function makeDeps(catalog: SequenceRecord[], folder: string) {
    return {
        getShowFolder: () => folder,
        getSequences: () => catalog,
        putSequences: async (records: unknown[]) => {
            catalog.push(...(records as SequenceRecord[]));
            return records;
        },
    };
}

afterEach(() => vi.restoreAllMocks());

describe('bulk upload import set', () => {
    it('stores files without adding songs when the import list is empty', async () => {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-bulk-'));
        const catalog: SequenceRecord[] = [];
        try {
            const result = await batchUploadImportSequencesCore(
                folder,
                makeDeps(catalog, folder),
                upload(
                    [
                        { name: 'Waiting.fseq', data: 'fseq-bytes' },
                        { name: 'Loose.mp3', data: 'audio-bytes' },
                    ],
                    [],
                ),
            );
            expect(result.status).toBe(200);
            expect(result.body).toEqual({
                total: 0,
                imported: 0,
                failed: 0,
                successes: [],
                failures: [],
                uploadedFiles: ['Waiting.fseq', 'Loose.mp3'],
            });
            expect(catalog).toHaveLength(0);
            expect(await fs.readFile(path.join(folder, 'Waiting.fseq'), 'utf8')).toBe('fseq-bytes');
            expect(await fs.readFile(path.join(folder, 'Loose.mp3'), 'utf8')).toBe('audio-bytes');
        } finally {
            await fs.rm(folder, { recursive: true, force: true });
        }
    });

    it('imports only the listed FSEQs and reports every file written', async () => {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-bulk-'));
        const catalog: SequenceRecord[] = [];
        vi.spyOn(FSEQReaderAsync, 'readFSEQHeaderAsync').mockResolvedValue({
            frames: 100,
            msperframe: 50,
            headers: {},
        } as unknown as FSEQHeader);
        try {
            const result = await batchUploadImportSequencesCore(
                folder,
                makeDeps(catalog, folder),
                upload(
                    [
                        { name: 'Ready.fseq', data: 'ready' },
                        { name: 'Waiting.fseq', data: 'waiting' },
                    ],
                    ['Ready.fseq'],
                ),
            );
            expect(result.status).toBe(200);
            const summary = result.body as BatchImportSummary;
            expect(summary.imported).toBe(1);
            expect(summary.successes.map((s) => s.fseqName)).toEqual(['Ready.fseq']);
            expect(summary.uploadedFiles).toEqual(['Ready.fseq', 'Waiting.fseq']);
            expect(catalog.map((s) => path.basename(s.files!.fseq!))).toEqual(['Ready.fseq']);
        } finally {
            await fs.rm(folder, { recursive: true, force: true });
        }
    });

    it('still imports every uploaded FSEQ when no import list is given', async () => {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-bulk-'));
        const catalog: SequenceRecord[] = [];
        vi.spyOn(FSEQReaderAsync, 'readFSEQHeaderAsync').mockResolvedValue({
            frames: 100,
            msperframe: 50,
            headers: {},
        } as unknown as FSEQHeader);
        try {
            const result = await batchUploadImportSequencesCore(
                folder,
                makeDeps(catalog, folder),
                upload([
                    { name: 'One.fseq', data: 'one' },
                    { name: 'Two.fseq', data: 'two' },
                ]),
            );
            expect(result.status).toBe(200);
            expect((result.body as BatchImportSummary).imported).toBe(2);
            expect((result.body as BatchImportSummary).uploadedFiles).toEqual(['One.fseq', 'Two.fseq']);
        } finally {
            await fs.rm(folder, { recursive: true, force: true });
        }
    });

    it('rejects an upload with nothing to import unless told to store it', async () => {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-bulk-'));
        try {
            const result = await batchUploadImportSequencesCore(
                folder,
                makeDeps([], folder),
                upload([{ name: 'Loose.mp3', data: 'audio' }]),
            );
            expect(result.status).toBe(400);
        } finally {
            await fs.rm(folder, { recursive: true, force: true });
        }
    });
});
