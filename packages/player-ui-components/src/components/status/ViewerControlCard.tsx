/**
 * Show Status card summarising viewer control: what the player is set to,
 * whether a request window is open right now, what the cloud is doing with it
 * (mode, people on the page, listeners, queue or votes), and two actions —
 * the player's Viewer Control settings, and the full activity view in a dialog.
 *
 * Replaces the "Viewer Activity" sidebar entry and the one-liner that used to
 * sit in Content & Schedule.
 */

import { getActiveViewerControlSchedule } from '@ezplayer/ezplayer-core';
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

const TYPE_LABEL: Record<string, string> = {
    disabled: 'Disabled',
    'remote-falcon': 'Remote Falcon',
    ezplayer: 'EZPlayer (built-in)',
};

const MODE_LABEL: Record<string, string> = { off: 'off', request: 'requests', vote: 'voting' };

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

    const type = viewerControl?.enabled ? (viewerControl.type ?? 'disabled') : 'disabled';
    const window = useMemo(
        () => (viewerControl && type !== 'disabled' ? getActiveViewerControlSchedule(viewerControl, now) : null),
        [viewerControl, type, now],
    );
    const live = summary?.live;
    const liveFresh = !!live && Date.now() - live.at < 2 * 60_000;

    const windowLine = (() => {
        if (type === 'disabled') return null;
        if (!viewerControl?.schedule?.length) return 'No request windows scheduled';
        return window
            ? `Request window open now — playlist “${window.playlist}” until ${window.endTime}`
            : 'Request window closed now';
    })();

    const cloudLine = (() => {
        if (type !== 'ezplayer') return null;
        if (!live) return summary ? 'No cloud activity yet' : 'Waiting for the cloud…';
        const parts: string[] = [];
        parts.push(live.online ? `Cloud: ${MODE_LABEL[live.mode] ?? live.mode}` : 'Cloud: player offline');
        parts.push(`${live.viewers} on the page`);
        parts.push(`${live.listeners} listening`);
        if (live.mode === 'request') parts.push(`${live.queue.length} in queue`);
        if (live.mode === 'vote') parts.push(`${live.votes.reduce((n, v) => n + v.votes, 0)} votes`);
        return parts.join(' · ') + (liveFresh ? '' : ' (stale)');
    })();

    const todayLine =
        summary && (summary.today.requests || summary.today.votes || summary.today.picks)
            ? `Today: ${summary.today.requests} requests, ${summary.today.votes} votes, ${summary.today.picks} picked`
            : null;

    return (
        <Card>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                        Viewer Control
                    </Typography>
                    <Chip
                        size="small"
                        label={TYPE_LABEL[type] ?? type}
                        color={type === 'disabled' ? 'default' : window ? 'success' : 'warning'}
                        variant={type === 'disabled' ? 'outlined' : 'filled'}
                    />
                </Box>
                {windowLine ? <Typography variant="body1">{windowLine}</Typography> : null}
                {cloudLine ? <Typography variant="body1">{cloudLine}</Typography> : null}
                {todayLine ? <Typography variant="body1">{todayLine}</Typography> : null}
                {type === 'disabled' ? (
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
