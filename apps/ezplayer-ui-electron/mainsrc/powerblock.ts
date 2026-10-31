/**
 * Keeps the system awake per the app-global "prevent sleeping" setting. The
 * default holds the block the whole time the app runs: a sleeping machine
 * cannot be woken by the app, so a show scheduled for later, or a request from
 * the cloud, only works if the machine never went to sleep. Display sleep is
 * left alone.
 */

import { powerSaveBlocker } from 'electron';
import Store from 'electron-store';
import type { PlayerPStatusContent, PreventSleepMode } from '@ezplayer/ezplayer-core';

const store = new Store<{ preventSleep?: PreventSleepMode }>({ name: 'power' });

const MODES: readonly PreventSleepMode[] = ['always', 'playing', 'never'];

let blockerId: number | undefined;
let lastPlayer: PlayerPStatusContent | undefined;

export function getPreventSleepMode(): PreventSleepMode {
    const m = store.get('preventSleep');
    return m && MODES.includes(m) ? m : 'always';
}

/** Persist a new mode and apply it to the current playback state. */
export function setPreventSleepMode(mode: PreventSleepMode): void {
    if (!MODES.includes(mode)) throw new Error(`Unknown prevent-sleep mode: ${String(mode)}`);
    store.set('preventSleep', mode);
    apply();
}

/** True when the mode and playback state call for the system to stay awake. */
export function wantsPowerBlock(mode: PreventSleepMode, player: PlayerPStatusContent | undefined): boolean {
    if (mode === 'never') return false;
    if (mode === 'always') return true;
    return player?.status === 'Playing' || player?.status === 'Stopping' || player?.status === 'Paused';
}

/** Start or stop the blocker to match the latest player status; no-op when already matching. */
export function syncPowerBlock(player: PlayerPStatusContent | undefined): void {
    lastPlayer = player;
    apply();
}

function apply(): void {
    const want = wantsPowerBlock(getPreventSleepMode(), lastPlayer);
    const have = blockerId !== undefined && powerSaveBlocker.isStarted(blockerId);
    if (want === have) return;
    if (want) {
        blockerId = powerSaveBlocker.start('prevent-app-suspension');
        console.log('[power] holding system awake');
    } else {
        if (blockerId !== undefined) powerSaveBlocker.stop(blockerId);
        blockerId = undefined;
        console.log('[power] released system sleep block');
    }
}
