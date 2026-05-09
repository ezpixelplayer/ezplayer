import { Action, Middleware } from '@reduxjs/toolkit';
import { AppDispatch } from '../Store';
import { savePlayerSettings } from './PlaybackSettingsStore';

/** Any action under the `playbackSettings/` slice triggers an auto-save except for
 *  the save thunk's own lifecycle actions (which would loop). */
const SETTINGS_PREFIX = 'playbackSettings/';
const SAVE_THUNK_PREFIX = 'playbackSettings/savePlayerSettings/';

export const playerSettingsAutoSaveMiddleware: Middleware =
    ({ dispatch }) =>
    (next) =>
    (action) => {
        const aaction = action as Action;
        const adispatch = dispatch as AppDispatch;
        const result = next(aaction);

        if (
            aaction.type.startsWith(SETTINGS_PREFIX) &&
            !aaction.type.startsWith(SAVE_THUNK_PREFIX)
        ) {
            adispatch(savePlayerSettings()).then().catch(console.error);
        }

        return result;
    };
