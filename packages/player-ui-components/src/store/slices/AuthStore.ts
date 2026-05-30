import { ActionReducerMapBuilder, PayloadAction, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { UserRegisterBody } from '../api/DataStorageAPI';
import { EZPlayerVersions } from '@ezplayer/ezplayer-core';

export interface AuthState {
    // User-auth state. The cloud-config (URL + player token) and cloud-status
    // (registration + version + reachability via lastError) live in the
    // `cloudConfig` and `cloudStatus` slices.

    // FUTURE; some player-specific interaction is offloaded from main URL; established by cloud service
    //  This is expected only as diagnostic info, established in the API layer
    playerRemoteUrl?: string;

    cloudUserToken: string | null; // True if we're logged in (we think)

    loading: boolean;
    error?: string;

    // Show folder path selected in the electron app
    showDirectory?: string;

    // TODO CRAZ is this redundant with end user slice?
    user?: UserRegisterBody;
    forgotPassword?: string;
    changePassword?: string;

    playerVersion?: EZPlayerVersions;
}

/**
 * Slice factory taking an `extraReducers` callback so callers can compose additional
 * reducer cases for thunks they bring along.
 */
export function createAuthSlice(extraReducers: (builder: ActionReducerMapBuilder<AuthState>) => void) {
    // Seed token synchronously so AuthGate's first render skips the LoginPanel when we're
    // already logged in. Otherwise the browser sees the login form for one paint and
    // triggers autofill before InitialDataProvider's async refreshAll() sets the token.
    const initialToken = typeof window !== 'undefined' ? (window.localStorage?.getItem('auth_token') ?? null) : null;

    const initialAuthState: AuthState = {
        cloudUserToken: initialToken,
        playerRemoteUrl: undefined,
        showDirectory: undefined,

        loading: false,
        error: undefined,
        user: undefined,
        forgotPassword: undefined,
        changePassword: undefined,

        playerVersion: undefined,
    };

    return createSlice({
        name: 'auth',
        initialState: initialAuthState,
        reducers: {
            setUserToken: (state: AuthState, action: PayloadAction<string | null>) => {
                state.cloudUserToken = action.payload;
            },
            setPlayerVersion: (state: AuthState, action: PayloadAction<EZPlayerVersions>) => {
                state.playerVersion = action.payload;
            },
            setShowDirectory: (state: AuthState, action: PayloadAction<string>) => {
                state.showDirectory = action.payload;
            },
            logout: (state: AuthState) => {
                state.cloudUserToken = null;
                state.error = undefined;
                // TODO CRAZ Call this from withing the API
            },
        },
        extraReducers,
    });
}

export const postSetPlayerIdToken = createAsyncThunk<void, { playerIdToken: string }, { extra: DataStorageAPI }>(
    'auth/postSetPlayerId',
    async (data, { extra }) => {
        await extra.issueCloudCommand({ type: 'setPlayerIdToken', token: data.playerIdToken });
    },
);

export const postSetCloudUrl = createAsyncThunk<void, { cloudUrl: string }, { extra: DataStorageAPI }>(
    'auth/postSetCloudUrl',
    async (data, { extra }) => {
        await extra.issueCloudCommand({ type: 'setCloudServiceUrl', url: data.cloudUrl });
    },
);

export const setShowDirectoryPath = createAsyncThunk<void, { directoryPath: string }, { state: { auth: AuthState } }>(
    'auth/setShowDirectoryPath',
    async (data: { directoryPath: string }, { dispatch }) => {
        try {
            dispatch(authSlice.actions.setShowDirectory(data.directoryPath));
            return;
        } catch (error) {
            console.error('Error in setShowDirectoryPath:', error);
            throw error;
        }
    },
);

/** Reducer cases for the player-side auth thunks. */
export function applyPlayerAuthExtraReducers(builder: ActionReducerMapBuilder<AuthState>) {
    builder
        .addCase(postSetPlayerIdToken.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postSetPlayerIdToken.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postSetPlayerIdToken.fulfilled, (state, _action) => {
            state.loading = false;
            state.error = undefined;
        })
        .addCase(postSetCloudUrl.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postSetCloudUrl.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postSetCloudUrl.fulfilled, (state, _action) => {
            state.loading = false;
            //state.cloudServiceUrl = action.payload (actually set from inside thunk)
            state.error = undefined;
        })
        .addCase(setShowDirectoryPath.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(setShowDirectoryPath.fulfilled, (state, _action) => {
            state.loading = false;
            state.error = undefined;
        })
        .addCase(setShowDirectoryPath.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
}

const authSlice = createAuthSlice(applyPlayerAuthExtraReducers);

export const authSliceActions = authSlice.actions;
export default authSlice.reducer;
