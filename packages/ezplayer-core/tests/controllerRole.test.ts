/**
 * The resolver every other decision reads: who is a player, who is a remote,
 * and which stage of the pipeline said so.
 */

import { describe, expect, it } from 'vitest';

import {
    activeStateFrom,
    applyOverrides,
    contentRoleOf,
    layoutPlayerMode,
    resolveControllerRole,
    shouldWatchController,
} from '../src/index';
import type { KnownController } from '../src/index';

describe('resolveControllerRole', () => {
    it('takes the record over the layout', () => {
        const r = resolveControllerRole({ role: 'remote', enableState: 'enabled' });
        expect(r).toMatchObject({ role: 'remote', source: 'record' });
    });

    it('defers to the layout when the record has no opinion', () => {
        expect(resolveControllerRole({ enableState: 'xlightsOnly' })).toMatchObject({
            role: 'remote',
            source: 'layout',
        });
        expect(resolveControllerRole({ enableState: 'enabled' })).toMatchObject({
            role: 'player',
            source: 'layout',
        });
    });

    it('reads a player-only entry as the show player, not a remote', () => {
        // xLights marks these "xLights Only" to keep the show's pixels off a
        // box that owns no channels. It is the player, not a follower.
        expect(resolveControllerRole({ enableState: 'xlightsOnly', protocol: 'Player Only' })).toMatchObject({
            role: 'player',
            source: 'layout',
        });
    });

    it('falls back to what the device says when nothing else has an opinion', () => {
        expect(resolveControllerRole({ reportedMode: 'remote' })).toMatchObject({
            role: 'remote',
            source: 'device',
        });
        // FPP's deprecated 'master' is a player that also sends sync.
        expect(resolveControllerRole({ reportedMode: 'master' })).toMatchObject({
            role: 'player',
            source: 'device',
        });
        expect(resolveControllerRole({})).toMatchObject({ role: 'none', source: 'default' });
    });

    it('keeps what the device reported beside the answer, so drift survives', () => {
        const r = resolveControllerRole({ role: 'remote', reportedMode: 'player' });
        expect(r.role).toBe('remote');
        expect(r.reported).toBe('player');
        expect(r.drift).toMatch(/wants this controller as a remote/);
    });

    it('reports no drift when the two agree', () => {
        expect(resolveControllerRole({ role: 'remote', reportedMode: 'remote' }).drift).toBeUndefined();
    });

    it('treats a disabled controller as having no part', () => {
        expect(resolveControllerRole({ role: 'disabled', enableState: 'xlightsOnly' }).role).toBe('none');
        expect(layoutPlayerMode({ enableState: 'disabled' })).toBeUndefined();
    });
});

describe('activeStateFrom', () => {
    it('keeps a deliberate Disable but drops the default true', () => {
        // `true` was written into every record as a default, never chosen, so
        // honouring it would let it outrank the layout -- which is how an
        // "xLights Only" controller used to come out a player.
        expect(activeStateFrom(false)).toBe('disabled');
        expect(activeStateFrom(true)).toBeUndefined();
    });

    it('passes the role words through and rejects anything else', () => {
        expect(activeStateFrom('remote')).toBe('remote');
        expect(activeStateFrom('player')).toBe('player');
        expect(activeStateFrom('enabled')).toBe('enabled');
        expect(activeStateFrom('nonsense')).toBeUndefined();
        expect(activeStateFrom(undefined)).toBeUndefined();
    });
});

describe('applyOverrides no longer flattens the layout', () => {
    const xlights: KnownController[] = [
        { name: 'wb1616', address: '10.0.0.58', active: true, enableState: 'xlightsOnly' },
    ];

    it('leaves a remote a remote when the record only sets an address', () => {
        const [out] = applyOverrides(xlights, [{ name: 'wb1616', address: '10.0.0.99' }]);
        expect(out.address).toBe('10.0.0.99');
        expect(out.enableState).toBe('xlightsOnly');
        expect(layoutPlayerMode(out)).toBe('remote');
    });

    it('still honours an old boolean Disable', () => {
        const [out] = applyOverrides(xlights, [{ name: 'wb1616', active: false as unknown as 'disabled' }]);
        expect(out.active).toBe(false);
        expect(layoutPlayerMode(out)).toBeUndefined();
    });

    it('lets a record promote a plain controller to a remote', () => {
        const plain: KnownController[] = [{ name: 'k32', address: '10.0.0.61', enableState: 'enabled' }];
        const [out] = applyOverrides(plain, [{ name: 'k32', active: 'remote' }]);
        expect(layoutPlayerMode(out)).toBe('remote');
        // The layout's own word is untouched, so drift still has a baseline.
        expect(out.enableState).toBe('enabled');
    });

    it('carries presumeUp through', () => {
        const [out] = applyOverrides(xlights, [{ name: 'wb1616', presumeUp: true }]);
        expect(out.presumeUp).toBe(true);
    });
});

describe('contentRoleOf', () => {
    // A narrower question than the role: who plays from their own copy of the
    // files, rather than who is in the show.
    it('keeps an Active controller out, though it resolves as a player', () => {
        const active = { enableState: 'enabled' as const };
        expect(layoutPlayerMode(active)).toBe('player');
        // Its pixels arrive live over the wire, so it needs no files at all.
        expect(contentRoleOf(active)).toBe('none');
    });

    it('counts the show player and the remotes', () => {
        expect(contentRoleOf({ enableState: 'xlightsOnly', protocol: 'Player Only' })).toBe('player');
        expect(contentRoleOf({ enableState: 'xlightsOnly' })).toBe('remote');
        expect(contentRoleOf({ role: 'player' })).toBe('player');
        expect(contentRoleOf({ role: 'remote' })).toBe('remote');
    });

    it('takes "enabled" on a record as the operator ruling both parts out', () => {
        // Which is why re-enabling from the grid clears the override instead
        // of writing 'enabled' -- that would quietly un-remote a remote.
        expect(contentRoleOf({ role: 'enabled', enableState: 'xlightsOnly' })).toBe('none');
        expect(contentRoleOf({ role: 'disabled', enableState: 'xlightsOnly' })).toBe('none');
        expect(contentRoleOf({})).toBe('none');
    });
});

describe('shouldWatchController', () => {
    it('watches a remote and a player-only entry, not a disabled one', () => {
        expect(shouldWatchController({ address: '10.0.0.58', enableState: 'xlightsOnly' })).toBe(true);
        expect(
            shouldWatchController({ address: '10.0.0.23', enableState: 'xlightsOnly', protocol: 'Player Only' }),
        ).toBe(true);
        expect(shouldWatchController({ address: '10.0.0.58', enableState: 'disabled' })).toBe(false);
        expect(shouldWatchController({ address: '10.0.0.58', role: 'disabled' })).toBe(false);
    });

    it('cannot watch what it has no address for', () => {
        expect(shouldWatchController({ enableState: 'enabled' })).toBe(false);
        expect(shouldWatchController({ address: '  ', enableState: 'enabled' })).toBe(false);
    });
});
