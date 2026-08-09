import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fsp from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    createDirectory,
    deletePath,
    listDirectory,
    movePath,
    readChunk,
    resolveInShow,
    ShowFolderError,
    statEntry,
    writeChunk,
} from './showfolder-fs.js';

let showFolder: string;
/** A sibling directory that nothing inside the show folder may reach. */
let outside: string;

beforeEach(async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-fs-'));
    showFolder = path.join(base, 'show');
    outside = path.join(base, 'outside');
    await fsp.mkdir(showFolder);
    await fsp.mkdir(outside);
    await fsp.mkdir(path.join(showFolder, '.ezplayer'));
    await fsp.writeFile(path.join(showFolder, '.ezplayer', 'remote-access.json'), '{"secret":true}');
    await fsp.writeFile(path.join(showFolder, 'xlights_rgbeffects.xml'), '<xrgb/>');
    await fsp.writeFile(path.join(showFolder, 'song.mp3'), 'audio-bytes');
    await fsp.mkdir(path.join(showFolder, 'music'));
    await fsp.writeFile(path.join(showFolder, 'music', 'track.mp3'), 'more-audio');
    await fsp.writeFile(path.join(outside, 'secrets.txt'), 'TOP SECRET');
});

afterEach(async () => {
    await fsp.rm(path.dirname(showFolder), { recursive: true, force: true });
});

/** Symlink creation needs elevation or Developer Mode on Windows; skip those
 *  assertions where it isn't permitted rather than failing the suite. */
async function trySymlink(target: string, link: string, type?: 'dir' | 'file'): Promise<boolean> {
    try {
        await fsp.symlink(target, link, type);
        return true;
    } catch {
        return false;
    }
}

async function expectRejected(p: Promise<unknown>, code: ShowFolderError['code']): Promise<void> {
    await expect(p).rejects.toMatchObject({ name: 'ShowFolderError', code });
}

describe('show-folder path containment', () => {
    it('resolves ordinary relative paths inside the show folder', async () => {
        const abs = await resolveInShow(showFolder, 'music/track.mp3', { mustExist: true });
        expect(abs).toBe(path.join(await fsp.realpath(showFolder), 'music', 'track.mp3'));
    });

    it('rejects .. traversal', async () => {
        await expectRejected(resolveInShow(showFolder, '../outside/secrets.txt'), 'invalid-path');
        await expectRejected(resolveInShow(showFolder, 'music/../../outside/secrets.txt'), 'invalid-path');
        await expectRejected(resolveInShow(showFolder, '..'), 'invalid-path');
    });

    it('rejects absolute paths, POSIX and Windows alike', async () => {
        await expectRejected(resolveInShow(showFolder, '/etc/passwd'), 'invalid-path');
        await expectRejected(resolveInShow(showFolder, 'C:\\Windows\\System32\\config'), 'invalid-path');
        await expectRejected(resolveInShow(showFolder, '\\\\server\\share'), 'invalid-path');
    });

    it('refuses the .ezplayer settings folder and everything in it', async () => {
        await expectRejected(resolveInShow(showFolder, '.ezplayer'), 'forbidden');
        await expectRejected(resolveInShow(showFolder, '.ezplayer/remote-access.json'), 'forbidden');
        // Backslashes are normalized first, so this is the same path.
        await expectRejected(resolveInShow(showFolder, '.ezplayer\\remote-access.json'), 'forbidden');
    });

    it('rejects NUL bytes and alternate-data-stream names', async () => {
        await expectRejected(resolveInShow(showFolder, 'song.mp3:hidden'), 'invalid-path');
        await expectRejected(resolveInShow(showFolder, 'bad\0name'), 'invalid-path');
    });

    it('rejects Windows reserved device names', async () => {
        await expectRejected(resolveInShow(showFolder, 'CON'), 'invalid-path');
        await expectRejected(resolveInShow(showFolder, 'music/lpt1.txt'), 'invalid-path');
    });

    it('refuses to follow a symlink that escapes the show folder', async () => {
        const link = path.join(showFolder, 'escape.txt');
        if (!(await trySymlink(path.join(outside, 'secrets.txt'), link, 'file'))) return;
        await expectRejected(resolveInShow(showFolder, 'escape.txt', { mustExist: true }), 'forbidden');
        await expectRejected(readChunk(showFolder, 'escape.txt', 0, 100), 'forbidden');
    });

    it('refuses to write through a directory symlink that escapes', async () => {
        const link = path.join(showFolder, 'out');
        if (!(await trySymlink(outside, link, 'dir'))) return;
        await expectRejected(resolveInShow(showFolder, 'out/planted.txt'), 'forbidden');
        await expectRejected(writeChunk(showFolder, 'out/planted.txt', 0, Buffer.from('x')), 'forbidden');
        // And the escape must not have happened anyway.
        await expect(fsp.stat(path.join(outside, 'planted.txt'))).rejects.toThrow();
    });

    it('hides escaping symlinks from listings rather than showing an unusable entry', async () => {
        if (!(await trySymlink(path.join(outside, 'secrets.txt'), path.join(showFolder, 'escape.txt'), 'file'))) return;
        const names = (await listDirectory(showFolder, '')).map((e) => e.name);
        expect(names).not.toContain('escape.txt');
    });

    it('reports no show folder rather than resolving against the process cwd', async () => {
        await expectRejected(resolveInShow(undefined, 'song.mp3'), 'no-show-folder');
    });
});

describe('listing', () => {
    it('lists entries with kind, size and mtime, directories first', async () => {
        const entries = await listDirectory(showFolder, '');
        expect(entries.map((e) => e.name)).toEqual(['music', 'song.mp3', 'xlights_rgbeffects.xml']);
        const music = entries[0];
        expect(music.kind).toBe('directory');
        const song = entries.find((e) => e.name === 'song.mp3')!;
        expect(song.kind).toBe('file');
        expect(song.sizeBytes).toBe('audio-bytes'.length);
        expect(song.modified).toBeGreaterThan(0);
    });

    it("never lists EZPlayer's own files", async () => {
        // The lock files sit next to the settings dir and are equally not the
        // user's to manage.
        await fsp.writeFile(path.join(showFolder, '.ezplayer-folder.lock'), 'lock');
        await fsp.mkdir(path.join(showFolder, '.ezplayer-folder.lock.lock'));
        const names = (await listDirectory(showFolder, '')).map((e) => e.name);
        expect(names).not.toContain('.ezplayer');
        expect(names).not.toContain('.ezplayer-folder.lock');
        expect(names).not.toContain('.ezplayer-folder.lock.lock');
    });

    it("keeps the user's own dotfiles visible", async () => {
        await fsp.writeFile(path.join(showFolder, '.myconfig'), 'mine');
        const names = (await listDirectory(showFolder, '')).map((e) => e.name);
        expect(names).toContain('.myconfig');
    });

    it("refuses to touch EZPlayer's lock files", async () => {
        await fsp.writeFile(path.join(showFolder, '.ezplayer-folder.lock'), 'lock');
        await expectRejected(deletePath(showFolder, '.ezplayer-folder.lock'), 'forbidden');
        await expectRejected(readChunk(showFolder, '.ezplayer-folder.lock', 0, 10), 'forbidden');
    });

    it('marks xLights files as protected', async () => {
        const entries = await listDirectory(showFolder, '');
        expect(entries.find((e) => e.name === 'xlights_rgbeffects.xml')?.protected).toBe(true);
        expect(entries.find((e) => e.name === 'song.mp3')?.protected).toBe(false);
    });

    it('lists a subdirectory with paths relative to the show root', async () => {
        const entries = await listDirectory(showFolder, 'music');
        expect(entries).toHaveLength(1);
        expect(entries[0].path).toBe('music/track.mp3');
    });

    it('fails cleanly on a missing folder', async () => {
        await expectRejected(listDirectory(showFolder, 'nope'), 'not-found');
    });
});

describe('mutations', () => {
    it('creates a folder and refuses to create it twice', async () => {
        await createDirectory(showFolder, 'images');
        expect((await statEntry(showFolder, 'images')).kind).toBe('directory');
        await expectRejected(createDirectory(showFolder, 'images'), 'exists');
    });

    it('renames a file', async () => {
        await movePath(showFolder, 'song.mp3', 'renamed.mp3');
        const names = (await listDirectory(showFolder, '')).map((e) => e.name);
        expect(names).toContain('renamed.mp3');
        expect(names).not.toContain('song.mp3');
    });

    it('moves a file into a subfolder', async () => {
        await movePath(showFolder, 'song.mp3', 'music/song.mp3');
        expect((await listDirectory(showFolder, 'music')).map((e) => e.name).sort()).toEqual(['song.mp3', 'track.mp3']);
    });

    it('refuses to overwrite an existing name on move', async () => {
        await writeChunk(showFolder, 'music/song.mp3', 0, Buffer.from('existing'));
        await expectRejected(movePath(showFolder, 'song.mp3', 'music/song.mp3'), 'exists');
        // The original must still be there.
        expect((await statEntry(showFolder, 'song.mp3')).kind).toBe('file');
    });

    it('refuses to move a folder inside itself', async () => {
        await expectRejected(movePath(showFolder, 'music', 'music/nested'), 'invalid-path');
    });

    it('refuses to rename, move or delete xLights files', async () => {
        await expectRejected(movePath(showFolder, 'xlights_rgbeffects.xml', 'oops.xml'), 'forbidden');
        await expectRejected(deletePath(showFolder, 'xlights_rgbeffects.xml'), 'forbidden');
        await expectRejected(writeChunk(showFolder, 'xlights_networks.xml', 0, Buffer.from('x')), 'forbidden');
    });

    it('refuses to delete the show folder itself', async () => {
        await expectRejected(deletePath(showFolder, ''), 'forbidden');
    });

    it('deletes a file, and a folder only when told to recurse', async () => {
        await deletePath(showFolder, 'song.mp3');
        await expectRejected(statEntry(showFolder, 'song.mp3'), 'not-found');
        await expectRejected(deletePath(showFolder, 'music'), 'io'); // not empty
        await deletePath(showFolder, 'music', { recursive: true });
        await expectRejected(statEntry(showFolder, 'music'), 'not-found');
    });

    it('cannot delete anything in .ezplayer', async () => {
        await expectRejected(deletePath(showFolder, '.ezplayer/remote-access.json'), 'forbidden');
        // The file must survive.
        await expect(fsp.readFile(path.join(showFolder, '.ezplayer', 'remote-access.json'), 'utf8')).resolves.toContain(
            'secret',
        );
    });
});

describe('read and write', () => {
    it('round-trips a file through chunked writes and reads', async () => {
        const payload = Buffer.from('0123456789abcdefghij');
        await writeChunk(showFolder, 'uploaded.bin', 0, payload.subarray(0, 10));
        await writeChunk(showFolder, 'uploaded.bin', 10, payload.subarray(10));
        const { bytes, total } = await readChunk(showFolder, 'uploaded.bin', 0, 1024);
        expect(total).toBe(payload.length);
        expect(bytes.toString()).toBe(payload.toString());
    });

    it('accepts chunks out of order', async () => {
        const payload = Buffer.from('AAAABBBBCCCC');
        await writeChunk(showFolder, 'ooo.bin', 0, payload.subarray(0, 4));
        await writeChunk(showFolder, 'ooo.bin', 8, payload.subarray(8));
        await writeChunk(showFolder, 'ooo.bin', 4, payload.subarray(4, 8));
        const { bytes } = await readChunk(showFolder, 'ooo.bin', 0, 1024);
        expect(bytes.toString()).toBe(payload.toString());
    });

    it('creates parent folders for an uploaded path', async () => {
        await writeChunk(showFolder, 'deep/nested/file.txt', 0, Buffer.from('hi'));
        expect((await statEntry(showFolder, 'deep/nested/file.txt')).sizeBytes).toBe(2);
    });

    it('reads a byte range and clamps past the end', async () => {
        const { bytes, total } = await readChunk(showFolder, 'song.mp3', 5, 4);
        expect(bytes.toString()).toBe('-byt');
        expect(total).toBe('audio-bytes'.length);
        const tail = await readChunk(showFolder, 'song.mp3', 8, 1000);
        expect(tail.bytes.toString()).toBe('tes');
    });

    it('will not read a directory as a file', async () => {
        await expectRejected(readChunk(showFolder, 'music', 0, 10), 'not-a-directory');
    });
});
