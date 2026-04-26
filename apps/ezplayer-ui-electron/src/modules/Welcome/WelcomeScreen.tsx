import { Box, Button, Paper, Typography } from '@mui/material';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Routes as ROUTES } from '@ezplayer/player-ui-components';

export const WELCOME_ROUTE = '/welcome';

export const WelcomeScreen = () => {
    const navigate = useNavigate();
    const [isOpening, setIsOpening] = React.useState(false);

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
            <Paper elevation={4} sx={{ maxWidth: 700, width: '100%', p: 4 }}>
                <Typography variant="h4" gutterBottom>
                    Welcome to EZPlayer
                </Typography>
                <Typography variant="body1" sx={{ mb: 2 }}>
                    EZPlayer helps you manage and run your show playlists, schedules, and playback.
                </Typography>
                <Typography variant="body1" sx={{ mb: 4 }}>
                    To get started, select a valid show folder containing the required xLights files:
                    <strong> xlights_rgbeffects.xml</strong> and <strong>xlights_networks.xml</strong>.
                </Typography>
                <Button variant="contained" size="large" onClick={() => void openFolderPicker()} disabled={isOpening}>
                    {isOpening ? 'Opening folder dialog...' : 'Select Show Folder'}
                </Button>
            </Paper>
        </Box>
    );
};

