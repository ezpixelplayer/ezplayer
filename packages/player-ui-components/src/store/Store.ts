import { configureStore } from '@reduxjs/toolkit';

import sequenceReducer from './slices/SequenceStore';
import playlistReducer from './slices/PlaylistStore';
import scheduleReducer from './slices/ScheduleStore';
import runtimeReducer from './slices/RuntimeStore';
import playbackSettingsReducer from './slices/PlaybackSettingsStore';
import authReducer from './slices/AuthStore';
import cloudConfigReducer from './slices/CloudConfigStore';
import cloudStatusReducer from './slices/CloudStatusStore';
import controllerOpsReducer from './slices/ControllerOpsStore';
import shellAvailableReducer from './slices/ShellAvailabilityStore';

import { DataStorageAPI } from './api/DataStorageAPI';
import { playerSettingsAutoSaveMiddleware } from './slices/PlayerStatusMiddleware';

export const playerReducers = {
    sequences: sequenceReducer,
    playlists: playlistReducer,
    schedule: scheduleReducer,
    runtime: runtimeReducer,
    playbackSettings: playbackSettingsReducer,
    auth: authReducer,
    cloudConfig: cloudConfigReducer,
    cloudStatus: cloudStatusReducer,
    controllerOps: controllerOpsReducer,
    shellAvailable: shellAvailableReducer,
};

export function createAppStore(thunkAPI: DataStorageAPI) {
    return configureStore({
        reducer: playerReducers,
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                thunk: {
                    extraArgument: thunkAPI,
                },
            }).concat(playerSettingsAutoSaveMiddleware),
    });
}

export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
