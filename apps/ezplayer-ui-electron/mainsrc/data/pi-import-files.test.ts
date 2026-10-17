import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { copyPiSongFiles } from './pi-import-files';
let temporary: string;
afterEach(async () => {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
});
describe('Pi local song imports', () => {
    it('copies external media and retains it after the source is removed', async () => {
        temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pi-import-'));
        const show = path.join(temporary, 'show');
        await fs.mkdir(show);
        const source = path.join(temporary, 'USB-song.mp3');
        await fs.writeFile(source, 'audio-bytes');
        const original = { audio: source };
        const first = await copyPiSongFiles(show, original);
        expect((await copyPiSongFiles(show, original)).audio).toBe(first.audio);
        expect(original.audio).toBe(source);
        await fs.rm(source);
        expect(await fs.readFile(first.audio!, 'utf8')).toBe('audio-bytes');
        expect((await copyPiSongFiles(show, first)).audio).toBe(first.audio);
    });
});
