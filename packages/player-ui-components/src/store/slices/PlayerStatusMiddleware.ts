import { Action, Middleware } from '@reduxjs/toolkit';
import { AppDispatch } from '../Store';
import { savePlayerSettings } from './PlaybackSettingsStore';

/** Auto-saves on user edits under the `playbackSettings/` slice. Excludes
 *  the save thunk itself (re-entry), `hydratePlaybackSettings` (a load, not
 *  an edit), and any thunk lifecycle suffix — `/pending` in particular fires
 *  before the post-fetch hydrate lands, so a save would read DEFAULTS and
 *  clobber the persisted settings. Only reducer dispatches count as edits. */
const SETTINGS_PREFIX = 'playbackSettings/';
const SAVE_THUNK_PREFIX = 'playbackSettings/savePlayerSettings/';
const HYDRATE_ACTION = 'playbackSettings/hydratePlaybackSettings';
const THUNK_LIFECYCLE_SUFFIXES = ['/pending', '/fulfilled', '/rejected'] as const;

export const playerSettingsAutoSaveMiddleware: Middleware =
    ({ dispatch }) =>
    (next) =>
    (action) => {
        const aaction = action as Action;
        const adispatch = dispatch as AppDispatch;
        const result = next(aaction);

        const isLifecycle = THUNK_LIFECYCLE_SUFFIXES.some((s) => aaction.type.endsWith(s));

        if (
            aaction.type.startsWith(SETTINGS_PREFIX) &&
            !aaction.type.startsWith(SAVE_THUNK_PREFIX) &&
            aaction.type !== HYDRATE_ACTION &&
            !isLifecycle
        ) {
            adispatch(savePlayerSettings()).then().catch(console.error);
        }

        return result;
    };
