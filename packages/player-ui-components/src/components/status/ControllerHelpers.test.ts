/**
 * What the status cards count, and what they call it: "skipped" on a row is
 * either an Inactive controller (out of the show) or a player/remote that
 * plays its own copy (in the show, and pinged).
 */

import { describe, expect, it } from 'vitest';
import type { ControllerStatus } from '@ezplayer/ezplayer-core';

import {
    controllerInShow,
    controllerLiveness,
    controllerStatusLabel,
    getControllerSeverity,
    getControllerStats,
} from './ControllerHelpers';

/** An ordinary controller, sent the show's live data. */
const sent = (over: Partial<ControllerStatus> = {}): ControllerStatus => ({
    name: 'ctrl',
    state: 'Active',
    status: 'open',
    connectivity: 'Up',
    ...over,
});

/** A remote: no data sender, so "skipped", and watched because it matters. */
const remote = (over: Partial<ControllerStatus> = {}): ControllerStatus => ({
    name: 'remote',
    state: 'xLights Only',
    status: 'skipped',
    connectivity: 'Up',
    ...over,
});

/** Out of the show: Inactive, and nothing is watching it. */
const inactive = (): ControllerStatus => ({
    name: 'off',
    state: 'Inactive',
    status: 'skipped',
    connectivity: 'N/A',
});

describe('whether a controller is in this show', () => {
    it('counts a remote in, because the show cannot run without it', () => {
        expect(controllerInShow(remote())).toBe(true);
        expect(controllerInShow(sent())).toBe(true);
    });

    it('leaves out the ones the layout took out', () => {
        expect(controllerInShow(inactive())).toBe(false);
        // Watched by nobody: a Null controller, or one with no usable address.
        expect(controllerInShow(sent({ connectivity: 'N/A' }))).toBe(false);
    });
});

describe('the counts a card shows', () => {
    it('adds up: every controller in the show is online, offline or waiting', () => {
        const stats = getControllerStats([
            sent(),
            remote(),
            sent({ connectivity: 'Down' }),
            remote({ connectivity: 'Pending' }),
            inactive(),
        ]);

        expect(stats.total).toBe(4);
        expect(stats.online + stats.offline + stats.pending).toBe(stats.total);
        expect(stats).toMatchObject({ online: 2, offline: 1, pending: 1, playsOwnCopy: 2, outOfShow: 1 });
    });

    it('calls a remote online when it answers, though it has no data sender', () => {
        // Liveness comes from the ping; a remote never reports `open`.
        expect(getControllerStats([remote()]).online).toBe(1);
        expect(controllerLiveness(remote())).toBe('up');
    });

    it('counts a sender that failed as down whatever its ping says', () => {
        expect(controllerLiveness(sent({ status: 'error' }))).toBe('down');
        expect(getControllerStats([sent({ status: 'error' })])).toMatchObject({ offline: 1, online: 0 });
    });

    it('ignores errors on a controller that is not in the show', () => {
        expect(getControllerStats([inactive(), sent({ errors: ['boom'] })])).toMatchObject({
            errorCount: 1,
            withErrors: 1,
            total: 1,
        });
    });
});

describe('what a status chip says', () => {
    it('names the part rather than reading "skipped"', () => {
        expect(controllerStatusLabel(remote())).toBe('plays its own copy');
        expect(controllerStatusLabel(inactive())).toBe('not in this show');
        expect(controllerStatusLabel(sent())).toBe('open');
    });

    it('judges a remote by its ping, not by being skipped', () => {
        expect(getControllerSeverity(remote())).toBe('success');
        expect(getControllerSeverity(remote({ connectivity: 'Down' }))).toBe('error');
        // Still grey when it is genuinely out of the show.
        expect(getControllerSeverity(inactive())).toBe('disabled');
    });
});
