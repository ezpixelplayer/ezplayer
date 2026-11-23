import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ app: {} }));
vi.mock('electron-store', () => ({ default: class {} }));
vi.mock('./data/CloudConfigStorage.js', () => ({ DEFAULT_CLOUD_SERVICE_URL: '', getCloudConfigCache: () => ({}) }));
vi.mock('../versions.js', () => ({ ezpVersions: {} }));
vi.mock('./diagEnv.js', () => ({ getDiagEnv: () => ({}) }));
vi.mock('./diagoutbox.js', () => ({ DiagOutbox: class {} }));

const { isExpectedProcessExit, noteQuitting } = await import('./diagnostics.js');

describe('isExpectedProcessExit', () => {
    const sigterm = { reason: 'killed', exitCode: 15 };
    const gpuRelaunch = { reason: 'launch-failed', exitCode: 1002 };
    const crash = { reason: 'crashed', exitCode: 132 };

    it('passes children killed or failing to launch once quitting, but not crashes', () => {
        expect([sigterm, gpuRelaunch, crash].map(isExpectedProcessExit)).toEqual([false, false, false]);
        noteQuitting();
        expect([sigterm, gpuRelaunch, crash].map(isExpectedProcessExit)).toEqual([true, true, false]);
    });
});
