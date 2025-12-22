import * as React from 'react';
import { Box, CircularProgress, Grid } from '@mui/material';
import { useSelector, useDispatch } from 'react-redux';

import { QueueCard } from '../status/QueueCard';
import { AppDispatch, RootState } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';

interface QueueAndControlStackProps {
}

export const QueueAndControlStack: React.FC<QueueAndControlStackProps> = ({}) => {
    const pstat = useSelector((state: RootState) => state.playerStatus);
    const dispatch = useDispatch<AppDispatch>();

    if (!pstat.playerStatus) {
        return (
            <Box display="flex" justifyContent="center" alignItems="center" height="100%">
                <CircularProgress />
            </Box>
        );
    }

    return (
        <Box sx={{ px: 2, pb: 2, flexShrink: 0 }}>
            {/* Now Playing Card and Controller Status */}
            <Grid container spacing={2}>
                <Grid item xs={12} md={12} lg={6} xl={4}>
                    {pstat?.playerStatus?.player?.queue && (
                        <Box sx={{ padding: 2, flexShrink: 0 }}>
                            <QueueCard
                                sx={{
                                    padding: 2,
                                }}
                                queue={pstat.playerStatus.player.queue}
                                onRemoveItem={async (i, _index) => {
                                    await dispatch(
                                        callImmediateCommand({
                                            command: 'deleterequest',
                                            requestId: i.request_id ?? '',
                                        }),
                                    );
                                }}
                            ></QueueCard>
                        </Box>
                    )}
                </Grid>
            </Grid>
        </Box>
    );
};
