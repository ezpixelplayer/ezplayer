import * as React from 'react';
import { Box, CircularProgress, Grid, Stack } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { PlayArrow, Pause, Stop, Delete, VolumeUp, StopCircle } from '@mui/icons-material';

import { QueueCard } from '../status/QueueCard';
import { ControlButton } from './ControlButton';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';

interface QueueAndControlStackProps {
}

export const QueueAndControlStack: React.FC<QueueAndControlStackProps> = ({ }) => {
    const pstat = useSelector((state: RootState) => state.playerStatus);
    const dispatch = useDispatch<AppDispatch>();

    if (!pstat.playerStatus) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

    const player = pstat.playerStatus?.player;
    const isPlaying = player?.status === 'Playing';
    const volume = player?.volume?.level ?? 100;
    const muted = player?.volume?.muted ?? false;

    const handlePlayPause = async () => {
        if (isPlaying) {
            await dispatch(callImmediateCommand({ command: 'pause' })).unwrap();
        } else {
            await dispatch(callImmediateCommand({ command: 'resume' })).unwrap();
        }
    };

    const handleStopGraceful = async () => {
        await dispatch(callImmediateCommand({ command: 'stopgraceful' })).unwrap();
    };

    const handleStopAbrupt = async () => {
        await dispatch(callImmediateCommand({ command: 'stopnow' })).unwrap();
    };

    const handleClearRequests = async () => {
        await dispatch(callImmediateCommand({ command: 'clearrequests' })).unwrap();
    };

    const handleVolumeToggle = async () => {
        await dispatch(
            callImmediateCommand({
                command: 'setvolume',
                mute: !muted,
            }),
        ).unwrap();
    };

    return (
        <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
            {/* Control Buttons */}
            <Box sx={{ mb: 2 }}>
                <Stack direction="row" spacing={2} flexWrap="wrap">
                    <ControlButton
                        icon={isPlaying ? Pause : PlayArrow}
                        label={isPlaying ? 'Pause' : 'Play'}
                        onClick={handlePlayPause}
                    />
                    <ControlButton
                        icon={Stop}
                        label="Stop (Graceful)"
                        onClick={handleStopGraceful}
                    />
                    <ControlButton
                        icon={StopCircle}
                        label="Stop (Abrupt)"
                        color="error"
                        onClick={handleStopAbrupt}
                    />
                    <ControlButton
                        icon={Delete}
                        label="Clear Queue"
                        color="error"
                        onClick={handleClearRequests}
                    />
                    <ControlButton
                        icon={VolumeUp}
                        label={muted ? 'Unmute' : 'Mute'}
                        onClick={handleVolumeToggle}
                    />
                </Stack>
            </Box>

            {/* Now Playing Card and Controller Status */}
            <Grid container spacing={2}>
                <Grid item xs={12} md={12} lg={6} xl={4}>
                    {pstat?.playerStatus?.player?.queue && (
                        <QueueCard
                            queue={pstat.playerStatus.player.queue}
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
