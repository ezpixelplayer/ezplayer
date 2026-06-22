import {
    Card,
    CardContent,
    Typography,
    Chip,
    IconButton,
    Button,
    LinearProgress,
    Tooltip,
    Dialog,
    DialogTitle,
    DialogContent,
} from '@mui/material';
import { Box } from '../box/Box';
import { PlayerPStatusContent } from '@ezplayer/ezplayer-core';
import { VolumeOff, VolumeUp, Refresh, Tune, Close } from '@mui/icons-material';
import { useState } from 'react';
import { useDispatch } from 'react-redux';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import { AppDispatch } from '../../store/Store';
import { QueueAndControlStack } from './QueueAndControlStack';
import { AudioSettings } from '../playback-settings/sections/AudioSettings';

interface NowPlayingCardProps {
    player: PlayerPStatusContent;
    className?: string;
    compact?: boolean;
    /** Allow changing the player's live master volume (mute + level) and show a gear
     *  that pops the default/scheduled volume settings. When false, the volume is a
     *  read-only meter. */
    allowVolumeControl?: boolean;
    /** When false (kiosk), the playback controls hide End/Abort. Defaults to true. */
    allowStopControls?: boolean;
}

const formatTime = (timestamp?: number | string) => {
    if (!timestamp) return '—';
    const ts = typeof timestamp === 'string' ? Date.parse(timestamp) : timestamp;
    const date = new Date(ts);
    return date.toLocaleString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
    });
};

export const NowPlayingCard = ({
    player,
    className,
    compact = false,
    allowVolumeControl = false,
    allowStopControls = true,
}: NowPlayingCardProps) => {
    if (player.ptype !== 'EZP') {
        return null;
    }

    const isPlaying = player.status === 'Playing';
    const isPaused = player.status === 'Paused';
    const isActive = isPlaying || isPaused;
    const hasNowPlaying = !!player.now_playing;
    const hasUpcoming = player.upcoming && player.upcoming.length > 0;
    const volume = player.volume?.level ?? 100;
    const muted = player.volume?.muted ?? false;
    const dispatch = useDispatch<AppDispatch>();

    const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);

    return (
        <Card
            className={className}
            sx={{
                height: '100%',
                width: '100%',
            }}
        >
            <CardContent>
                {/* Status Indicator */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: compact ? 1 : 1.5 }}>
                    <Chip
                        label={isPlaying ? 'Playing' : isPaused ? 'Paused' : 'Stopped'}
                        size="small"
                        color={isPlaying ? 'success' : isPaused ? 'warning' : 'default'}
                        sx={{ fontWeight: 'bold' }}
                    />
                    <Typography variant="caption" color="text.secondary">
                        Last checkin: {formatTime(player.reported_time)}
                    </Typography>
                </Box>

                {/* The level is automated toward the default/scheduled target, so it's shown
                    read-only here — change it via the settings dialog. Mute is a live toggle
                    (operator contexts only); the gear opens the volume settings. */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2 }}>
                    {allowVolumeControl ? (
                        <IconButton
                            size="small"
                            aria-label={muted ? 'Unmute' : 'Mute'}
                            onClick={() => dispatch(callImmediateCommand({ command: 'setvolume', mute: !muted }))}
                        >
                            {muted || volume === 0 ? <VolumeOff fontSize="small" /> : <VolumeUp fontSize="small" />}
                        </IconButton>
                    ) : muted || volume === 0 ? (
                        <VolumeOff fontSize="small" color="disabled" />
                    ) : (
                        <VolumeUp fontSize="small" color="disabled" />
                    )}
                    <LinearProgress
                        variant="determinate"
                        value={muted ? 0 : volume}
                        sx={{ width: compact ? 80 : 120, height: 6, borderRadius: 3 }}
                    />
                    <Typography variant="caption" color="text.secondary">
                        {muted ? 0 : volume}%
                    </Typography>
                    {allowVolumeControl && (
                        <Tooltip title="Volume settings">
                            <IconButton
                                size="small"
                                aria-label="Open volume settings"
                                onClick={() => setAudioSettingsOpen(true)}
                            >
                                <Tune fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>

                {/* Now Playing Section */}
                {hasNowPlaying ? (
                    <Box sx={{ mb: compact ? 1 : 1.5 }}>
                        <Typography
                            variant={compact ? 'body2' : 'body1'}
                            fontWeight="bold"
                            color="primary"
                            sx={{ mb: 0.5 }}
                        >
                            Now Playing
                        </Typography>
                        <Typography
                            variant={compact ? 'body2' : 'body1'}
                            sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                            }}
                        >
                            {player.now_playing?.title}
                        </Typography>
                        {player.now_playing?.until && (
                            <Typography variant="caption" color="text.secondary">
                                Until: {formatTime(player.now_playing?.until)}
                            </Typography>
                        )}
                    </Box>
                ) : (
                    <Box sx={{ mb: compact ? 1 : 1.5 }}>
                        <Typography variant="body2" color="text.secondary" fontStyle="italic">
                            No track currently playing
                        </Typography>
                    </Box>
                )}

                {/* Next Track Section */}
                {hasUpcoming && (
                    <Box>
                        <Typography
                            variant={compact ? 'body2' : 'body1'}
                            fontWeight="bold"
                            color="secondary"
                            sx={{ mb: 0.5 }}
                        >
                            Next Show
                        </Typography>
                        <Typography
                            variant={compact ? 'body2' : 'body1'}
                            sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: '100%',
                            }}
                        >
                            {player?.upcoming?.[0].title}
                        </Typography>
                        {player?.upcoming?.[0].at && (
                            <Typography variant="caption" color="text.secondary">
                                Starts: {formatTime(player?.upcoming?.[0].at)}
                            </Typography>
                        )}
                    </Box>
                )}

                {/* Playback controls — only when playing or paused */}
                {isActive && <QueueAndControlStack allowStopControls={allowStopControls} />}

                {/* Reload schedule button — only when stopped */}
                {!isActive && (
                    <Box sx={{ mt: 2, display: 'flex', justifyContent: 'center' }}>
                        <Button
                            variant="outlined"
                            startIcon={<Refresh />}
                            onClick={async () => {
                                await dispatch(callImmediateCommand({ command: 'resetplayback' })).unwrap();
                            }}
                        >
                            Reload Schedule
                        </Button>
                    </Box>
                )}

                {/* Default/scheduled volume settings, popped over the page (operator contexts). */}
                <Dialog
                    open={audioSettingsOpen}
                    onClose={() => setAudioSettingsOpen(false)}
                    maxWidth="md"
                    fullWidth
                    PaperProps={{ sx: { maxHeight: '90vh' } }}
                >
                    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Typography variant="h5">Audio</Typography>
                        <Tooltip title="Close">
                            <IconButton onClick={() => setAudioSettingsOpen(false)} size="small" aria-label="close">
                                <Close />
                            </IconButton>
                        </Tooltip>
                    </DialogTitle>
                    <DialogContent dividers>
                        <AudioSettings />
                    </DialogContent>
                </Dialog>
            </CardContent>
        </Card>
    );
};
