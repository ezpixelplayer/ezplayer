import { ActionReducerMapBuilder, PayloadAction, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { PlaylistRecord } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface PlaylistState {
    playlists: PlaylistRecord[];
    tags: string[];
    loading: boolean;
    error?: string;
}

/** Derive the unique tag set from a playlist list. Used in three places — keep
 *  in one helper so the access path only lives once. */
function tagsFromPlaylists(records: PlaylistRecord[]): string[] {
    return [...new Set(records.flatMap((entry) => entry.tags || []))];
}

export function createPlaylistSlice(extraReducers: (builder: ActionReducerMapBuilder<PlaylistState>) => void) {
    const initialPlaylistState: PlaylistState = {
        playlists: [],
        tags: [],
        loading: false,
        error: undefined,
    };

    return createSlice({
        name: 'playlists',
        initialState: initialPlaylistState,
        reducers: {
            setPlaylists: (state: PlaylistState, action: PayloadAction<PlaylistRecord[]>) => {
                state.playlists = action.payload;
                state.tags = tagsFromPlaylists(action.payload);
            },
            addTag: (state: PlaylistState, action: PayloadAction<string>) => {
                if (!state.tags.includes(action.payload)) {
                    state.tags.push(action.payload);
                }
            },
        },
        extraReducers,
    });
}

export const fetchPlaylists = createAsyncThunk<PlaylistRecord[], void, { extra: DataStorageAPI }>(
    'playlists/fetchPlaylists',
    async (_, { extra }) => await extra.getCloudPlaylists(),
);

export const postPlaylistData = createAsyncThunk<PlaylistRecord[], PlaylistRecord[], { extra: DataStorageAPI }>(
    'playlists/postPlaylistData',
    async (newPlaylist: PlaylistRecord[], { extra }) => {
        try {
            const response = await extra.postCloudPlaylists(newPlaylist);
            return response;
        } catch (error) {
            console.error('Error in postPlaylistData:', error);
            throw error;
        }
    },
);

const playlistSlice = createPlaylistSlice((builder) => {
    builder
        .addCase(fetchPlaylists.pending, (state, _action) => {
            state.loading = true;
        })
        .addCase(fetchPlaylists.fulfilled, (state, action) => {
            state.loading = false;
            state.playlists = action.payload;
            state.tags = tagsFromPlaylists(action.payload);
        })
        .addCase(fetchPlaylists.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postPlaylistData.pending, (state, _action) => {
            state.loading = true;
        })
        .addCase(postPlaylistData.fulfilled, (state, action) => {
            state.loading = false;
            state.playlists = action.payload;
            state.tags = tagsFromPlaylists(action.payload);
        })
        .addCase(postPlaylistData.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const { setPlaylists, addTag } = playlistSlice.actions;
export default playlistSlice.reducer;
