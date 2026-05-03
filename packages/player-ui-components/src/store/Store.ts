import { configureStore } from '@reduxjs/toolkit';

import sequenceReducer from './slices/SequenceStore';
import playlistReducer from './slices/PlaylistStore';
import scheduleReducer from './slices/ScheduleStore';
import playerStatusReducer from './slices/PlayerStatusStore';
import authReducer from './slices/AuthStore';

import { DataStorageAPI } from './api/DataStorageAPI';
import { playerSettingsAutoSaveMiddleware } from './slices/PlayerStatusMiddleware';

export const playerReducers = {
    sequences: sequenceReducer,
    playlists: playlistReducer,
    schedule: scheduleReducer,
    playerStatus: playerStatusReducer,
    auth: authReducer,
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
