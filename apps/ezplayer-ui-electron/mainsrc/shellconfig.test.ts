import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    clearShellPassword,
    readShellConfig,
    setShellPassword,
    shellConfigPath,
    shellEnabled,
    verifyShellPassword,
} from './shellconfig.js';

const PASSWORD = 'correct horse battery';

/** Stands in for a show folder; the config lands in its `.ezplayer/`. */
let showFolder: string;

beforeEach(async () => {
    showFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-show-'));
});

afterEach(async () => {
    await fs.rm(showFolder, { recursive: true, force: true });
});

describe('shell config', () => {
    it('lives in the show folder .ezplayer directory', () => {
        expect(shellConfigPath(showFolder)).toBe(path.join(showFolder, '.ezplayer', 'shell.json'));
    });

    it('reports disabled when no config file exists', async () => {
        expect(await readShellConfig(showFolder)).toBeUndefined();
        expect(shellEnabled(await readShellConfig(showFolder))).toBe(false);
    });

    it('reports disabled when no show folder is open', async () => {
        expect(await readShellConfig(undefined)).toBeUndefined();
        expect(shellEnabled(await readShellConfig(undefined))).toBe(false);
    });

    it('round-trips a password and verifies it', async () => {
        await setShellPassword(showFolder, PASSWORD);
        const cfg = await readShellConfig(showFolder);
        expect(shellEnabled(cfg)).toBe(true);
        expect(await verifyShellPassword(cfg, PASSWORD)).toBe(true);
    });

    it('rejects a wrong password', async () => {
        await setShellPassword(showFolder, PASSWORD);
        const cfg = await readShellConfig(showFolder);
        expect(await verifyShellPassword(cfg, 'correct horse batteru')).toBe(false);
        expect(await verifyShellPassword(cfg, '')).toBe(false);
    });

    it('never stores the password in cleartext', async () => {
        await setShellPassword(showFolder, PASSWORD);
        const raw = await fs.readFile(shellConfigPath(showFolder), 'utf8');
        expect(raw).not.toContain(PASSWORD);
    });

    it('keeps shows independent — a password in one does not enable another', async () => {
        const other = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-show-'));
        try {
            await setShellPassword(showFolder, PASSWORD);
            expect(shellEnabled(await readShellConfig(showFolder))).toBe(true);
            expect(shellEnabled(await readShellConfig(other))).toBe(false);
        } finally {
            await fs.rm(other, { recursive: true, force: true });
        }
    });

    it('clearing disables the feature and refuses every password', async () => {
        await setShellPassword(showFolder, PASSWORD);
        expect(await clearShellPassword(showFolder)).toBe(true);
        const cfg = await readShellConfig(showFolder);
        expect(shellEnabled(cfg)).toBe(false);
        expect(await verifyShellPassword(cfg, PASSWORD)).toBe(false);
        // Second clear is a no-op, not an error.
        expect(await clearShellPassword(showFolder)).toBe(false);
    });

    it('treats a corrupt or empty file as disabled, not as open', async () => {
        await setShellPassword(showFolder, PASSWORD);
        const file = shellConfigPath(showFolder);
        await fs.writeFile(file, '{ this is not json');
        expect(shellEnabled(await readShellConfig(showFolder))).toBe(false);
        await fs.writeFile(file, '');
        expect(shellEnabled(await readShellConfig(showFolder))).toBe(false);
    });

    it('treats a malformed password record as disabled', async () => {
        await setShellPassword(showFolder, PASSWORD);
        await fs.writeFile(
            shellConfigPath(showFolder),
            JSON.stringify({ version: 1, password: { algo: 'scrypt' } }),
        );
        const cfg = await readShellConfig(showFolder);
        expect(shellEnabled(cfg)).toBe(false);
        expect(await verifyShellPassword(cfg, 'anything')).toBe(false);
    });

    it('uses a fresh salt per write, so the same password hashes differently', async () => {
        await setShellPassword(showFolder, PASSWORD);
        const first = (await readShellConfig(showFolder))?.password;
        await setShellPassword(showFolder, PASSWORD);
        const second = (await readShellConfig(showFolder))?.password;
        expect(first?.salt).not.toEqual(second?.salt);
        expect(first?.hash).not.toEqual(second?.hash);
    });
});
