import { Button, TextField, Typography } from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { isElectron, ToastMsgs } from '@ezplayer/shared-ui-components';
import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import type { RootState } from '../../../store/Store';

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

export const ShowFolderSettings: React.FC = () => {
    const storedShowDirectory = useSelector((s: RootState) => s.auth.showDirectory);
    const [selectedDirectory, setSelectedDirectory] = useState<string>('');

    useEffect(() => {
        if (storedShowDirectory) setSelectedDirectory(storedShowDirectory);
    }, [storedShowDirectory]);

    const handleSelectDirectory = async () => {
        if (isElectron() && window.electronAPI?.requestChooseShowFolder) {
            try {
                const newSF = await window.electronAPI.requestChooseShowFolder();
                if (newSF) {
                    ToastMsgs.showSuccessMessage(`Directory selected: ${newSF}`, {
                        theme: 'colored',
                        position: 'bottom-right',
                        autoClose: 2000,
                    });
                }
            } catch (error) {
                console.error('Error selecting directory:', error);
                ToastMsgs.showErrorMessage('Failed to select directory', {
                    theme: 'colored',
                    position: 'bottom-right',
                    autoClose: 2000,
                });
            }
        }
    };

    /** "Download Cloud Show" — switch the player to a fresh, cloud-managed
     *  folder. Reuses the same `requestChooseCloudShowFolder` IPC the
     *  out-of-the-box Welcome flow uses, so first-time and switch-later land
     *  at the same validation + seeding path. If the chosen folder already
     *  has a cloud-config, the existing one is opened as-is (this is also
     *  the "reopen a previously-configured cloud folder" entry point). For
     *  a fresh folder, main has already seeded an empty cloud-config —
     *  CloudPage's Mode 1 ("not registered") lights up the Register flow as
     *  soon as the user navigates to it via the sidebar. */
    const handleDownloadCloudShow = async () => {
        if (!isElectron() || !window.electronAPI?.requestChooseCloudShowFolder) return;
        try {
            const { folder, existingInstall } = await window.electronAPI.requestChooseCloudShowFolder();
            if (!folder) return; // user cancelled (or picker rejected)
            const message = existingInstall
                ? `Opened existing cloud show: ${folder}`
                : `Switched to new cloud show: ${folder}. Open the Cloud screen to register this player.`;
            ToastMsgs.showSuccessMessage(message, {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: existingInstall ? 2000 : 5000,
            });
        } catch (error) {
            console.error('Error setting up cloud show:', error);
            ToastMsgs.showErrorMessage('Failed to set up cloud show', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Select a directory containing your show files.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button variant="contained" onClick={handleSelectDirectory} sx={{ whiteSpace: 'nowrap' }}>
                    Choose Show Folder
                </Button>
                <TextField
                    fullWidth
                    variant="outlined"
                    size="small"
                    placeholder="No directory selected"
                    value={selectedDirectory}
                    disabled
                    sx={{ '& .MuiInputBase-input': { color: 'text.primary' } }}
                />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 3, mb: 1 }}>
                Or start fresh with a cloud-managed show: pick an empty folder and pair it with your EZPlayer cloud
                account.
            </Typography>
            <Button
                variant="outlined"
                startIcon={<CloudDownloadIcon />}
                onClick={handleDownloadCloudShow}
                sx={{ whiteSpace: 'nowrap' }}
            >
                Download Cloud Show
            </Button>
        </Box>
    );
};
