/**
 * Show Status card for virtual matrix outputs: what each one is doing, how
 * many frames a second it shows of those the player makes, and whether
 * anything is reading a link. Renders its own grid item, and nothing at all
 * when there is nothing to say.
 */

import SettingsRounded from '@mui/icons-material/SettingsRounded';
import { Button, Card, CardContent, Chip, Grid, Typography, useTheme } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import type { VirtualMatrixStatus } from '@ezplayer/ezplayer-core';

import { PLAYBACKSETTINGS } from '../../constants/routes';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import type { RootState } from '../../store/Store';
import { Box } from '../box/Box';
import { VIRTUAL_MATRIX_SETTINGS_SECTION_KEY } from '../playback-settings/sections/VirtualMatrixSettings';
import { matrixRows, type MatrixRowState } from './virtualMatrixHelpers';

const STATE_CHIP: Record<MatrixRowState, { label: string; color: 'success' | 'warning' | 'info' | 'default' }> = {
    showing: { label: 'Showing', color: 'success' },
    slow: { label: 'Slow', color: 'warning' },
    idle: { label: 'Idle', color: 'info' },
    unread: { label: 'Not read', color: 'warning' },
    off: { label: 'Off', color: 'default' },
};

const POLL_MS = 2000;

export function VirtualMatrixCard() {
    const theme = useTheme();
    const navigate = useNavigate();
    const outputs = useSelector((s: RootState) => s.playbackSettings.settings.virtualMatrixOutputs);
    const { url } = useFrameServerUrl();
    const [status, setStatus] = useState<VirtualMatrixStatus | undefined>(undefined);

    useEffect(() => {
        if (!url) return;
        let cancelled = false;
        const poll = async () => {
            try {
                const res = await fetch(`${url}/api/ezp/matrix/status`);
                if (!cancelled) setStatus(res.ok ? ((await res.json()) as VirtualMatrixStatus) : undefined);
            } catch {
                if (!cancelled) setStatus(undefined);
            }
        };
        void poll();
        const timer = setInterval(poll, POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [url]);

    const rows = useMemo(() => matrixRows(outputs ?? [], status?.readers ?? []), [outputs, status]);
    // Without the player's answer there is nothing true to show.
    if (!status || rows.length === 0) return null;

    return (
        <Grid item xs={12}>
            <Card>
                <CardContent>
                    <Typography variant="h3" fontWeight="bold" color={theme.palette.secondary.main} sx={{ mb: 1 }}>
                        Virtual Matrix
                    </Typography>
                    {rows.map((row) => {
                        const chip = STATE_CHIP[row.state];
                        return (
                            <Box
                                key={row.key}
                                sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 0.5 }}
                            >
                                <Chip label={chip.label} color={chip.color} size="small" sx={{ minWidth: 76 }} />
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {row.model}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {row.where}
                                </Typography>
                                <Typography variant="body2" color="text.secondary" sx={{ ml: 'auto' }}>
                                    {row.detail}
                                </Typography>
                            </Box>
                        );
                    })}
                    <Box sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
                        <Button
                            size="small"
                            variant="outlined"
                            startIcon={<SettingsRounded />}
                            onClick={() =>
                                navigate(`${PLAYBACKSETTINGS}?section=${VIRTUAL_MATRIX_SETTINGS_SECTION_KEY}`)
                            }
                            sx={{ textTransform: 'none' }}
                        >
                            Settings
                        </Button>
                    </Box>
                </CardContent>
            </Card>
        </Grid>
    );
}
