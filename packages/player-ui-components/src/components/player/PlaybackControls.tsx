import React from 'react';
import { Stack } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { PlayArrow, Pause, Stop, StopCircle, SkipNext, Delete, VolumeUp, VolumeOff } from '@mui/icons-material';

import { ControlButton } from './ControlButton';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';

export const PlaybackControls: React.FC = () => {
    const pstat = useSelector((state: RootState) => state.playerStatus);
    const dispatch = useDispatch<AppDispatch>();

    const player = pstat.playerStatus?.player;
    const isPlaying = player?.status === 'Playing';
    const isPaused = player?.status === 'Paused';
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

    const handleStopNow = async () => {
        await dispatch(callImmediateCommand({ command: 'stopnow' })).unwrap();
    };

    const handleSkip = async () => {
        await dispatch(callImmediateCommand({ command: 'endsong' })).unwrap();
    };

    /*
    // This goes w/ Queue more naturally
    const handleClearRequests = async () => {
        await dispatch(callImmediateCommand({ command: 'clearrequests' })).unwrap();
    };

    // This goes w/ volume more naturally
    const handleVolumeToggle = async () => {
        await dispatch(callImmediateCommand({ command: 'setvolume', mute: !muted })).unwrap();
    };
    */

    return (
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <ControlButton
                icon={isPlaying ? Pause : PlayArrow}
                label={isPlaying ? 'Pause' : isPaused ? 'Resume' : 'Play'}
                onClick={handlePlayPause}
            />
            <ControlButton icon={SkipNext} label="Skip Song" onClick={handleSkip} />
            <ControlButton icon={Stop} label="Stop (Graceful)" onClick={handleStopGraceful} />
            <ControlButton icon={StopCircle} label="Stop Now" color="error" onClick={handleStopNow} />
            {/*<ControlButton icon={Delete} label="Clear Queue" color="warning" onClick={handleClearRequests} />*/}
            {/*
            <ControlButton
                icon={muted ? VolumeOff : VolumeUp}
                label={muted ? 'Unmute' : 'Mute'}
                onClick={handleVolumeToggle}
            />
            */}
        </Stack>
    );
};
