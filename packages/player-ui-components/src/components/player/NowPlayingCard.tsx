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
import { PlayerPStatusContent, resolveAudioOutputDevice } from '@ezplayer/ezplayer-core';
import { VolumeOff, VolumeUp, Refresh, Tune, Close, WarningAmber } from '@mui/icons-material';
import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { callImmediateCommand } from '../../store/slices/RuntimeStore';
import { AppDispatch, RootState } from '../../store/Store';
import { QueueAndControlStack } from './QueueAndControlStack';
import { AudioSettings } from '../playback-settings/sections/AudioSettings';
import { PlayerSystemTime } from './PlayerSystemTime';

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
    // Hooks must precede the ptype early-return to keep call order stable.
    const dispatch = useDispatch<AppDispatch>();
    const [audioSettingsOpen, setAudioSettingsOpen] = useState(false);
    // Reloading clears controller state, so it waits for controller operations
    // that are running or queued.
    const controllerOpRunning = useSelector((s: RootState) =>
        Object.values(s.controllerOps?.operations ?? {}).some((o) => o.status === 'running' || o.status === 'queued'),
    );
    // Devices the player has enumerated; null until it reports them (marks outputs not connected).
    const knownOutputs = useSelector((s: RootState) => s.audioDevices.outputs);

    if (player.ptype !== 'EZP') {
        return null;
    }

    const isPlaying = player.status === 'Playing';
    const isPaused = player.status === 'Paused';
    const isActive = isPlaying || isPaused;
    const hasNowPlaying = !!player.now_playing;
    const hasBackgroundPlaying = !!player.background_now_playing;
    const hasUpcoming = player.upcoming && player.upcoming.length > 0;
    const backgroundItem = player.background_now_playing;
    const backgroundNotStarted =
        !!backgroundItem?.at && backgroundItem.at > (player.engine_time ?? player.reported_time);
    const volume = player.volume?.level ?? 100;
    const muted = player.volume?.muted ?? false;
    // One row per output. `default` mode: the single system-default level. `outputs`
    // mode: each named device at its own (scheduled) level; a device the player has
    // enumerated but cannot find right now is marked not connected.
    const volumeRows: Array<{ id: string; label: string; level: number; connected?: boolean }> =
        player.volume?.mode === 'outputs'
            ? (player.volume.outputs ?? []).map((o) => ({
                  id: o.id,
                  label: o.label,
                  level: Math.round(o.level),
                  connected: knownOutputs
                      ? !!resolveAudioOutputDevice(
                            { deviceId: o.deviceId ?? '', label: o.label, groupId: o.groupId },
                            knownOutputs,
                        )
                      : undefined,
              }))
            : [{ id: 'default', label: '', level: Math.round(volume) }];
    const silent = muted || volumeRows.every((r) => r.level === 0);
    const openAudioSettings = () => setAudioSettingsOpen(true);

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
                    <PlayerSystemTime />
                </Box>

                {/* Volume is automated toward the scheduled target(s), so it is shown read-only
                    here — change it via the settings dialog (click anywhere on the meter). Mute is
                    a live toggle (operator contexts only). With named outputs each device has its
                    own level and schedule, so there is one row per output. */}
                <Box
                    onClick={allowVolumeControl ? openAudioSettings : undefined}
                    role={allowVolumeControl ? 'button' : undefined}
                    aria-label={allowVolumeControl ? 'Open volume settings' : undefined}
                    sx={{
                        display: 'flex',
                        alignItems: volumeRows.length > 1 ? 'flex-start' : 'center',
                        gap: 1,
                        ml: 2,
                        ...(allowVolumeControl ? { cursor: 'pointer' } : {}),
                    }}
                >
                    {allowVolumeControl ? (
                        <IconButton
                            size="small"
                            aria-label={muted ? 'Unmute' : 'Mute'}
                            onClick={(e) => {
                                e.stopPropagation();
                                dispatch(callImmediateCommand({ command: 'setvolume', mute: !muted }));
                            }}
                        >
                            {silent ? <VolumeOff fontSize="small" /> : <VolumeUp fontSize="small" />}
                        </IconButton>
                    ) : silent ? (
                        <VolumeOff fontSize="small" color="disabled" />
                    ) : (
                        <VolumeUp fontSize="small" color="disabled" />
                    )}
                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
                        {volumeRows.length === 0 ? (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                <WarningAmber fontSize="small" color="warning" />
                                <Typography variant="caption" color="warning.main">
                                    No audio outputs selected
                                </Typography>
                            </Box>
                        ) : (
                            volumeRows.map((row) => (
                                <Box key={row.id} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <LinearProgress
                                        variant="determinate"
                                        value={muted ? 0 : row.level}
                                        sx={{
                                            width: compact ? 80 : 120,
                                            height: 6,
                                            borderRadius: 3,
                                            flexShrink: 0,
                                            opacity: row.connected === false ? 0.4 : 1,
                                        }}
                                    />
                                    <Typography
                                        variant="caption"
                                        color={row.connected === false ? 'text.disabled' : 'text.secondary'}
                                        noWrap
                                        title={row.label || undefined}
                                    >
                                        {muted ? 0 : row.level}%
                                        {row.label
                                            ? ` (${row.label}${row.connected === false ? ', not connected' : ''})`
                                            : ''}
                                    </Typography>
                                </Box>
                            ))
                        )}
                    </Box>
                    {allowVolumeControl && (
                        <Tooltip title="Volume settings">
                            <IconButton size="small" aria-label="Open volume settings" onClick={openAudioSettings}>
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

                {/* Background Sequence Section — same layout as Now Playing */}
                {hasBackgroundPlaying && (
                    <Box sx={{ mb: compact ? 1 : 1.5 }}>
                        <Typography
                            variant={compact ? 'body2' : 'body1'}
                            fontWeight="bold"
                            color="primary"
                            sx={{ mb: 0.5 }}
                        >
                            Background
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
                            {backgroundItem?.title}
                        </Typography>
                        {backgroundNotStarted && backgroundItem?.at ? (
                            <Typography variant="caption" color="text.secondary">
                                Starts: {formatTime(backgroundItem.at)}
                            </Typography>
                        ) : (
                            backgroundItem?.until && (
                                <Typography variant="caption" color="text.secondary">
                                    Until: {formatTime(backgroundItem.until)}
                                </Typography>
                            )
                        )}
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
                        <Tooltip
                            title={controllerOpRunning ? 'Wait for the running controller operation to finish' : ''}
                        >
                            <span>
                                <Button
                                    variant="outlined"
                                    startIcon={<Refresh />}
                                    disabled={controllerOpRunning}
                                    onClick={async () => {
                                        await dispatch(callImmediateCommand({ command: 'resetplayback' })).unwrap();
                                    }}
                                >
                                    Reload Schedule
                                </Button>
                            </span>
                        </Tooltip>
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
