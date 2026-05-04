import { type EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { isElectron } from '@ezplayer/shared-ui-components';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Button,
    CircularProgress,
    Divider,
    Link,
    TextField,
    Typography,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import { createSelector } from '@reduxjs/toolkit';
import { QRCodeSVG } from 'qrcode.react';
import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { v4 as uuidv4 } from 'uuid';
import { Box } from '../box/Box';
import { API_ENDPOINTS } from '../../store/api/ApiEndpoints';
import { postSetCloudUrl, postSetPlayerIdToken } from '../../store/slices/AuthStore';
import { triggerCloudPoll } from '../../store/slices/CloudStatusStore';
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

/**
 * Friendly variant of the player-registration panel for first-time bootstrap. Leads
 * with the QR / URL ("scan and go") and tucks manual ID entry + cloud URL editing
 * inside an Advanced accordion. Auto-generates a Player ID on mount when none is set.
 */
export const PlayerCloudWelcomePanel: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();

    const playerIdToken = useSelector(selectPlayerIdToken);
    const cloudServiceUrl = useSelector(selectCloudServiceUrl);
    const playerIdIsRegistered = useSelector(selectIsRegistered);

    const [manualPlayerId, setManualPlayerId] = useState('');
    const [cloudUrlInput, setCloudUrlInput] = useState('');
    const [isEditingCloudUrl, setIsEditingCloudUrl] = useState(false);

    useEffect(() => {
        setCloudUrlInput(cloudServiceUrl || '');
    }, [cloudServiceUrl]);

    // Auto-generate a Player ID on mount when none is set, so the friendly QR-and-go
    // path lights up immediately.
    useEffect(() => {
        if (!playerIdToken) {
            void dispatch(postSetPlayerIdToken({ playerIdToken: uuidv4() }));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Fast-poll while waiting for registration. The default heartbeat is 30 s; that's
    // sluggish for a user staring at a QR code. Tick a manual poll every 2 s until the
    // cloud confirms registration, then stop.
    useEffect(() => {
        if (playerIdIsRegistered) return;
        const id = window.setInterval(() => {
            void dispatch(triggerCloudPoll());
        }, 2000);
        return () => window.clearInterval(id);
    }, [playerIdIsRegistered, dispatch]);

    const registrationUrl = useMemo(() => {
        if (!playerIdToken) return '';
        const base = cloudServiceUrl || '';
        return `${base}${API_ENDPOINTS.REGISTER_PLAYER}${playerIdToken}`;
    }, [cloudServiceUrl, playerIdToken]);

    const handleGenerateNew = () => {
        void dispatch(postSetPlayerIdToken({ playerIdToken: uuidv4() }));
    };
    const handleApplyManual = () => {
        const id = manualPlayerId.trim();
        if (!id) return;
        void dispatch(postSetPlayerIdToken({ playerIdToken: id }));
    };
    const handleClear = () => {
        setManualPlayerId('');
        void dispatch(postSetPlayerIdToken({ playerIdToken: '' }));
    };
    const handleCloudUrlSave = async () => {
        try {
            await dispatch(postSetCloudUrl({ cloudUrl: cloudUrlInput })).unwrap();
            setIsEditingCloudUrl(false);
        } catch (e) {
            console.error('Error updating cloud URL:', e);
        }
    };
    const handleCloudUrlCancel = () => {
        setCloudUrlInput(cloudServiceUrl || '');
        setIsEditingCloudUrl(false);
    };

    return (
        <Box>
            {/* Status row */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
                {playerIdIsRegistered ? (
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

            {/* Friendly path: QR + URL */}
            {playerIdToken && registrationUrl && !playerIdIsRegistered && (
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

            <Divider sx={{ my: 2 }} />

            {/* Advanced */}
            <Accordion disableGutters elevation={0} sx={{ bgcolor: 'transparent' }}>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="subtitle2" color="text.secondary">
                        Advanced (manual Player ID, change Cloud URL)
                    </Typography>
                </AccordionSummary>
                <AccordionDetails>
                    {/* Cloud Service URL */}
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                        Cloud Service URL
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                        <TextField
                            fullWidth
                            size="small"
                            value={cloudUrlInput}
                            onChange={(e) => setCloudUrlInput(e.target.value)}
                            disabled={!isEditingCloudUrl}
                            placeholder="Enter cloud service URL"
                        />
                        {!isEditingCloudUrl ? (
                            <Button size="small" variant="contained" onClick={() => setIsEditingCloudUrl(true)}>
                                Edit
                            </Button>
                        ) : (
                            <>
                                <Button size="small" variant="contained" onClick={handleCloudUrlSave}>
                                    Save
                                </Button>
                                <Button size="small" variant="outlined" onClick={handleCloudUrlCancel}>
                                    Cancel
                                </Button>
                            </>
                        )}
                    </Box>

                    {/* Current ID + manual override */}
                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                        Current Player ID
                    </Typography>
                    <TextField
                        fullWidth
                        size="small"
                        value={playerIdToken}
                        InputProps={{ readOnly: true }}
                        sx={{ mb: 2 }}
                    />
                    <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
                        <Button size="small" variant="outlined" onClick={handleGenerateNew}>
                            Generate New
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            color="error"
                            onClick={handleClear}
                            disabled={!playerIdToken && !manualPlayerId}
                        >
                            Clear
                        </Button>
                    </Box>

                    <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>
                        Set a specific Player ID
                    </Typography>
                    <Box sx={{ display: 'flex', gap: 1 }}>
                        <TextField
                            fullWidth
                            size="small"
                            placeholder="Paste a Player ID"
                            value={manualPlayerId}
                            onChange={(e) => setManualPlayerId(e.target.value)}
                        />
                        <Button
                            size="small"
                            variant="contained"
                            onClick={handleApplyManual}
                            disabled={!manualPlayerId.trim()}
                        >
                            Apply
                        </Button>
                    </Box>
                </AccordionDetails>
            </Accordion>
        </Box>
    );
};
