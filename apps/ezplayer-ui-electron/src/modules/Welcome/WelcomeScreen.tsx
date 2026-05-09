import { Box, Button, Card, CardActionArea, LinearProgress, Paper, Typography } from '@mui/material';
import CloudIcon from '@mui/icons-material/Cloud';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
    PlayerCloudWelcomePanel,
    Routes as ROUTES,
    issueCloudCommand,
} from '@ezplayer/player-ui-components';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch, RootState } from '@ezplayer/player-ui-components';

export const WELCOME_ROUTE = '/welcome';

type WelcomeStage = 'choose' | 'cloud-bootstrap-register' | 'cloud-bootstrap-layout';

export const WelcomeScreen = () => {
    const navigate = useNavigate();
    const dispatch = useDispatch<AppDispatch>();
    const [isOpening, setIsOpening] = React.useState(false);
    const [stage, setStage] = React.useState<WelcomeStage>('choose');

    const playerIdIsRegistered = useSelector(
        (s: RootState) => s.cloudStatus.playerIdIsRegistered,
    );
    const layoutStatus = useSelector(
        (s: RootState) => s.runtime.combined.content?.layout,
    );

    // ---- xLights folder path (existing behavior) -----------------------------
    const openFolderPicker = React.useCallback(async () => {
        if (isOpening) return;
        const electronAPI = window.electronAPI;
        if (!electronAPI) return;
        setIsOpening(true);
        try {
            await electronAPI.requestChooseShowFolder();
            const validation = await electronAPI.validateShowDirectory();
            if (validation.valid) {
                navigate(ROUTES.PLAYER, { replace: true });
            }
        } finally {
            setIsOpening(false);
        }
    }, [isOpening, navigate]);

    // ---- Cloud-managed folder bootstrap -------------------------------------
    const openCloudBootstrap = React.useCallback(async () => {
        if (isOpening) return;
        const electronAPI = window.electronAPI;
        if (!electronAPI) return;
        setIsOpening(true);
        try {
            const sf = await electronAPI.requestChooseCloudShowFolder();
            if (!sf) {
                // User cancelled or picker rejected; remain on choose stage.
                return;
            }
            setStage('cloud-bootstrap-register');
        } finally {
            setIsOpening(false);
        }
    }, [isOpening]);

    // Once the cloud reports the player as registered, advance to layout-pull stage.
    React.useEffect(() => {
        if (stage !== 'cloud-bootstrap-register') return;
        if (!playerIdIsRegistered) return;
        setStage('cloud-bootstrap-layout');
    }, [stage, playerIdIsRegistered]);

    // Layout-pull stage: kick a fetch on entry, then react to cStatus.layout transitions.
    // 'done' → open PLAYER; 'noLayout' → brief message then open empty; 'error' → show
    // error with Retry / Continue Anyway controls.
    React.useEffect(() => {
        if (stage !== 'cloud-bootstrap-layout') return;
        void dispatch(issueCloudCommand({ type: 'fetchLayoutNow' }));
    }, [stage, dispatch]);

    React.useEffect(() => {
        if (stage !== 'cloud-bootstrap-layout') return;
        if (!layoutStatus) return;
        if (layoutStatus.status === 'done') {
            // Layout-installed → loadShowFolder ran in main → renderer will receive
            // fresh sequences/playlists/etc. Navigate.
            navigate(ROUTES.PLAYER, { replace: true });
        } else if (layoutStatus.status === 'noLayout') {
            const t = window.setTimeout(() => {
                navigate(ROUTES.PLAYER, { replace: true });
            }, 1500);
            return () => window.clearTimeout(t);
        }
    }, [stage, layoutStatus, navigate]);

    // ---- Render -------------------------------------------------------------
    return (
        <Box
            sx={{
                minHeight: '100vh',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: (theme) => theme.palette.background.default,
                p: 3,
            }}
        >
            <Paper elevation={4} sx={{ maxWidth: 800, width: '100%', p: 4 }}>
                <Typography variant="h4" gutterBottom>
                    Welcome to EZPlayer
                </Typography>

                {stage === 'choose' && (
                    <>
                        <Typography variant="body1" sx={{ mb: 3 }}>
                            EZPlayer can run an existing xLights show folder, or it can connect to
                            EZRGB Cloud and manage a fresh show folder for you.
                        </Typography>
                        <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                            <Card sx={{ flex: '1 1 320px', minWidth: 280 }}>
                                <CardActionArea
                                    onClick={() => void openFolderPicker()}
                                    disabled={isOpening}
                                    sx={{ p: 3, height: '100%' }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                                        <FolderOpenIcon fontSize="large" color="primary" />
                                        <Typography variant="h6">I have an xLights show folder</Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Pick an existing folder containing{' '}
                                        <strong>xlights_rgbeffects.xml</strong> and{' '}
                                        <strong>xlights_networks.xml</strong>. You can connect to the
                                        cloud later from the Cloud tab.
                                    </Typography>
                                </CardActionArea>
                            </Card>
                            <Card sx={{ flex: '1 1 320px', minWidth: 280 }}>
                                <CardActionArea
                                    onClick={() => void openCloudBootstrap()}
                                    disabled={isOpening}
                                    sx={{ p: 3, height: '100%' }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                                        <CloudIcon fontSize="large" color="primary" />
                                        <Typography variant="h6">Connect to EZRGB Cloud</Typography>
                                    </Box>
                                    <Typography variant="body2" color="text.secondary">
                                        Pick an empty folder. We&rsquo;ll register this player with
                                        the cloud and pull the show layout and sequences down.
                                    </Typography>
                                </CardActionArea>
                            </Card>
                        </Box>
                    </>
                )}

                {stage === 'cloud-bootstrap-register' && (
                    <>
                        <Typography variant="body1" sx={{ mb: 2 }}>
                            Register this player with EZRGB Cloud. Once registered, EZPlayer will pull
                            your layout and sequences automatically.
                        </Typography>
                        <PlayerCloudWelcomePanel />
                        <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                            <Button
                                variant="text"
                                size="small"
                                onClick={() => setStage('choose')}
                            >
                                Back
                            </Button>
                        </Box>
                    </>
                )}

                {stage === 'cloud-bootstrap-layout' && (
                    <Box sx={{ textAlign: 'center', py: 6 }}>
                        <Typography variant="h6" color="success.main" sx={{ mb: 1 }}>
                            Registered ✓
                        </Typography>
                        {(!layoutStatus || layoutStatus.status === 'idle' ||
                            layoutStatus.status === 'fetching' ||
                            layoutStatus.status === 'unpacking') && (
                            <>
                                <Typography variant="body1" sx={{ mb: 2 }}>
                                    {layoutStatus?.status === 'unpacking'
                                        ? 'Unpacking layout…'
                                        : 'Pulling layout…'}
                                </Typography>
                                {layoutStatus?.totalBytes ? (
                                    <Box sx={{ maxWidth: 360, mx: 'auto' }}>
                                        <LinearProgress
                                            variant="determinate"
                                            value={Math.min(
                                                100,
                                                ((layoutStatus.bytes ?? 0) /
                                                    layoutStatus.totalBytes) *
                                                    100,
                                            )}
                                        />
                                    </Box>
                                ) : (
                                    <Box sx={{ maxWidth: 360, mx: 'auto' }}>
                                        <LinearProgress />
                                    </Box>
                                )}
                            </>
                        )}
                        {layoutStatus?.status === 'noLayout' && (
                            <Typography variant="body1">
                                No layout available on the cloud yet — opening empty folder.
                            </Typography>
                        )}
                        {layoutStatus?.status === 'error' && (
                            <>
                                <Typography variant="body1" color="error" sx={{ mb: 2 }}>
                                    Layout fetch failed: {layoutStatus.error}
                                </Typography>
                                <Box sx={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                                    <Button
                                        variant="contained"
                                        onClick={() => void dispatch(issueCloudCommand({ type: 'fetchLayoutNow' }))}
                                    >
                                        Retry
                                    </Button>
                                    <Button
                                        variant="outlined"
                                        onClick={() => navigate(ROUTES.PLAYER, { replace: true })}
                                    >
                                        Continue Anyway
                                    </Button>
                                </Box>
                            </>
                        )}
                    </Box>
                )}
            </Paper>
        </Box>
    );
};
