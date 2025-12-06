import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Grid,
    Card,
    CardContent,
    Box,
    useTheme,
} from '@mui/material';
import {
    useDispatch
} from 'react-redux';

import { PlaybackStatistics } from '@ezplayer/ezplayer-core';
import { AppDispatch } from '../../store/Store';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';

export interface StatsDialogProps {
    open: boolean;
    onClose: () => void;
    stats?: PlaybackStatistics;
}

export const StatsDialog = ({ open, onClose, stats }: StatsDialogProps) => {
    const theme = useTheme();
    const dispatch = useDispatch<AppDispatch>();

    const formatValue = (value: number | string | undefined) => {
        if (value === undefined || value === null) return '—';
        if (typeof value === 'number') {
            return value.toLocaleString();
        }
        return value;
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
            PaperProps={{
                sx: { minHeight: '400px' },
            }}
        >
            <DialogTitle>
                <Typography variant="h4" fontWeight="bold" color={theme.palette.secondary.main}>
                    Playback Statistics
                </Typography>
            </DialogTitle>
            <DialogContent>
                {!stats ? (
                    <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography variant="h6" color="text.secondary">
                            No playback statistics available
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            Statistics will appear here when the player is running
                        </Typography>
                    </Box>
                ) : (
                    <Grid container spacing={2} sx={{ padding: 2 }}>
                        {/* Performance Metrics */}
                        <Grid item xs={12} md={6}>
                            <Card>
                                <CardContent>
                                    <Typography
                                        variant="h6"
                                        fontWeight="bold"
                                        color={theme.palette.primary.main}
                                        gutterBottom
                                    >
                                        Performance Metrics
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Iteration:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.iteration)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Measurement Interval:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.measurementPeriod)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Idle Time:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.idleTimePeriod)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Send Time:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.sendTimePeriod)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Effect Processing:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.effectsProcessing?.backgroundBlendTimePeriod)}ms background blending
                                            </Typography>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>

                        {/* Frame Statistics */}
                        <Grid item xs={12} md={6}>
                            <Card>
                                <CardContent>
                                    <Typography
                                        variant="h6"
                                        fontWeight="bold"
                                        color={theme.palette.primary.main}
                                        gutterBottom
                                    >
                                        Frame Statistics
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Missed Headers:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.missedHeadersCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Missed Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.missedFramesCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Missed Background Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.missedBackgroundFramesCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Skipped Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.skippedFramesCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Sent Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.sentFramesCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Skipped Frames (High Backlog):</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.framesSkippedDueToManyOutstandingFramesCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Average Send Time:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.avgSendTime)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Max Send Time:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.maxSendTimeHistorical)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Worst Lag:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.worstLagHistorical)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Worst Advance:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.worstAdvanceHistorical)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Controller Frame Skips (intentional):</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.cframesSkippedDueToDirectiveCumulative)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Controller Frame Skips (incomplete):</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.cframesSkippedDueToIncompletePriorCumulative)}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>

                        {/* Worker Statistics */}
                        <Grid item xs={12} md={6}>
                            <Card>
                                <CardContent>
                                    <Typography
                                        variant="h6"
                                        fontWeight="bold"
                                        color={theme.palette.primary.main}
                                        gutterBottom
                                    >
                                        Worker Statistics
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Sequence Read:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.sequenceDecompress?.fileReadTimeCumulative)}ms read; {formatValue(stats.sequenceDecompress?.decompressTimeCumulative)}ms decompress
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Audio Read:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.audioDecode?.fileReadTimeCumulative)}ms read; {formatValue(stats.audioDecode?.decodeTimeCumulative)}ms decode
                                            </Typography>
                                        </Box>
                                    </Box>
                                </CardContent>
                            </Card>
                        </Grid>

                        {/* Error Information */}
                        {stats.lastError && (
                            <Grid item xs={12}>
                                <Card>
                                    <CardContent>
                                        <Typography
                                            variant="h6"
                                            fontWeight="bold"
                                            color={theme.palette.error.main}
                                            gutterBottom
                                        >
                                            Last Error
                                        </Typography>
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                backgroundColor: theme.palette.error.light,
                                                padding: 1,
                                                borderRadius: 1,
                                                fontFamily: 'monospace',
                                                wordBreak: 'break-word',
                                            }}
                                        >
                                            {stats.lastError}
                                        </Typography>
                                    </CardContent>
                                </Card>
                            </Grid>
                        )}
                    </Grid>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={async ()=> {
                    await dispatch(callImmediateCommand({command: 'resetstats'})).unwrap();
                }} variant="contained" color="primary">
                    Reset
                </Button>
                <Button onClick={onClose} variant="contained" color="primary">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};
