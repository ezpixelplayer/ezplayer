import { ActionReducerMapBuilder, createSlice, PayloadAction, createAsyncThunk } from '@reduxjs/toolkit';

import { EndUser, UserPlayer } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface UserProfileState {
    endUser?: EndUser;
    userPlayers?: UserPlayer[];

    loading: boolean;
    error?: string;
}

export const initialUserProfileState: UserProfileState = {
    endUser: undefined,
    userPlayers: [],

    loading: false,
    error: undefined,
};

export function createEndUserSlice(extraReducers: (builder: ActionReducerMapBuilder<UserProfileState>) => void) {
    return createSlice({
        name: 'endUser',
        initialState: initialUserProfileState,
        reducers: {
            setEndUser: (state: UserProfileState, action: PayloadAction<EndUser>) => {
                state.endUser = action.payload;
            },
        },
        extraReducers,
    });
}

export const fetchUserProfile = createAsyncThunk<
    { user: EndUser; players: UserPlayer[] },
    void,
    { extra: DataStorageAPI }
>('endUser/fetchUserProfile', async (_, { extra }) => {
    const responseu = await extra.getCloudUserProfile();
    const responsep = await extra.getUserPlayers();
    return { user: responseu, players: responsep };
});

export const postUserProfile = createAsyncThunk<EndUser, Partial<EndUser>, { extra: DataStorageAPI }>(
    'endUser/postUserProfile',
    async (endUser: Partial<EndUser>, { extra }) => {
        return await extra.postCloudUserProfile(endUser);
    },
);

const userProfileSlice = createEndUserSlice((builder) => {
    builder
        .addCase(fetchUserProfile.pending, (state) => {
            state.loading = true;
        })
        .addCase(fetchUserProfile.fulfilled, (state, action) => {
            state.loading = false;
            state.endUser = action.payload.user;
            state.userPlayers = action.payload.players;
        })
        .addCase(fetchUserProfile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postUserProfile.pending, (state, _action) => {
            state.loading = true;
        })
        .addCase(postUserProfile.fulfilled, (state, action) => {
            state.loading = false;
            state.endUser = action.payload;
        })
        .addCase(postUserProfile.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const { setEndUser } = userProfileSlice.actions;

export default userProfileSlice.reducer;
