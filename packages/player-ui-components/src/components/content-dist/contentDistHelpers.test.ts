import { describe, expect, it } from 'vitest';
import type { DiscoveredController, KnownController, MultisyncSettings } from '@ezplayer/ezplayer-core';

import { contentDistSummary, contentTargets, multisyncMode, syncOffWarning } from './contentDistHelpers';

function device(ip: string, driverType: string): DiscoveredController {
    return {
        id: `${ip}|direct`,
        ip,
        hostname: `${driverType.toLowerCase()}-${ip.split('.').pop()}`,
        driverType,
        source: { via: 'direct' },
    } as DiscoveredController;
}

const devices = (...list: DiscoveredController[]): Record<string, DiscoveredController> =>
    Object.fromEntries(list.map((d) => [d.id, d]));

describe('which devices a distribution covers', () => {
    it('includes every family that holds content, not only FPP', () => {
        const found = devices(
            device('10.0.0.1', 'FPP'),
            device('10.0.0.2', 'Falcon'),
            device('10.0.0.3', 'Genius'),
            device('10.0.0.4', 'HinksPix'),
            // Holds nothing: it is sent pixels while the show runs.
            device('10.0.0.5', 'WLED'),
            device('10.0.0.6', 'ILightThat'),
        );
        // Rows come back in host order, which is what the grid wants.
        expect(contentTargets(found).map((d) => d.driverType)).toEqual(['Falcon', 'FPP', 'Genius', 'HinksPix']);
    });

    it('says nothing was found in words that fit a card controller too', () => {
        // The old wording named FPP, which read as "unsupported" on a show
        // whose only content holders are Falcons.
        expect(contentDistSummary(undefined, []).text).toBe('No devices that hold content found yet');
    });
});

const record = (name: string, over: Partial<KnownController> = {}): KnownController =>
    ({ name, address: `10.0.0.${name.length}`, ...over }) as KnownController;

describe('which sync setting is in force', () => {
    it('reads no setting at all as automatic', () => {
        // `enabled: false` with no `mode` is the untouched default: automatic.
        expect(multisyncMode(undefined)).toBe('auto');
        expect(multisyncMode({ enabled: false, remotes: [] })).toBe('auto');
    });

    it("keeps an explicit choice, and an older build's bare enabled flag", () => {
        expect(multisyncMode({ enabled: false, remotes: [], mode: 'off' })).toBe('off');
        expect(multisyncMode({ enabled: true, remotes: [] })).toBe('on');
    });
});

describe('warning that remotes will never be told to play', () => {
    const off: MultisyncSettings = { enabled: false, remotes: [], mode: 'off' };

    it('names the remotes that would hold the show and sit in the dark', () => {
        const warning = syncOffWarning([record('Roof', { role: 'remote' }), record('Lawn')], off);
        expect(warning).toContain('Roof');
        expect(warning).not.toContain('Lawn');
        expect(warning).toContain('Sync output is off');
    });

    it('says nothing when the show has no remotes, or when sync is not off', () => {
        expect(syncOffWarning([record('Lawn')], off)).toBeUndefined();
        expect(syncOffWarning([record('Roof', { role: 'remote' })], undefined)).toBeUndefined();
        expect(
            syncOffWarning([record('Roof', { role: 'remote' })], { enabled: false, remotes: [], mode: 'auto' }),
        ).toBeUndefined();
    });

    it('counts an xLights-Only controller as a remote, as the layout does', () => {
        expect(syncOffWarning([record('Roof', { enableState: 'xlightsOnly' })], off)).toContain('Roof');
        // A HinksPix never follows our sync, so sync being off costs it nothing.
        expect(
            syncOffWarning([record('Hinks', { enableState: 'xlightsOnly', vendor: 'HinksPix' })], off),
        ).toBeUndefined();
    });
});
