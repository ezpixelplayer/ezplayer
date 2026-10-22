/**
 * Show Status card summarising viewer control: which backends the player runs
 * (built-in viewer page, Remote Falcon, or both), whether a request window is
 * open right now, what the cloud is doing with the built-in line (mode, people
 * on the page, listeners, queue or votes), today's picks by source, and two
 * actions — the player's Viewer Control settings, and the full activity view
 * in a dialog.
 */

import type { ViewerControlBackend } from '@ezplayer/ezplayer-core';
import { getActiveViewerControlSchedule, viewerControlBackends, viewerControlSchedule } from '@ezplayer/ezplayer-core';
import CloseIcon from '@mui/icons-material/Close';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import {
    Button,
    Card,
    CardContent,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Typography,
    useTheme,
} from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { PLAYBACKSETTINGS } from '../../constants/routes';
import type { RootState } from '../../store/Store';
import { Box } from '../box/Box';
import { ViewerStatsBody } from '../viewer-stats/ViewerStatsScreen';

/** Section key the apps give the Viewer Control tile in their settings drawer. */
export const VIEWER_SETTINGS_SECTION_KEY = 'viewer';

const BACKEND_LABEL: Record<string, string> = {
    'remote-falcon': 'Remote Falcon',
    ezplayer: 'EZPlayer viewer page',
};

/** Lower-case names for the per-backend window lines when the schedules are separate. */
const WINDOW_NAME: Record<ViewerControlBackend, string> = {
    'remote-falcon': 'Remote Falcon',
    ezplayer: 'viewer page',
};

const MODE_LABEL: Record<string, string> = { off: 'off', request: 'taking requests', vote: 'taking votes' };

export function ViewerControlCard() {
    const theme = useTheme();
    const navigate = useNavigate();
    const viewerControl = useSelector((s: RootState) => s.playbackSettings.settings.viewerControl);
    const summary = useSelector((s: RootState) => s.viewerStats.summary);
    const [activityOpen, setActivityOpen] = useState(false);

    // Re-evaluate the schedule window on a timer; nothing else changes it.
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        const id = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(id);
    }, []);

    const backends = useMemo(() => viewerControlBackends(viewerControl), [viewerControl]);
    const anyOn = backends.length > 0;
    const builtIn = backends.includes('ezplayer');
    // One window per backend; they differ only when Remote Falcon has its own schedule.
    const windows = useMemo(
        () =>
            new Map(
                backends.map((b) => [b, viewerControl ? getActiveViewerControlSchedule(viewerControl, b, now) : null]),
            ),
        [viewerControl, backends, now],
    );
    const splitSchedules = !!viewerControl?.separateRemoteFalconSchedule && backends.length > 1;
    const live = summary?.live;
    const liveFresh = !!live && Date.now() - live.at < 2 * 60_000;

    // One line for the shared schedule, or one per backend when they differ.
    const windowLines = (() => {
        if (!anyOn) return [];
        const lineFor = (b: ViewerControlBackend, name: string) => {
            const w = windows.get(b);
            const Name = name.charAt(0).toUpperCase() + name.slice(1);
            if (w) return `${Name} window open now: playlist "${w.playlist}" until ${w.endTime}`;
            if (!viewerControlSchedule(viewerControl, b).length) return `No ${name} windows scheduled`;
            return `${Name} window closed now`;
        };
        if (!splitSchedules) return [{ key: 'shared', text: lineFor(backends[0], 'request') }];
        return backends.map((b) => ({ key: b, text: lineFor(b, WINDOW_NAME[b]) }));
    })();

    const cloudLine = (() => {
        if (!builtIn) return null;
        if (!live) return summary ? 'Viewer page: no activity yet' : 'Viewer page: waiting for the cloud…';
        const parts: string[] = [];
        parts.push(live.online ? `Viewer page ${MODE_LABEL[live.mode] ?? live.mode}` : 'Viewer page: player offline');
        parts.push(`${live.viewers} on the page`);
        parts.push(`${live.listeners} listening`);
        if (live.mode === 'request') parts.push(`${live.queue.length} in queue`);
        if (live.mode === 'vote') parts.push(`${live.votes.reduce((n, v) => n + v.votes, 0)} votes`);
        return parts.join(' · ') + (liveFresh ? '' : ' (stale)');
    })();

    const todayLine = (() => {
        const t = summary?.today;
        if (!t) return null;
        const picks = t.picksBySource;
        const total = picks.viewer + picks['remote-falcon'] + picks.jukebox;
        if (!t.requests && !t.votes && !total) return null;
        const parts: string[] = [];
        if (builtIn) parts.push(`${t.requests} requests, ${t.votes} votes on the page`);
        const by: string[] = [];
        if (picks.viewer) by.push(`${picks.viewer} from the page`);
        if (picks['remote-falcon']) by.push(`${picks['remote-falcon']} Remote Falcon`);
        if (picks.jukebox) by.push(`${picks.jukebox} jukebox`);
        if (by.length) parts.push(`songs picked: ${by.join(', ')}`);
        return `Today: ${parts.join(' · ')}`;
    })();

    return (
        <Card>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                        Viewer Control
                    </Typography>
                    {anyOn ? (
                        backends.map((b) => (
                            <Chip
                                key={b}
                                size="small"
                                label={BACKEND_LABEL[b] ?? b}
                                color={windows.get(b) ? 'success' : 'warning'}
                                variant="filled"
                            />
                        ))
                    ) : (
                        <Chip size="small" label="Disabled" variant="outlined" />
                    )}
                </Box>
                {windowLines.map((line) => (
                    <Typography key={line.key} variant="body1">
                        {line.text}
                    </Typography>
                ))}
                {cloudLine ? <Typography variant="body1">{cloudLine}</Typography> : null}
                {backends.length === 2 ? (
                    <Typography variant="body2" color="text.secondary">
                        Viewer-page requests are played before Remote Falcon suggestions.
                    </Typography>
                ) : null}
                {todayLine ? <Typography variant="body1">{todayLine}</Typography> : null}
                {!anyOn ? (
                    <Typography variant="body2" color="text.secondary">
                        Viewers cannot request or vote. Turn it on in Settings.
                    </Typography>
                ) : null}
                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SettingsRounded />}
                        onClick={() => navigate(`${PLAYBACKSETTINGS}?section=${VIEWER_SETTINGS_SECTION_KEY}`)}
                        sx={{ textTransform: 'none' }}
                    >
                        Settings
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<GroupsRounded />}
                        onClick={() => setActivityOpen(true)}
                        disabled={!summary}
                        sx={{ textTransform: 'none' }}
                    >
                        Viewer activity
                    </Button>
                </Box>
            </CardContent>

            <Dialog
                open={activityOpen}
                onClose={() => setActivityOpen(false)}
                maxWidth="lg"
                fullWidth
                PaperProps={{ sx: { maxHeight: '90vh' } }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    Viewer Activity
                    <IconButton aria-label="Close" onClick={() => setActivityOpen(false)} size="small">
                        <CloseIcon />
                    </IconButton>
                </DialogTitle>
                <DialogContent dividers sx={{ p: 0 }}>
                    <ViewerStatsBody />
                </DialogContent>
            </Dialog>
        </Card>
    );
}
