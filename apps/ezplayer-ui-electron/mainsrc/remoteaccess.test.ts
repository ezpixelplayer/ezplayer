import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
    clearFeaturePassword,
    featureEnabled,
    readRemoteAccessConfig,
    remoteAccessConfigPath,
    setFeaturePassword,
    verifyFeaturePassword,
} from './remoteaccess.js';

const SHELL_PW = 'shell horse battery';
const FILES_PW = 'files horse battery';

let showFolder: string;

beforeEach(async () => {
    showFolder = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-show-'));
});

afterEach(async () => {
    await fs.rm(showFolder, { recursive: true, force: true });
});

describe('remote-access config', () => {
    it('lives in the show folder .ezplayer directory', () => {
        expect(remoteAccessConfigPath(showFolder)).toBe(
            path.join(showFolder, '.ezplayer', 'remote-access.json'),
        );
    });

    it('reports everything off when no config exists, or no show is open', async () => {
        expect(await readRemoteAccessConfig(showFolder)).toBeUndefined();
        expect(featureEnabled(await readRemoteAccessConfig(showFolder), 'shell')).toBe(false);
        expect(featureEnabled(await readRemoteAccessConfig(undefined), 'files')).toBe(false);
    });

    it('keeps the two features independent', async () => {
        await setFeaturePassword(showFolder, 'files', FILES_PW);
        const cfg = await readRemoteAccessConfig(showFolder);
        expect(featureEnabled(cfg, 'files')).toBe(true);
        // Enabling the file manager must not enable a shell.
        expect(featureEnabled(cfg, 'shell')).toBe(false);
    });

    it('never accepts one feature password for the other', async () => {
        await setFeaturePassword(showFolder, 'shell', SHELL_PW);
        await setFeaturePassword(showFolder, 'files', FILES_PW);
        const cfg = await readRemoteAccessConfig(showFolder);

        expect(await verifyFeaturePassword(cfg, 'shell', SHELL_PW)).toBe(true);
        expect(await verifyFeaturePassword(cfg, 'files', FILES_PW)).toBe(true);
        expect(await verifyFeaturePassword(cfg, 'shell', FILES_PW)).toBe(false);
        expect(await verifyFeaturePassword(cfg, 'files', SHELL_PW)).toBe(false);
    });

    it('clears one feature without disturbing the other', async () => {
        await setFeaturePassword(showFolder, 'shell', SHELL_PW);
        await setFeaturePassword(showFolder, 'files', FILES_PW);
        expect(await clearFeaturePassword(showFolder, 'files')).toBe(true);

        const cfg = await readRemoteAccessConfig(showFolder);
        expect(featureEnabled(cfg, 'files')).toBe(false);
        expect(featureEnabled(cfg, 'shell')).toBe(true);
        expect(await verifyFeaturePassword(cfg, 'shell', SHELL_PW)).toBe(true);
        // Second clear is a no-op, not an error.
        expect(await clearFeaturePassword(showFolder, 'files')).toBe(false);
    });

    it('never stores a password in cleartext', async () => {
        await setFeaturePassword(showFolder, 'shell', SHELL_PW);
        await setFeaturePassword(showFolder, 'files', FILES_PW);
        const raw = await fs.readFile(remoteAccessConfigPath(showFolder), 'utf8');
        expect(raw).not.toContain(SHELL_PW);
        expect(raw).not.toContain(FILES_PW);
    });

    it('keeps shows independent', async () => {
        const other = await fs.mkdtemp(path.join(os.tmpdir(), 'ezp-show-'));
        try {
            await setFeaturePassword(showFolder, 'files', FILES_PW);
            expect(featureEnabled(await readRemoteAccessConfig(showFolder), 'files')).toBe(true);
            expect(featureEnabled(await readRemoteAccessConfig(other), 'files')).toBe(false);
        } finally {
            await fs.rm(other, { recursive: true, force: true });
        }
    });

    it('treats a corrupt, empty or malformed file as off, not as open', async () => {
        await setFeaturePassword(showFolder, 'shell', SHELL_PW);
        const file = remoteAccessConfigPath(showFolder);

        await fs.writeFile(file, '{ this is not json');
        expect(featureEnabled(await readRemoteAccessConfig(showFolder), 'shell')).toBe(false);

        await fs.writeFile(file, '');
        expect(featureEnabled(await readRemoteAccessConfig(showFolder), 'shell')).toBe(false);

        await fs.writeFile(file, JSON.stringify({ version: 1, shell: { password: { algo: 'scrypt' } } }));
        const cfg = await readRemoteAccessConfig(showFolder);
        expect(featureEnabled(cfg, 'shell')).toBe(false);
        expect(await verifyFeaturePassword(cfg, 'shell', 'anything')).toBe(false);
    });

    it('uses a fresh salt per write', async () => {
        await setFeaturePassword(showFolder, 'files', FILES_PW);
        const first = (await readRemoteAccessConfig(showFolder))?.files?.password;
        await setFeaturePassword(showFolder, 'files', FILES_PW);
        const second = (await readRemoteAccessConfig(showFolder))?.files?.password;
        expect(first?.salt).not.toEqual(second?.salt);
        expect(first?.hash).not.toEqual(second?.hash);
    });
});
