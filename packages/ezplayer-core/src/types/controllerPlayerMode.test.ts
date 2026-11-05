import { describe, expect, it } from 'vitest';
import { isPlayerOnlyRecord, layoutPlayerMode, playerModeDrift } from './ControllerOps';

describe('the role the layout asks for', () => {
    it('reads "xLights Only" as a remote and Active as a player', () => {
        expect(layoutPlayerMode({ enableState: 'xlightsOnly' })).toBe('remote');
        expect(layoutPlayerMode({ enableState: 'enabled' })).toBe('player');
    });

    it('reads an FPP player entry as a player, not a remote', () => {
        // xLights records a player with no outputs, so it marks it "xLights
        // Only" to keep the show off it -- that is not a remote.
        const player = { enableState: 'xlightsOnly' as const, protocol: 'Player Only', model: 'FPP Player Only' };
        expect(layoutPlayerMode(player)).toBe('player');
        expect(isPlayerOnlyRecord(player)).toBe(true);
        expect(isPlayerOnlyRecord({ protocol: 'player only' })).toBe(true);
        expect(isPlayerOnlyRecord({ model: 'FPP Player Only' })).toBe(true);
    });

    it('still reads a real controller marked "xLights Only" as a remote', () => {
        expect(layoutPlayerMode({ enableState: 'xlightsOnly', protocol: 'DDP', model: 'K16A-B' })).toBe('remote');
        expect(isPlayerOnlyRecord({ protocol: 'DDP', model: 'K16A-B' })).toBe(false);
        expect(isPlayerOnlyRecord({})).toBe(false);
    });

    it('asks nothing of a controller that is not in the show', () => {
        expect(layoutPlayerMode({ enableState: 'disabled' })).toBeUndefined();
        expect(layoutPlayerMode({})).toBeUndefined();
    });
});

describe('drift between the device and the layout', () => {
    it('is silent when they agree', () => {
        expect(playerModeDrift('remote', 'remote')).toBeUndefined();
        expect(playerModeDrift('player', 'player')).toBeUndefined();
        // FPP's legacy master is a player that also sends sync.
        expect(playerModeDrift('master', 'player')).toBeUndefined();
        expect(playerModeDrift('REMOTE', 'remote')).toBeUndefined();
    });

    it('names both sides when they disagree', () => {
        expect(playerModeDrift('player', 'remote')).toBe(
            'the layout wants this controller as a remote, but it reports "player"',
        );
        expect(playerModeDrift('remote', 'player')).toMatch(/as a player, but it reports "remote"/);
        // A bridge plays nothing, so it does not satisfy a layout wanting a player.
        expect(playerModeDrift('bridge', 'player')).toMatch(/reports "bridge"/);
    });

    it('says nothing when either side is unknown', () => {
        expect(playerModeDrift(undefined, 'remote')).toBeUndefined();
        expect(playerModeDrift('player', undefined)).toBeUndefined();
    });
});
