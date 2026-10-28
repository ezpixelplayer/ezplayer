/**
 * Show Status card for content distribution: whether the devices that hold
 * their own copy of the show actually have this show, what a run is doing right
 * now, and three ways on — the Content Sync settings, a send, and the
 * per-sequence detail dialog.
 */

import SettingsRounded from '@mui/icons-material/SettingsRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import FactCheckRounded from '@mui/icons-material/FactCheckRounded';
import ListAltRounded from '@mui/icons-material/ListAltRounded';
import { Button, Card, CardContent, Chip, LinearProgress, Typography, useTheme } from '@mui/material';
import { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';

import { PLAYBACKSETTINGS } from '../../constants/routes';
import { issueControllerCommand } from '../../store/slices/ControllerOpsStore';
import type { AppDispatch, RootState } from '../../store/Store';
import { Box } from '../box/Box';
import { CONTENT_SYNC_SETTINGS_SECTION_KEY } from '../playback-settings/sections/ContentSyncSettings';
import { ContentDistributionDialog } from '../content-dist/ContentDistributionDialog';
import { autoHoldText, contentDistSummary, contentTargets, formatBytes } from '../content-dist/contentDistHelpers';

const SEVERITY_CHIP: Record<string, { label: string; color: 'success' | 'warning' | 'info' | 'default' }> = {
    ok: { label: 'Up to date', color: 'success' },
    attention: { label: 'Needs content', color: 'warning' },
    busy: { label: 'Running', color: 'info' },
    idle: { label: 'Not checked', color: 'default' },
};

export function ContentDistributionCard() {
    const theme = useTheme();
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const devices = useSelector((s: RootState) => s.controllerOps.devices);
    const contentDist = useSelector((s: RootState) => s.controllerOps.contentDist);
    const distribution = useSelector((s: RootState) => s.playbackSettings.settings.contentDistribution);
    const [detailsOpen, setDetailsOpen] = useState(false);

    const targets = useMemo(() => contentTargets(devices), [devices]);
    const summary = useMemo(() => contentDistSummary(contentDist, targets), [contentDist, targets]);
    const chip = SEVERITY_CHIP[summary.severity] ?? SEVERITY_CHIP.idle;
    const run = contentDist?.run;
    const report = contentDist?.lastReport;
    const hold = autoHoldText(contentDist);

    const distribute = (checkOnly: boolean) =>
        void dispatch(issueControllerCommand({ cmd: 'distribute', ...(checkOnly ? { checkOnly: true } : {}) }));

    const modeLine = (() => {
        switch (distribution?.mode) {
            case 'always':
                return 'Sent automatically whenever something is missing.';
            case 'scheduled':
                return `Sent automatically inside ${distribution.schedule?.length ?? 0} scheduled window${
                    (distribution.schedule?.length ?? 0) === 1 ? '' : 's'
                }.`;
            default:
                return 'Sent only when asked. Turn on automatic distribution in Content Sync settings.';
        }
    })();

    return (
        <Card>
            <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                    <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main}>
                        Content Distribution &amp; Sync
                    </Typography>
                    <Chip size="small" label={chip.label} color={chip.color} variant="filled" />
                </Box>

                <Typography variant="body1">{summary.text}</Typography>
                {run ? (
                    <LinearProgress
                        variant="determinate"
                        value={Math.round(run.fraction * 100)}
                        sx={{ mt: 1, mb: 0.5 }}
                    />
                ) : null}

                {/* Where the show actually is, device by device, without opening the dialog. */}
                {!run && targets.length > 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        {targets
                            .slice(0, 4)
                            .map((d) => {
                                const st = d.contentStatus;
                                const name = d.hostname ?? d.ip;
                                if (!st) return `${name}: not checked`;
                                if (st.error) return `${name}: ${st.error}`;
                                if (st.missing > 0 || st.failed > 0) {
                                    return `${name}: ${st.missing + st.failed} to send (${formatBytes(st.missingBytes)})`;
                                }
                                return `${name}: current`;
                            })
                            .join(' · ')}
                        {targets.length > 4 && ` · +${targets.length - 4} more`}
                    </Typography>
                ) : null}

                {report && !run ? (
                    <Typography variant="body2" color="text.secondary">
                        Last {report.checkOnly ? 'checked' : 'sent'} {new Date(report.finishedAt).toLocaleString()}
                        {report.totals.bytes > 0 && ` · ${formatBytes(report.totals.bytes)}`}
                    </Typography>
                ) : null}

                <Typography variant="body2" color="text.secondary">
                    {hold ?? modeLine}
                </Typography>

                <Box sx={{ display: 'flex', gap: 1, mt: 1.5, flexWrap: 'wrap' }}>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<SettingsRounded />}
                        onClick={() => navigate(`${PLAYBACKSETTINGS}?section=${CONTENT_SYNC_SETTINGS_SECTION_KEY}`)}
                        sx={{ textTransform: 'none' }}
                    >
                        Settings
                    </Button>
                    <Button
                        size="small"
                        variant="contained"
                        startIcon={<SendRounded />}
                        onClick={() => distribute(false)}
                        disabled={!!run || targets.length === 0}
                        sx={{ textTransform: 'none' }}
                    >
                        Distribute now
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<FactCheckRounded />}
                        onClick={() => distribute(true)}
                        disabled={!!run || targets.length === 0}
                        sx={{ textTransform: 'none' }}
                    >
                        Check
                    </Button>
                    <Button
                        size="small"
                        variant="outlined"
                        startIcon={<ListAltRounded />}
                        onClick={() => setDetailsOpen(true)}
                        sx={{ textTransform: 'none' }}
                    >
                        Details
                    </Button>
                </Box>
            </CardContent>
            <ContentDistributionDialog open={detailsOpen} onClose={() => setDetailsOpen(false)} />
        </Card>
    );
}
