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
