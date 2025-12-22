import { ActionReducerMapBuilder, createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { SequenceRecord } from '@ezplayer/ezplayer-core';
import { DataStorageAPI } from '../api/DataStorageAPI';

export interface SequenceState {
    sequenceData?: SequenceRecord[];
    updatedSequenceData?: SequenceRecord[];
    tags: string[];
    loading: boolean;
    error?: string;
}

export function createSongSlice(extraReducers: (builder: ActionReducerMapBuilder<SequenceState>) => void) {
    const initialSongState: SequenceState = {
        sequenceData: undefined,
        updatedSequenceData: undefined,
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
                state.tags = [...new Set(action.payload.flatMap((entry) => entry.settings?.tags || []))];
            },
            setUpdatedSequenceData: (state: SequenceState, action: PayloadAction<SequenceRecord[]>) => {
                state.updatedSequenceData = action.payload;
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
            state.tags = [...new Set(action.payload.flatMap((entry) => entry.settings?.tags || []))];
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
            state.updatedSequenceData = undefined;
            state.sequenceData = action.payload;
            state.tags = [...new Set(action.payload.flatMap((entry) => entry.settings?.tags || []))];
        })
        .addCase(postSequenceData.rejected, (state, action) => {
            state.loading = false;
            state.error = action.error.message;
        });
});

export const { setSequenceData, setUpdatedSequenceData, setSequenceTags } = sequenceSlice.actions;
export default sequenceSlice.reducer;
