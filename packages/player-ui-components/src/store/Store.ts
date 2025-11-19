import { configureStore } from '@reduxjs/toolkit';

import sequenceReducer from './slices/SequenceStore';
import playlistReducer from './slices/PlaylistStore';
import scheduleReducer from './slices/ScheduleStore';
import homeStoreSlice from './slices/HomeStore';
import playerStatusReducer from './slices/PlayerStatusStore';
import endUserReducer from './slices/UserProfileStore';
import showProfileReducer from './slices/ShowProfileStore';
import authReducer from './slices/AuthStore';
import layoutReducer from './slices/LayoutStore';

import { DataStorageAPI } from './api/DataStorageAPI';

export function createAppStore(thunkAPI: DataStorageAPI) {
    return configureStore({
        reducer: {
            sequences: sequenceReducer,
            playlists: playlistReducer,
            schedule: scheduleReducer,
            homeStore: homeStoreSlice,
            playerStatus: playerStatusReducer,
            endUser: endUserReducer,
            showProfile: showProfileReducer,
            auth: authReducer,
            layoutEdit: layoutReducer,
        },
        middleware: (getDefaultMiddleware) =>
            getDefaultMiddleware({
                thunk: {
                    extraArgument: thunkAPI,
                },
            }),
    });
}

export type AppStore = ReturnType<typeof createAppStore>;
export type RootState = ReturnType<AppStore['getState']>;
export type AppDispatch = AppStore['dispatch'];
