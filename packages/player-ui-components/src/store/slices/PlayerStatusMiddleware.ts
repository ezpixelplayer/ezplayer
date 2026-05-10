import { Action, Middleware } from '@reduxjs/toolkit';
import { AppDispatch } from '../Store';
import { savePlayerSettings } from './PlaybackSettingsStore';

/** Any user edit under the `playbackSettings/` slice triggers an auto-save.
 *  Excluded:
 *    - The save thunk's own lifecycle actions (would re-enter the save).
 *    - `hydratePlaybackSettings`: that action is dispatched by the
 *      `update:playbacksettings` broadcast handler, which fires after main
 *      writes the settings to disk. Saving back from a hydrate produces an
 *      infinite loop (save → broadcast → hydrate → save → …) and burns the
 *      disk under "incessant writes" while quiescent. Hydrate is a load, not
 *      an edit, so it must not trip the auto-save. */
const SETTINGS_PREFIX = 'playbackSettings/';
const SAVE_THUNK_PREFIX = 'playbackSettings/savePlayerSettings/';
const HYDRATE_ACTION = 'playbackSettings/hydratePlaybackSettings';

export const playerSettingsAutoSaveMiddleware: Middleware =
    ({ dispatch }) =>
    (next) =>
    (action) => {
        const aaction = action as Action;
        const adispatch = dispatch as AppDispatch;
        const result = next(aaction);

        if (
            aaction.type.startsWith(SETTINGS_PREFIX) &&
            !aaction.type.startsWith(SAVE_THUNK_PREFIX) &&
            aaction.type !== HYDRATE_ACTION
        ) {
            adispatch(savePlayerSettings()).then().catch(console.error);
        }

        return result;
    };
