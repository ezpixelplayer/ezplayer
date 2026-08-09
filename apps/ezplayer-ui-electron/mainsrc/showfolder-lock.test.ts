import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    readShowFolderLock,
    runningPlayerWebPort,
    showFolderLockPath,
    updateShowFolderLock,
} from './showfolder-lock.js';

let showFolder: string;

beforeEach(async () => {
    showFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-lock-'));
});

afterEach(async () => {
    await fs.rm(showFolder, { recursive: true, force: true });
});

describe('show-folder lock contents', () => {
    it('reports nothing when the file is absent', async () => {
        expect(await readShowFolderLock(showFolder)).toBeUndefined();
        expect(await runningPlayerWebPort(showFolder)).toBeUndefined();
    });

    it('records and reads back the bound ports', async () => {
        await updateShowFolderLock(showFolder, { pid: process.pid, webPort: 3907, kioskPort: 3908 });
        const info = await readShowFolderLock(showFolder);
        expect(info?.webPort).toBe(3907);
        expect(info?.kioskPort).toBe(3908);
        expect(info?.updatedAt).toBeTruthy();
        expect(await runningPlayerWebPort(showFolder)).toBe(3907);
    });

    it('merges rather than replacing, so the pid survives a port update', async () => {
        await updateShowFolderLock(showFolder, { pid: process.pid });
        await updateShowFolderLock(showFolder, { webPort: 4100 });
        const info = await readShowFolderLock(showFolder);
        expect(info?.pid).toBe(process.pid);
        expect(info?.webPort).toBe(4100);
    });

    it('rewrites rather than appending, so repeated runs cannot grow the file', async () => {
        for (let i = 0; i < 5; i++) await updateShowFolderLock(showFolder, { pid: process.pid, webPort: 3000 + i });
        const raw = await fs.readFile(showFolderLockPath(showFolder), 'utf8');
        expect(JSON.parse(raw).webPort).toBe(3004);
        expect(raw.length).toBeLessThan(200);
    });

    it('ignores a port whose process is gone, rather than sending callers at a stranger', async () => {
        // A pid that cannot be running: the kernel would have to have handed
        // out an implausibly high number.
        await updateShowFolderLock(showFolder, { pid: 0x7ffffffe, webPort: 3907 });
        expect(await runningPlayerWebPort(showFolder)).toBeUndefined();
        // The record itself is still readable — only the port is disregarded.
        expect((await readShowFolderLock(showFolder))?.webPort).toBe(3907);
    });

    it('still reports a port when no pid was recorded', async () => {
        await updateShowFolderLock(showFolder, { webPort: 3907 });
        expect(await runningPlayerWebPort(showFolder)).toBe(3907);
    });

    it('tolerates a lock file that is not JSON', async () => {
        await fs.writeFile(showFolderLockPath(showFolder), 'ezplayer-folder-lock\n');
        expect(await readShowFolderLock(showFolder)).toBeUndefined();
        expect(await runningPlayerWebPort(showFolder)).toBeUndefined();
        // And writing over it produces valid JSON again.
        await updateShowFolderLock(showFolder, { pid: process.pid, webPort: 3907 });
        expect(await runningPlayerWebPort(showFolder)).toBe(3907);
    });
});
