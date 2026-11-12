import { describe, expect, it } from 'vitest';
import {
    isPlayerOnlyRecord,
    layoutPlayerMode,
    playerModeDrift,
    reportedPlayerRole,
    takesLiveData,
} from './ControllerOps';

describe('the role the layout asks for', () => {
    it('reads "xLights Only" as a remote and Active as an ordinary controller', () => {
        expect(layoutPlayerMode({ enableState: 'xlightsOnly' })).toBe('remote');
        // Active means a player drives it, not that the box itself plays: it
        // has to be in show mode, taking the live pixel data.
        expect(layoutPlayerMode({ enableState: 'enabled' })).toBe('show');
        expect(layoutPlayerMode({ role: 'enabled' })).toBe('show');
    });

    it('asks for show mode so a player or remote can be undone', () => {
        // The reason `show` exists: a box left in player mode after an
        // experiment, a second-hand purchase or a config change takes no pixel
        // data, and without this nothing would put it back.
        expect(layoutPlayerMode({ role: 'player' })).toBe('player');
        expect(layoutPlayerMode({ role: 'remote' })).toBe('remote');
        // The record outranks the layout, in both directions.
        expect(layoutPlayerMode({ role: 'enabled', enableState: 'xlightsOnly' })).toBe('show');
        expect(layoutPlayerMode({ role: 'player', enableState: 'enabled' })).toBe('player');
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

    it('gives a HinksPix content as a player, never as a remote', () => {
        // Its SLAVE role follows a HinksPix master rather than the show's
        // sync, and nothing takes it back out, so "xLights Only" on this
        // family means "hold your own copy" and no more.
        expect(layoutPlayerMode({ enableState: 'xlightsOnly', vendor: 'HinksPix' })).toBe('player');
        // Any other vendor still reads as a remote.
        expect(layoutPlayerMode({ enableState: 'xlightsOnly', vendor: 'Falcon' })).toBe('remote');
        // Unknown vendor keeps the old reading; the driver refuses what it
        // cannot honour, and that check does not need to know the family.
        expect(layoutPlayerMode({ enableState: 'xlightsOnly' })).toBe('remote');
    });

    it('asks nothing of a controller that is not in the show', () => {
        expect(layoutPlayerMode({ enableState: 'disabled' })).toBeUndefined();
        expect(layoutPlayerMode({ role: 'disabled' })).toBeUndefined();
        // Disabling outranks the layout wanting it as a remote.
        expect(layoutPlayerMode({ role: 'disabled', enableState: 'xlightsOnly' })).toBeUndefined();
        // No opinion anywhere: nothing to reset it to.
        expect(layoutPlayerMode({})).toBeUndefined();
    });
});

describe('drift between the device and the layout', () => {
    it('flags a box still holding its own copy when the show wants its data', () => {
        // The drift that matters for a reset: the board takes no pixel data in
        // either of these, so its share of the display is dark.
        expect(playerModeDrift('Player', 'show')).toContain("taking the show's data");
        expect(playerModeDrift('FPP Remote', 'show')).toContain('FPP Remote');
        expect(playerModeDrift('master', 'show')).toBeTruthy();
    });

    it('is silent on any live-data mode when the show wants one', () => {
        // Not enumerated on purpose: a protocol name we have never seen must
        // not read as drift.
        for (const live of ['DDP', 'E1.31', 'ArtNet', 'ETHERNET', 'bridge', 'Mode 7']) {
            expect(playerModeDrift(live, 'show'), live).toBeUndefined();
        }
    });

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

describe("reading a device's own word for its mode", () => {
    it("matches each family's spelling to the mode we ask for", () => {
        // The bug this fixes: none of these families uses our words, so a
        // Falcon in exactly the mode the layout wanted read as drifted.
        expect(reportedPlayerRole('FPP Player')).toBe('player');
        expect(reportedPlayerRole('FPP Master')).toBe('player');
        expect(reportedPlayerRole('FPP Remote')).toBe('remote');
        expect(reportedPlayerRole('MASTER')).toBe('player');
        expect(reportedPlayerRole('SLAVE')).toBe('remote');
        expect(reportedPlayerRole('standalone')).toBe('player');
        expect(reportedPlayerRole('player')).toBe('player');
        expect(reportedPlayerRole('remote')).toBe('remote');
    });

    it('reads every live-data mode as show, including ones we have not seen', () => {
        for (const live of ['DDP', 'E1.31/ArtNet', 'ETHERNET', 'bridge', 'ddp', 'artnet', 'ZCPP', 'Mode 7']) {
            expect(reportedPlayerRole(live), live).toBe('show');
        }
    });

    it('does not re-write a board that is already in the mode asked for', () => {
        // Each of these agreed all along; the drift was in the comparison.
        expect(playerModeDrift('FPP Player', 'player')).toBeUndefined();
        expect(playerModeDrift('FPP Remote', 'remote')).toBeUndefined();
        expect(playerModeDrift('SLAVE', 'remote')).toBeUndefined();
        expect(playerModeDrift('MASTER', 'player')).toBeUndefined();
        expect(playerModeDrift('DDP', 'show')).toBeUndefined();
    });

    it("reads an FPP's player mode as taking live data, since it has no other", () => {
        // Current FPP has only player and remote, and remaps the old bridge
        // to player -- so as drift this could never be cleared.
        expect(playerModeDrift('player', 'show', 'FPP')).toBeUndefined();
        expect(playerModeDrift('remote', 'show', 'FPP')).toContain('reports "remote"');
        // A player on any other family plays from its own card.
        expect(playerModeDrift('Player', 'show', 'Falcon')).toContain("taking the show's data");
        expect(takesLiveData('player', 'FPP')).toBe(true);
        expect(takesLiveData('player', 'HinksPix')).toBe(false);
        expect(takesLiveData('remote', 'FPP')).toBe(false);
        expect(takesLiveData('DDP')).toBe(true);
    });
});
