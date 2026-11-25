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
    FormControlLabel,
    Link,
    Radio,
    RadioGroup,
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

/** The two EZRGB clouds; anything else is a custom address typed in full. */
const CLOUD_CHOICES = [
    { key: 'production', label: 'Production', host: 'api.ezplayer.dev', url: 'https://api.ezplayer.dev/' },
    { key: 'development', label: 'Development', host: 'dev.ezplayer.dev', url: 'https://dev.ezplayer.dev/' },
] as const;
type CloudChoice = (typeof CLOUD_CHOICES)[number]['key'] | 'custom';

/** Which choice a stored URL is: the hosts above (with or without a trailing slash) or custom. */
function cloudChoiceOf(url: string): CloudChoice {
    const bare = url.trim().toLowerCase().replace(/\/+$/, '');
    return CLOUD_CHOICES.find((c) => bare === `https://${c.host}`)?.key ?? 'custom';
}

interface PlayerCloudWelcomePanelProps {
    /** When true, also surface the per-folder polling editor inside the Advanced
     *  accordion. Used by the cloud-screen Register dialog (power-user context).
     *  The first-run Welcome bootstrap leaves it off — polling tuning would be
     *  noise during "scan and go". */
    showPollingEditor?: boolean;
}

/**
 * The canonical player-registration UX. Leads with the QR / URL ("scan and go")
 * and tucks manual ID entry + the cloud picker (production, development, other) inside an Advanced accordion.
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
    // The cloud picker: the radio follows the stored URL; "Other" shows a field seeded from it.
    const [customUrlInput, setCustomUrlInput] = useState('');
    const [customPicked, setCustomPicked] = useState(false);

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
    const storedChoice = cloudChoiceOf(cloudServiceUrl || '');
    const cloudChoice: CloudChoice = customPicked ? 'custom' : storedChoice;
    const saveCloudUrl = async (url: string) => {
        try {
            await dispatch(postSetCloudUrl({ cloudUrl: url })).unwrap();
            setCustomPicked(false);
        } catch (e) {
            console.error('Error updating cloud URL:', e);
        }
    };
    const handleCloudChoice = (key: string) => {
        if (key === 'custom') {
            setCustomUrlInput(cloudServiceUrl || '');
            setCustomPicked(true);
            return;
        }
        const choice = CLOUD_CHOICES.find((c) => c.key === key);
        if (choice && choice.key !== storedChoice) void saveCloudUrl(choice.url);
        else setCustomPicked(false);
    };
    // Until the user types, the field shows the stored address; a stored custom URL opens on it.
    const customUrlShown = customPicked ? customUrlInput : cloudServiceUrl || '';
    const customUrl = customUrlShown.trim();
    const customUrlChanged = customUrl !== '' && customUrl !== (cloudServiceUrl || '');

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
                        Advanced (Cloud service, specific Player ID
                        {showPollingEditor ? ', polling interval' : ''})
                    </Typography>
                </AccordionSummary>
                <AccordionDetails>
                    {/* Cloud service: production, development, or an address typed in full */}
                    <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140, pt: '9px' }}>
                            Cloud service:
                        </Typography>
                        <Box sx={{ flex: 1, minWidth: 240 }}>
                            <RadioGroup value={cloudChoice} onChange={(e) => handleCloudChoice(e.target.value)}>
                                {CLOUD_CHOICES.map((c) => (
                                    <FormControlLabel
                                        key={c.key}
                                        value={c.key}
                                        control={<Radio size="small" />}
                                        label={
                                            <Typography variant="body2">
                                                {c.label}{' '}
                                                <Typography
                                                    component="span"
                                                    variant="body2"
                                                    color="text.secondary"
                                                    sx={{ fontFamily: 'monospace' }}
                                                >
                                                    {c.host}
                                                </Typography>
                                            </Typography>
                                        }
                                    />
                                ))}
                                <FormControlLabel
                                    value="custom"
                                    control={<Radio size="small" />}
                                    label={<Typography variant="body2">Other address</Typography>}
                                />
                            </RadioGroup>
                            {cloudChoice === 'custom' && (
                                <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', mt: 0.5, pl: 4 }}>
                                    <TextField
                                        autoFocus={customPicked}
                                        fullWidth
                                        size="small"
                                        label="Cloud Service URL"
                                        value={customUrlShown}
                                        onChange={(e) => {
                                            setCustomUrlInput(e.target.value);
                                            setCustomPicked(true);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && customUrlChanged) void saveCloudUrl(customUrl);
                                        }}
                                        helperText="Registration and sync restart against the new address when you save."
                                    />
                                    <Button
                                        size="small"
                                        variant="contained"
                                        disabled={!customUrlChanged}
                                        onClick={() => void saveCloudUrl(customUrl)}
                                        sx={{ alignSelf: 'flex-start', mt: '1px' }}
                                    >
                                        Save
                                    </Button>
                                </Box>
                            )}
                        </Box>
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
