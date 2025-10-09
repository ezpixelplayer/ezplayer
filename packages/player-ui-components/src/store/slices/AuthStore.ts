import { ActionReducerMapBuilder, PayloadAction, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { DataStorageAPI } from '../api/DataStorageAPI';
import { UserLoginBody, UserRegisterBody } from '../api/DataStorageAPI';
import { AxiosError } from 'axios';

export interface AuthState {
    // This is called the "Auth" slice... and it does have the authentication info in it.
    //  But... it's really more of a "connectivity" slice.
    //    It remembers what whe can connect to, how we're connected, if there's an error, outstanding request, etc.
    // Capabilities exposed
    //  Recall that there are 3 scenarios:
    //   Cloud console - doesn't do any playing, no player token, but does let you see and D/L your stuff.  Login required
    //   Player electron - local - allows adding/removing local files, player token, and/or cloud login
    //   Player remote HTTP - by rights, data should be saved on the player for aggregation w/ its local store, rather than go via the cloud

    // Placeholder - for capabilities o
    supportsLogin: boolean;
    supportsToken: boolean;

    cloudServiceUrl: string; // Cloud service; if empty the cloud service is disabled

    // FUTURE; some player-specific interaction is offloaded from main URL; established by cloud service
    //  This is expected only as diagnostic info, established in the API layer
    playerRemoteUrl?: string;

    cloudIsReachable: boolean; // True if we're able to access the cloud
    cloudUserToken: string | null; // True if we're logged in (we think)
    playerIdToken: string; // Used to access player-side API without being logged in - this may be registered to a user.

    // Note - this DOES NOT MEAN that the player is registered to *this* user.
    //   For that, we can check to see if playerIdToken is in the list in the user slice
    // This tells us if we have a registered player at all, within the cloud service
    playerIdIsRegistered: boolean;

    loading: boolean;
    error?: string;

    // Show directory path selected in the electron app
    showDirectory?: string;

    // TODO CRAZ is this redundant with end user slice?
    user?: UserRegisterBody;
    forgotPassword?: string; // Message that comes back from forgot password rq
    changePassword?: string; // Message that comes back from change password rq

    // Software version - we may add cloud service version FYI beside this
    playerVersion: string;
    cloudVersion: string;
}

export function createAuthSlice(extraReducers: (builder: ActionReducerMapBuilder<AuthState>) => void) {
    const initialAuthState: AuthState = {
        supportsLogin: true,
        supportsToken: true,

        cloudServiceUrl: '',
        cloudIsReachable: false,
        cloudUserToken: null,
        playerIdToken: '',
        playerIdIsRegistered: false,
        playerRemoteUrl: undefined,
        showDirectory: undefined,

        loading: false,
        error: undefined,
        user: undefined,
        forgotPassword: undefined,
        changePassword: undefined,

        playerVersion: 'EZPlayer (MMPP Fork) 0.0.7 prealpha - 2025-10-02; EPP 0.0.14',
        cloudVersion: 'unknown',
    };

    return createSlice({
        name: 'auth',
        initialState: initialAuthState,
        reducers: {
            setSupportsLogin: (state: AuthState, action: PayloadAction<boolean>) => {
                state.supportsLogin = action.payload;
            },
            setSupportsToken: (state: AuthState, action: PayloadAction<boolean>) => {
                state.supportsToken = action.payload;
            },
            setCloudServiceUrl: (state: AuthState, action: PayloadAction<string>) => {
                state.cloudServiceUrl = action.payload;
            },
            setCloudIsReachable: (state: AuthState, action: PayloadAction<boolean>) => {
                state.cloudIsReachable = action.payload;
            },
            setUserToken: (state: AuthState, action: PayloadAction<string | null>) => {
                state.cloudUserToken = action.payload;
            },
            setPlayerIdToken: (state: AuthState, action: PayloadAction<string>) => {
                state.playerIdToken = action.payload;
            },
            setPlayerIsRegistered: (state: AuthState, action: PayloadAction<boolean>) => {
                state.playerIdIsRegistered = action.payload;
            },
            setCloudVersion: (state: AuthState, action: PayloadAction<string>) => {
                state.cloudVersion = action.payload;
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

export const postLoginData = createAsyncThunk<string, UserLoginBody, { extra: DataStorageAPI }>(
    'auth/postLoginData',
    async (serverLoginData: UserLoginBody, { extra }) => {
        try {
            const token = await extra.requestLoginToken(serverLoginData);
            if (!token) {
                throw new Error('No token received from login API');
            }
            return token;
        } catch (error) {
            console.error('Error in postLoginData:', error);
            throw error;
        }
    },
);

export const requestLogout = createAsyncThunk<void, void, { extra: DataStorageAPI }>(
    'auth/requestLogout',
    async (_serverLoginData: void, { extra }) => {
        try {
            await extra.requestLogout();
            return;
        } catch (error) {
            console.error('Error in requestLogout', error);
            throw error;
        }
    },
);

export const postRegisterData = createAsyncThunk<
    UserRegisterBody,
    UserRegisterBody,
    { extra: DataStorageAPI; rejectValue: { status: number; message: string } } // add rejectValue typing
>('auth/postRegisterData', async (data: UserRegisterBody, { extra, rejectWithValue }) => {
    try {
        const response = await extra.postCloudRegister(data);
        return response;
    } catch (e) {
        const err = e as AxiosError<{ message?: string }>;
        if (err.response) {
            return rejectWithValue({
                status: err.response.status,
                message: err.response.data?.message || 'Something went wrong',
            });
        }
        throw err;
    }
});

export const postRequestPasswordReset = createAsyncThunk<
    { message: string },
    { email: string },
    { extra: DataStorageAPI }
>('auth/postRequestPasswordReset', async (data: { email: string }, { extra }) => {
    try {
        const response = await extra.postRequestPasswordReset(data);
        return response;
    } catch (error) {
        console.error('Error in postRequestPasswordReset:', error);
        throw error;
    }
});

export const postChangePassword = createAsyncThunk<
    { message: string },
    { oldPassword: string; newPassword: string },
    { extra: DataStorageAPI }
>('auth/postChangePassword', async (data: { oldPassword: string; newPassword: string }, { extra }) => {
    try {
        const response = await extra.postChangePassword(data);
        return response;
    } catch (error) {
        console.error('Error in postChangePassword:', error);
        throw error;
    }
});

export const postRegisterPlayer = createAsyncThunk<
    { message: string },
    { playerId: string },
    { extra: DataStorageAPI }
>('auth/postRegisterPlayer', async (data: { playerId: string }, { extra }) => {
    try {
        const response = await extra.postRegisterPlayer(data);
        return response;
    } catch (error) {
        console.error('Error in postRegisterPlayer:', error);
        throw error;
    }
});

export const postSetPlayerIdToken = createAsyncThunk<
    { message: string },
    { playerIdToken: string },
    { extra: DataStorageAPI }
>('auth/postSetPlayerId', async (data: { playerIdToken: string }, { extra }) => {
    try {
        const response = await extra.requestSetPlayerIdToken(data);
        return response;
    } catch (error) {
        console.error('Error in postSetPlayerIdToken:', error);
        throw error;
    }
});

export const postSetCloudUrl = createAsyncThunk<{}, { cloudUrl: string }, { extra: DataStorageAPI }>(
    'auth/postSetCloudUrl',
    async (data: { cloudUrl: string }, { extra }) => {
        try {
            return await extra.requestChangeServerUrl({ cloudURL: data.cloudUrl });
        } catch (error) {
            console.error('Error in setCloudUrl:', error);
            throw error;
        }
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

const authSlice = createAuthSlice((builder) => {
    builder
        .addCase(postLoginData.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postLoginData.fulfilled, (state, action) => {
            state.loading = false;
            state.cloudUserToken = action.payload;
            state.error = undefined;
        })
        .addCase(postLoginData.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(requestLogout.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(requestLogout.fulfilled, (state, _action) => {
            state.loading = false;
            state.cloudUserToken = null;
            state.error = undefined;
        })
        .addCase(requestLogout.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postRegisterData.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postRegisterData.fulfilled, (state, action) => {
            state.loading = false;
            state.user = action.payload;
            state.error = undefined;
        })
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
        .addCase(postRegisterData.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postRequestPasswordReset.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postRequestPasswordReset.fulfilled, (state, action) => {
            state.loading = false;
            state.forgotPassword = action.payload.message;
            state.error = undefined;
        })
        .addCase(postRequestPasswordReset.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postChangePassword.pending, (state, _action) => {
            state.loading = true;
            state.error = undefined;
        })
        .addCase(postChangePassword.fulfilled, (state, _action) => {
            state.loading = false;
            state.changePassword = _action.payload.message;
            state.error = undefined;
        })
        .addCase(postChangePassword.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
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
});

export const authSliceActions = authSlice.actions;
export default authSlice.reducer;
