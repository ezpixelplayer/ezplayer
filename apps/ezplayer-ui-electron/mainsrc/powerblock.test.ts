import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlayerPStatusContent, PlayingItem, PreventSleepMode } from '@ezplayer/ezplayer-core';

const { powerSaveBlocker, stored } = vi.hoisted(() => {
    const started = new Set<number>();
    let next = 1;
    const stored: { preventSleep?: unknown } = {};
    return {
        stored,
        powerSaveBlocker: {
            start: vi.fn(() => {
                const id = next++;
                started.add(id);
                return id;
            }),
            stop: vi.fn((id: number) => started.delete(id)),
            isStarted: vi.fn((id: number) => started.has(id)),
        },
    };
});
vi.mock('electron', () => ({ powerSaveBlocker }));
vi.mock('electron-store', () => ({
    default: class {
        get(key: 'preventSleep') {
            return stored[key];
        }
        set(key: 'preventSleep', value: unknown) {
            stored[key] = value;
        }
    },
}));

const { getPreventSleepMode, setPreventSleepMode, syncPowerBlock, wantsPowerBlock } = await import('./powerblock.js');

const song: PlayingItem = { type: 'Scheduled', item: 'Song', title: 'song' };
const base = { ptype: 'EZP', reported_time: 0 } as PlayerPStatusContent;

function status(p: Partial<PlayerPStatusContent>): PlayerPStatusContent {
    return { ...base, status: 'Stopped', ...p };
}

describe('getPreventSleepMode', () => {
    it('defaults to always, including for an unknown stored value', () => {
        delete stored.preventSleep;
        expect(getPreventSleepMode()).toBe('always');
        stored.preventSleep = 'bogus';
        expect(getPreventSleepMode()).toBe('always');
    });

    it('rejects an unknown mode on set', () => {
        expect(() => setPreventSleepMode('bogus' as PreventSleepMode)).toThrow();
    });
});

describe('wantsPowerBlock', () => {
    it('always: on regardless of playback', () => {
        expect(wantsPowerBlock('always', undefined)).toBe(true);
        expect(wantsPowerBlock('always', status({}))).toBe(true);
    });

    it('never: off even while playing', () => {
        expect(wantsPowerBlock('never', status({ status: 'Playing', now_playing: song }))).toBe(false);
    });

    it('playing: on while anything plays, pauses or winds down; off when stopped', () => {
        for (const s of ['Playing', 'Stopping', 'Paused'] as const) {
            expect(wantsPowerBlock('playing', status({ status: s, now_playing: song }))).toBe(true);
        }
        expect(
            wantsPowerBlock('playing', status({ status: 'Playing', now_playing: { ...song, type: 'Immediate' } })),
        ).toBe(true);
        expect(wantsPowerBlock('playing', status({}))).toBe(false);
        expect(wantsPowerBlock('playing', undefined)).toBe(false);
    });
});

describe('syncPowerBlock', () => {
    beforeEach(() => {
        setPreventSleepMode('never');
        syncPowerBlock(undefined);
        vi.clearAllMocks();
    });

    it('playing: starts once, holds across repeats, and stops once when playback ends', () => {
        setPreventSleepMode('playing');
        const playing = status({ status: 'Playing', now_playing: song });
        syncPowerBlock(playing);
        syncPowerBlock(playing);
        expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);
        expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-app-suspension');
        expect(powerSaveBlocker.stop).not.toHaveBeenCalled();

        syncPowerBlock(status({}));
        syncPowerBlock(undefined);
        expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1);
    });

    it('applies a mode change against the last known playback state', () => {
        syncPowerBlock(status({}));
        setPreventSleepMode('always');
        expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);
        setPreventSleepMode('playing');
        expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1);
        setPreventSleepMode('never');
        expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1);
    });

    it('restarts a block the system dropped', () => {
        setPreventSleepMode('always');
        const id = powerSaveBlocker.start.mock.results[0].value as number;
        powerSaveBlocker.stop(id);
        syncPowerBlock(undefined);
        expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2);
    });
});
