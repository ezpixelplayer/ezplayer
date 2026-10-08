import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { FSEQReaderAsync, type FSEQHeader } from '@ezplayer/epp';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import { batchUploadImportSequencesCore } from './file-api';
vi.mock('../data/derived-audio.js', () => ({ deriveAudioForRecord: async () => undefined }));
function upload(files: { name: string; data: string }[]): IncomingMessage {
    const manifest = Buffer.from(
        JSON.stringify({ files: files.map((f) => ({ name: f.name, size: Buffer.byteLength(f.data) })) }),
    );
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(manifest.length);
    return Readable.from([
        Buffer.concat([prefix, manifest, ...files.map((f) => Buffer.from(f.data))]),
    ]) as unknown as IncomingMessage;
}
afterEach(() => vi.restoreAllMocks());
describe('LAN files arriving separately', () => {
    it.each(['audio-first', 'sequence-first'])('matches Windows header paths with %s uploads', async (order) => {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-separate-'));
        const catalog: SequenceRecord[] = [];
        vi.spyOn(FSEQReaderAsync, 'readFSEQHeaderAsync').mockResolvedValue({
            frames: 100,
            msperframe: 50,
            headers: { mf: 'D:\\Dropbox\\Music\\Song.mp3' },
        } as unknown as FSEQHeader);
        const deps = {
            getShowFolder: () => folder,
            getSequences: () => catalog,
            putSequences: async (records: unknown[]) => {
                for (const rec of records as SequenceRecord[]) {
                    const index = catalog.findIndex((s) => s.id === rec.id);
                    if (index < 0) catalog.push(rec);
                    else catalog[index] = rec;
                }
                return records;
            },
        };
        try {
            const sequence = { name: 'Different-sequence-name.fseq', data: 'test-fseq' };
            const audio = { name: 'Song.mp3', data: 'test-audio' };
            expect(
                (
                    await batchUploadImportSequencesCore(
                        folder,
                        deps,
                        upload([order === 'audio-first' ? audio : sequence]),
                    )
                ).status,
            ).toBe(200);
            const originalId = catalog[0]?.id;
            if (order === 'sequence-first') expect(catalog[0].files?.audio).toBeUndefined();
            expect(
                (
                    await batchUploadImportSequencesCore(
                        folder,
                        deps,
                        upload([order === 'audio-first' ? sequence : audio]),
                    )
                ).status,
            ).toBe(200);
            expect(catalog).toHaveLength(1);
            expect(catalog[0].files?.audio).toBe(path.join(folder, 'Song.mp3'));
            if (originalId) expect(catalog[0].id).toBe(originalId);
            expect(await fs.readFile(path.join(folder, 'Song.mp3'), 'utf8')).toBe('test-audio');
        } finally {
            await fs.rm(folder, { recursive: true, force: true });
        }
    });
    it('accepts video-only uploads', async () => {
        const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-video-'));
        try {
            const result = await batchUploadImportSequencesCore(
                folder,
                { getShowFolder: () => folder, getSequences: () => [], putSequences: async (r) => r },
                upload([{ name: 'Intro.mp4', data: 'video-bytes' }]),
            );
            expect(result.status).toBe(200);
            expect(await fs.readFile(path.join(folder, 'Intro.mp4'), 'utf8')).toBe('video-bytes');
        } finally {
            await fs.rm(folder, { recursive: true, force: true });
        }
    });
});
