import { type EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { isElectron } from '@ezplayer/shared-ui-components';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    Link,
    TextField,
    Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PauseCircleIcon from '@mui/icons-material/PauseCircle';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { createSelector } from '@reduxjs/toolkit';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { Box } from '../box/Box';
import { API_ENDPOINTS } from '../../store/api/ApiEndpoints';
import { postSetCloudUrl, postSetPlayerIdToken } from '../../store/slices/AuthStore';
import { issueCloudCommand } from '../../store/slices/CloudStatusStore';
import { CloudPollingIntervalEditor, CloudPollingScheduleEditor } from './CloudPollingEditor';
import { MaskedPlayerId } from './MaskedPlayerId';
import type { AppDispatch, RootState } from '../../store/Store';

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

const selectCloudConfig = (state: RootState) => state.cloudConfig;
const selectCloudStatus = (state: RootState) => state.cloudStatus;
const selectPlayerIdToken = createSelector([selectCloudConfig], (cfg) => cfg.playerIdToken);
const selectCloudServiceUrl = createSelector([selectCloudConfig], (cfg) => cfg.cloudServiceUrl);
const selectIsRegistered = createSelector([selectCloudStatus], (s) => s.playerIdIsRegistered);
const selectCloudActive = createSelector([selectCloudConfig], (cfg) => cfg.cloudEnabled !== false);

interface PlayerCloudWelcomePanelProps {
    /** When true, also surface the per-folder polling editor inside the Advanced
     *  accordion. Used by the cloud-screen Register dialog (power-user context).
     *  The first-run Welcome bootstrap leaves it off — polling tuning would be
     *  noise during "scan and go". */
    showPollingEditor?: boolean;
}

/**
 * The canonical player-registration UX. Leads with the QR / URL ("scan and go")
 * and tucks manual ID entry + cloud URL editing inside an Advanced accordion.
 * Auto-generates a Player ID on mount when none is set.
 *
 * Used both by the first-run Welcome bootstrap (no polling editor) and by the
 * cloud-screen Register dialog (`showPollingEditor`). `PlayerCloudRegistrationPanel`
 * is a thin alias around this component with `showPollingEditor` enabled.
 */
export const PlayerCloudWelcomePanel: React.FC<PlayerCloudWelcomePanelProps> = ({ showPollingEditor = false }) => {
    const dispatch = useDispatch<AppDispatch>();

    const playerIdToken = useSelector(selectPlayerIdToken);
    const cloudServiceUrl = useSelector(selectCloudServiceUrl);
    const playerIdIsRegistered = useSelector(selectIsRegistered);
    const cloudActive = useSelector(selectCloudActive);

    // Advanced-section popups; each seeds its draft from the current value on open.
    const [manualPlayerId, setManualPlayerId] = useState('');
    const [manualOpen, setManualOpen] = useState(false);
    const [cloudUrlInput, setCloudUrlInput] = useState('');
    const [cloudUrlOpen, setCloudUrlOpen] = useState(false);

    // Auto-generate a Player ID on mount when none is set, so the friendly QR-and-go
    // path lights up immediately. Skip while paused — generating a token whose
    // registration can't possibly poll-confirm just produces a stuck spinner.
    useEffect(() => {
        if (!playerIdToken && cloudActive) {
            void dispatch(postSetPlayerIdToken({ playerIdToken: uuidv4() }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fast-poll while waiting for registration. The default heartbeat is 30 s; that's
    // sluggish for a user staring at a QR code. Tick a manual poll every 2 s until the
    // cloud confirms registration, then stop. Skip while paused — the worker isn't
    // running, so polling is futile and would burn CPU spinning forever.
    useEffect(() => {
        if (playerIdIsRegistered || !cloudActive) return;
        const id = window.setInterval(() => {
            void dispatch(issueCloudCommand({ type: 'pollNow' }));
        }, 2000);
        return () => window.clearInterval(id);
    }, [playerIdIsRegistered, cloudActive, dispatch]);

    const handleResume = () => {
        void dispatch(issueCloudCommand({ type: 'setCloudEnabled', enabled: true }));
    };

    const registrationUrl = useMemo(() => {
        if (!playerIdToken) return '';
        const base = cloudServiceUrl || '';
        return `${base}${API_ENDPOINTS.REGISTER_PLAYER}${playerIdToken}`;
    }, [cloudServiceUrl, playerIdToken]);

    const handleGenerateNew = () => {
        void dispatch(postSetPlayerIdToken({ playerIdToken: uuidv4() }));
    };
    const openManual = () => {
        setManualPlayerId('');
        setManualOpen(true);
    };
    const handleApplyManual = () => {
        const id = manualPlayerId.trim();
        if (!id) return;
        void dispatch(postSetPlayerIdToken({ playerIdToken: id }));
        setManualOpen(false);
    };
    const openCloudUrl = () => {
        setCloudUrlInput(cloudServiceUrl || '');
        setCloudUrlOpen(true);
    };
    const handleCloudUrlSave = async () => {
        try {
            await dispatch(postSetCloudUrl({ cloudUrl: cloudUrlInput.trim() })).unwrap();
            setCloudUrlOpen(false);
        } catch (e) {
            console.error('Error updating cloud URL:', e);
        }
    };

    return (
        <Box>
            {/* Status row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                {!cloudActive ? (
                    <>
                        <PauseCircleIcon color="warning" />
                        <Typography variant="h6" color="text.primary">
                            Cloud Paused
                        </Typography>
                    </>
                ) : playerIdIsRegistered ? (
                    <>
                        <CheckCircleIcon color="success" />
                        <Typography variant="h6" color="success.main">
                            Player ID Registered
                        </Typography>
                    </>
                ) : (
                    <>
                        <CircularProgress size={22} />
                        <Typography variant="h6" color="text.primary">
                            Waiting for Registration
                        </Typography>
                    </>
                )}
            </Box>

            {/* Paused banner: replaces the QR/URL block — there's no point staring
                at a code while the worker isn't polling. Resume here and the QR
                shows up automatically (or the panel goes straight to "Registered"
                if the player's already known to the cloud). */}
            {!cloudActive && (
                <Box
                    sx={{
                        p: 2,
                        mb: 2,
                        border: '1px solid',
                        borderColor: 'warning.main',
                        borderRadius: 1,
                        bgcolor: 'warning.50',
                    }}
                >
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        Cloud activity is paused, so registration won't poll. Resume to register or pick up where you
                        left off — your token and URL are retained.
                    </Typography>
                    <Button
                        startIcon={<PlayArrowIcon />}
                        variant="contained"
                        size="small"
                        color="warning"
                        onClick={handleResume}
                    >
                        Resume Cloud
                    </Button>
                </Box>
            )}

            {/* Friendly path: QR + URL */}
            {cloudActive && playerIdToken && registrationUrl && !playerIdIsRegistered && (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', mb: 2 }}>
                    <Box
                        sx={{
                            width: 192,
                            height: 192,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1,
                            p: 1,
                            bgcolor: 'background.paper',
                            mb: 2,
                        }}
                    >
                        <QRCodeSVG value={registrationUrl} size={176} level="H" includeMargin={false} />
                    </Box>
                    <Typography variant="body2" sx={{ mb: 1, textAlign: 'center' }}>
                        Scan the QR code, or open this URL in a browser logged in to your EZRGB account:
                    </Typography>
                    <Typography variant="body2" sx={{ wordBreak: 'break-all', textAlign: 'center' }}>
                        {isElectron() ? (
                            <Link
                                component="button"
                                underline="hover"
                                onClick={() => window.electronAPI?.openExternal(registrationUrl)}
                                sx={{ textAlign: 'left' }}
                            >
                                {registrationUrl}
                            </Link>
                        ) : (
                            <Link href={registrationUrl} target="_blank" rel="noopener noreferrer" underline="hover">
                                {registrationUrl}
                            </Link>
                        )}
                    </Typography>
                </Box>
            )}

            {/* Polling schedule (cloud-screen Register dialog only). Surfaced as its
                own prominent section between QR/URL and the Advanced accordion — users
                tune the schedule far more often than the cadence in seconds. */}
            {showPollingEditor && (
                <>
                    <Divider sx={{ my: 2 }} />
                    <CloudPollingScheduleEditor />
                </>
            )}

            <Divider sx={{ my: 2 }} />

            {/* Advanced */}
            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2" color="text.secondary">
                        Advanced (Cloud URL, specific Player ID
                        {showPollingEditor ? ', polling interval' : ''})
                    </Typography>
                </AccordionSummary>
                <AccordionDetails>
                    {/* Cloud Service URL */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
                            Cloud Service URL:
                        </Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>
                            {cloudServiceUrl || '(not set)'}
                        </Typography>
                        <Button size="small" variant="outlined" onClick={openCloudUrl}>
                            Edit
                        </Button>
                    </Box>

                    {/* Current Player ID */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1, flexWrap: 'wrap' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140 }}>
                            Current Player ID:
                        </Typography>
                        <MaskedPlayerId value={playerIdToken} />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 1, mb: 1, flexWrap: 'wrap', pl: { sm: '148px' } }}>
                        <Button size="small" variant="outlined" onClick={handleGenerateNew}>
                            Generate New
                        </Button>
                        <Button size="small" variant="outlined" onClick={openManual}>
                            Enter Manually
                        </Button>
                    </Box>

                    {showPollingEditor && (
                        <>
                            <Divider sx={{ my: 2 }} />
                            <CloudPollingIntervalEditor />
                        </>
                    )}
                </AccordionDetails>
            </Accordion>

            {/* Edit Cloud Service URL */}
            <Dialog open={cloudUrlOpen} onClose={() => setCloudUrlOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Cloud Service URL</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Only change this if you have been given a different cloud service address. Registration and sync
                        restart against the new URL when you save.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        size="small"
                        label="Cloud Service URL"
                        value={cloudUrlInput}
                        onChange={(e) => setCloudUrlInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') void handleCloudUrlSave();
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCloudUrlOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={() => void handleCloudUrlSave()}>
                        Save
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Enter a specific Player ID */}
            <Dialog open={manualOpen} onClose={() => setManualOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>Enter Player ID</DialogTitle>
                <DialogContent>
                    <DialogContentText sx={{ mb: 2 }}>
                        Paste a Player ID from another player or from your EZRGB account to make this player take over
                        that registration. The current ID is replaced.
                    </DialogContentText>
                    <TextField
                        autoFocus
                        fullWidth
                        size="small"
                        label="Player ID"
                        placeholder="Paste a Player ID"
                        value={manualPlayerId}
                        onChange={(e) => setManualPlayerId(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleApplyManual();
                        }}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setManualOpen(false)}>Cancel</Button>
                    <Button variant="contained" onClick={handleApplyManual} disabled={!manualPlayerId.trim()}>
                        Apply
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
