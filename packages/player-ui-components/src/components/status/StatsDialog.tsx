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
import { PlaybackStatistics } from '@ezplayer/ezplayer-core';

export interface StatsDialogProps {
    open: boolean;
    onClose: () => void;
    stats?: PlaybackStatistics;
}

export const StatsDialog = ({ open, onClose, stats }: StatsDialogProps) => {
    const theme = useTheme();

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
                                                {formatValue(stats.totalIdle)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Send Time:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.totalSend)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Worst Lag:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.worstLag)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Worst Advance:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.worstAdvance)}ms
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
                                                {formatValue(stats.missedHeaders)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Missed Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.missedFrames)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Skipped Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.skippedFrames)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Sent Frames:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.sentFrames)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Skipped Frames (High Backlog):</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.framesSkippedDueToManyOutstandingFrames)}
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
                                                {formatValue(stats.maxSendTime)}ms
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Controller Frame Skips (intentional):</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.cframesSkippedDueToDirective)}
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Controller Frame Skips (incomplete):</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.cframesSkippedDueToIncompletePrior)}
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
                                                {formatValue(stats.sequenceDecompress?.fileReadTime)}ms read; {formatValue(stats.sequenceDecompress?.decompressTime)}ms decompress
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Audio Read:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.audioDecode?.fileReadTime)}ms read; {formatValue(stats.audioDecode?.decodeTime)}ms decode
                                            </Typography>
                                        </Box>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <Typography variant="body2">Effect Processing:</Typography>
                                            <Typography variant="body2" fontWeight="bold">
                                                {formatValue(stats.effectsProcessing?.backgroundBlendTime)}ms background blending
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
                <Button onClick={onClose} variant="contained" color="primary">
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
};
