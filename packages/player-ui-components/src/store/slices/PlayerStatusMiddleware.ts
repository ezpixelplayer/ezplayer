import { Action, Middleware } from "@reduxjs/toolkit";
import { AppDispatch } from "../Store";
import { savePlayerSettings } from "./PlayerStatusStore";

export const SYNC_SETTINGS_ACTION_TYPES = new Set<string>([
    'playerStatus/setAudioSyncAdjust',
    'playerStatus/setBackgroundSequence',
    'playerStatus/setViewerControlEnabled',
    'playerStatus/setViewerControlType',
    'playerStatus/setRemoteFalconToken',
    'playerStatus/addViewerControlScheduleEntry',
    'playerStatus/removeViewerControlScheduleEntry',
    'playerStatus/setDefaultVolume',
    'playerStatus/addVolumeScheduleEntry',
    'playerStatus/removeVolumeScheduleEntry',
]);

export const playerSettingsAutoSaveMiddleware: Middleware = ({ dispatch }) => next => action =>
{
    const aaction = action as Action;
    const adispatch = dispatch as AppDispatch;
    const result = next(aaction);

    if (SYNC_SETTINGS_ACTION_TYPES.has(aaction.type)) {
        adispatch(savePlayerSettings()).then().catch(console.error);
    }

    return result;
};
