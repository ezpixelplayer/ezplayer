import * as React from 'react';
import { CircularProgress, Grid } from '@mui/material';
import { Box } from '../box/Box';
import { useSelector, useDispatch } from 'react-redux';

import { QueueCard } from '../status/QueueCard';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import { PlaybackControls } from './PlaybackControls';

interface QueueAndControlStackProps {}

export const QueueAndControlStack: React.FC<QueueAndControlStackProps> = ({}) => {
    const runtime = useSelector((state: RootState) => state.runtime);
    const dispatch = useDispatch<AppDispatch>();

    if (!runtime.combined) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
            {/* Playback control buttons */}
            <Box sx={{ mb: 2 }}>
                <PlaybackControls />
            </Box>

            {/* Queue */}
            <Grid container spacing={2}>
                <Grid item xs={12} md={12} lg={6} xl={4}>
                    {runtime?.combined?.player?.queue && (
                        <QueueCard
                            queue={runtime.combined.player.queue}
                            onRemoveItem={async (i, _index) => {
                                await dispatch(
                                    callImmediateCommand({
                                        command: 'deleterequest',
                                        requestId: i.request_id ?? '',
                                    }),
                                );
                            }}
                        />
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};
