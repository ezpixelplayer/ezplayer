import { ActionReducerMapBuilder, createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SequenceRecord } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface SequenceState {
    sequenceData?: SequenceRecord[];
    tags: string[];
    loading: boolean;
    error?: string;
}

/** Derive the unique tag set from a sequence list. Used in three places — keep
 *  in one helper so the access path (`entry.settings?.tags`) only lives once. */
function tagsFromSequences(records: SequenceRecord[]): string[] {
    return [...new Set(records.flatMap((entry) => entry.settings?.tags || []))];
}

export function createSongSlice(extraReducers: (builder: ActionReducerMapBuilder<SequenceState>) => void) {
    const initialSongState: SequenceState = {
        sequenceData: undefined,
        tags: [],
        loading: false,
        error: undefined,
    };

    return createSlice({
        name: 'sequences',
        initialState: initialSongState,
        reducers: {
            setSequenceData: (state: SequenceState, action: PayloadAction<SequenceRecord[]>) => {
                state.sequenceData = action.payload;
                state.tags = tagsFromSequences(action.payload);
            },
            setSequenceTags: (state: SequenceState, action: PayloadAction<string[]>) => {
                state.tags = action.payload;
            },
        },
        extraReducers,
    });
}

export const fetchSequences = createAsyncThunk<SequenceRecord[], void, { extra: DataStorageAPI }>(
    'sequences/fetchSeqeuences',
    async (_, { extra }) => {
        const response = await extra.getCloudSequences();
        return response;
    },
);

export const postSequenceData = createAsyncThunk<SequenceRecord[], SequenceRecord[], { extra: DataStorageAPI }>(
    'sequences/postSequenceData',
    async (sequenceData: SequenceRecord[], { extra }) => {
        const response = await extra.postCloudSequences(sequenceData);
        return response;
    },
);

/** True when the connected backing store can receive file uploads (web/LAN
 *  file-management API). Electron's renderer works with local paths instead. */
export function canUploadShowFiles(extra: DataStorageAPI): boolean {
    return typeof extra.uploadShowFile === 'function';
}

/** Upload files into the player's show folder (dialog-free remote add-song
 *  flow). No-op entries are allowed so callers can pass optional files. */
export const uploadShowFiles = createAsyncThunk<void, Array<{ name: string; data: Blob } | undefined>, { extra: DataStorageAPI }>(
    'sequences/uploadShowFiles',
    async (files, { extra }) => {
        if (!extra.uploadShowFile) {
            throw new Error('This player connection does not support file upload');
        }
        for (const f of files) {
            if (f) await extra.uploadShowFile(f.name, f.data);
        }
    },
);

const sequenceSlice = createSongSlice((builder) => {
    builder
        .addCase(fetchSequences.pending, (state) => {
            state.loading = true;
        })
        .addCase(fetchSequences.fulfilled, (state, action) => {
            state.loading = false;
            state.sequenceData = action.payload;
            state.tags = tagsFromSequences(action.payload);
        })
        .addCase(fetchSequences.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        })
        .addCase(postSequenceData.pending, (state) => {
            state.loading = true;
        })
        .addCase(postSequenceData.fulfilled, (state, action) => {
            state.loading = false;
            state.sequenceData = action.payload;
            state.tags = tagsFromSequences(action.payload);
        })
        .addCase(postSequenceData.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const { setSequenceData, setSequenceTags } = sequenceSlice.actions;
export default sequenceSlice.reducer;
