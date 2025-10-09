import React from 'react';
import { Stack } from '@mui/material';
import { PlayArrow, Pause, Stop, Delete, QueueMusic, VolumeUp, BrightnessHigh, StopCircle } from '@mui/icons-material';
import { ControlButton } from './ControlButton';

export const FullPlayerControlStack: React.FC = () => {
    return (
        <Stack direction="row" spacing={2}>
            <ControlButton icon={PlayArrow} label="Play" onClick={() => console.log('Play')} />
            <ControlButton icon={Pause} label="Pause" onClick={() => console.log('Pause')} />
            <ControlButton icon={Stop} label="Stop (Graceful)" onClick={() => console.log('Stop Gracefully')} />
            <ControlButton
                icon={StopCircle}
                label="Stop (Abrupt)"
                color="error"
                onClick={() => console.log('Stop Abruptly')}
            />
            <ControlButton icon={QueueMusic} label="Enqueue" onClick={() => console.log('Enqueue')} />
            <ControlButton icon={Delete} label="Delete" color="error" onClick={() => console.log('Delete')} />
            <ControlButton icon={VolumeUp} label="Volume" onClick={() => console.log('Volume')} />
            <ControlButton icon={BrightnessHigh} label="Brightness" onClick={() => console.log('Brightness')} />
        </Stack>
    );
};
