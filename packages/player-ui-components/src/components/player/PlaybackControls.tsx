import React from 'react';
import { Stack } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';
import { PlayArrow, Pause, Stop, StopCircle, SkipNext } from '@mui/icons-material';
import { isPlaybackActive } from '@ezplayer/ezplayer-core';

import { ControlButton } from './ControlButton';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';

interface PlaybackControlsProps {
    /** When false (kiosk mode), hide the "End" (graceful stop) and "Abort" (hard stop)
     *  buttons so a public display can't stop the show. Defaults to true. */
    allowStopControls?: boolean;
}

export const PlaybackControls: React.FC<PlaybackControlsProps> = ({ allowStopControls = true }) => {
    const runtime = useSelector((state: RootState) => state.runtime);
    const dispatch = useDispatch<AppDispatch>();

    const status = runtime.combined?.player?.status;
    const isPaused = status === 'Paused';
    // A graceful stop is under way: the current song (and any outro) is still playing.
    const isStopping = status === 'Stopping';

    // These act on what is playing; with nothing playing there is nothing to show.
    if (!isPlaybackActive(status)) return null;

    const handlePlayPause = async () => {
        await dispatch(callImmediateCommand({ command: isPaused ? 'resume' : 'pause' })).unwrap();
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
                icon={isPaused ? PlayArrow : Pause}
                label={isPaused ? 'Resume' : 'Pause'}
                onClick={handlePlayPause}
            />
            <ControlButton icon={SkipNext} label="Skip" onClick={handleSkip} />
            {allowStopControls && (
                <ControlButton
                    icon={Stop}
                    label={isStopping ? 'Ending' : 'End'}
                    onClick={handleStopGraceful}
                    disabled={isStopping}
                />
            )}
            {allowStopControls && (
                <ControlButton icon={StopCircle} label="Abort" color="error" onClick={handleStopNow} />
            )}
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
