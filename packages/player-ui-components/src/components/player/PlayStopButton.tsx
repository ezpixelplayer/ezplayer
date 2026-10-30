import React from 'react';
import { Button } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import { useDispatch } from 'react-redux';

import { AppDispatch } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import { useActiveRequest } from '../../hooks/useActiveRequest';

interface PlayStopButtonProps {
    /** The song or playlist this row plays. */
    target: { songId: string } | { playlistId: string };
    onPlay: () => void;
    sx?: React.ComponentProps<typeof Button>['sx'];
}

/**
 * A row's "Play immediately" action, which becomes Stop while the request it
 * started is playing.  Stop ends that request at once and whatever it
 * interrupted carries on.
 */
export const PlayStopButton: React.FC<PlayStopButtonProps> = ({ target, onPlay, sx }) => {
    const dispatch = useDispatch<AppDispatch>();
    const requestId = useActiveRequest(target);

    if (requestId) {
        return (
            <Button
                aria-label="stop"
                title="Stop"
                startIcon={<StopIcon />}
                size="small"
                color="error"
                onClick={() => void dispatch(callImmediateCommand({ command: 'deleterequest', requestId }))}
                sx={sx}
            />
        );
    }
    return (
        <Button
            aria-label="play"
            title="Play immediately"
            startIcon={<PlayArrowIcon />}
            size="small"
            color="success"
            onClick={onPlay}
            sx={sx}
        />
    );
};
