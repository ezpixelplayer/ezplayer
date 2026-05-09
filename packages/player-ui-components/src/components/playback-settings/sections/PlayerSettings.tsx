import { FormControl, Typography } from '@mui/material';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Select } from '@ezplayer/shared-ui-components';
import { Box } from '../../box/Box';
import { playbackSettingsActions } from '../../../store/slices/PlaybackSettingsStore';
import type { AppDispatch, RootState } from '../../../store/Store';

export const PlayerSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const settings = useSelector((s: RootState) => s.playbackSettings.settings);

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Player runtime behaviors.
            </Typography>
            <FormControl fullWidth size="small">
                <Select
                    options={[
                        { id: 'overlay', name: 'Overlay' },
                        { id: 'underlay', name: 'Underlay' },
                    ]}
                    itemText="name"
                    itemValue="id"
                    onChange={(e) =>
                        dispatch(
                            playbackSettingsActions.setBackgroundSequence(
                                (e.target as HTMLSelectElement).value as 'overlay' | 'underlay',
                            ),
                        )
                    }
                    label="Background Sequence"
                    value={settings.backgroundSequence}
                />
            </FormControl>
        </Box>
    );
};
