import * as React from 'react';
import { CircularProgress, Grid } from '@mui/material';
import { Box } from '../box/Box';
import { useSelector, useDispatch } from 'react-redux';
import { isPlaybackActive } from '@ezplayer/ezplayer-core';

import { QueueCard } from '../status/QueueCard';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import { PlaybackControls } from './PlaybackControls';

interface QueueAndControlStackProps {
    /** Forwarded to PlaybackControls — hides End/Abort in kiosk mode. Defaults to true. */
    allowStopControls?: boolean;
}

export const QueueAndControlStack: React.FC<QueueAndControlStackProps> = ({ allowStopControls = true }) => {
    const runtime = useSelector((state: RootState) => state.runtime);
    const dispatch = useDispatch<AppDispatch>();

    if (!runtime.combined) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

    const player = runtime.combined.player;
    const active = isPlaybackActive(player?.status);
    const queue = player?.queue ?? [];
    // Nothing playing and nothing waiting: no controls, and no gap where they would be.
    if (!active && queue.length === 0) return null;

    return (
        <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
            {/* Playback control buttons */}
            {active && (
                <Box sx={{ mb: 2 }}>
                    <PlaybackControls allowStopControls={allowStopControls} />
                </Box>
            )}

            {/* Queue */}
            <Grid container spacing={2}>
                <Grid item xs={12}>
                    {queue.length > 0 && (
                        <QueueCard
                            queue={queue}
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
