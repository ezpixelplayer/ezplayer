import { Card, CardContent, Typography, Chip, IconButton, Slider } from '@mui/material';
import { Box } from '../box/Box';
import { PlayerPStatusContent } from '@ezplayer/ezplayer-core';
import { VolumeOff, VolumeUp } from '@mui/icons-material';
import { useDispatch } from 'react-redux';
import { callImmediateCommand } from '../../store/slices/PlayerStatusStore';
import { AppDispatch } from '../../store/Store';

interface NowPlayingCardProps {
    player: PlayerPStatusContent;
    className?: string;
    compact?: boolean;
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

export const NowPlayingCard = ({ player, className, compact = false }: NowPlayingCardProps) => {
    if (player.ptype !== 'EZP') {
        return null;
    }

    const isPlaying = player.status === 'Playing';
    const hasNowPlaying = !!player.now_playing;
    const hasUpcoming = player.upcoming && player.upcoming.length > 0;
    const volume = player.volume?.level ?? 100;
    const muted = player.volume?.muted ?? false;
    const dispatch = useDispatch<AppDispatch>();

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
                        label={isPlaying ? '▶ Playing' : '⏸ Stopped'}
                        size="small"
                        color={isPlaying ? 'success' : 'default'}
                        sx={{ fontWeight: 'bold' }}
                    />
                    <Typography variant="caption" color="text.secondary">
                        Last checkin: {formatTime(player.reported_time)}
                    </Typography>
                </Box>

                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 2 }}>
                    <IconButton
                        size="small"
                        onClick={async () => {
                            if (!muted) {
                                await dispatch(callImmediateCommand({ command: 'setvolume', mute: true })).unwrap();
                            } else {
                                await dispatch(callImmediateCommand({ command: 'setvolume', mute: false })).unwrap();
                            }
                        }}
                    >
                        {muted || volume == 0 ? <VolumeOff fontSize="small" /> : <VolumeUp fontSize="small" />}
                    </IconButton>

                    <Slider
                        size="small"
                        min={0}
                        max={100}
                        disabled={true}
                        value={muted ? 0 : volume}
                        sx={{ width: compact ? 80 : 120 }}
                    />
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
            </CardContent>
        </Card>
    );
};
