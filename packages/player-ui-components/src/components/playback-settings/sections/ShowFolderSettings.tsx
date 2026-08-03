import { Button, TextField, Typography } from '@mui/material';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { isElectron, ToastMsgs } from '@ezplayer/shared-ui-components';
import type { EZPElectronAPI } from '@ezplayer/ezplayer-core';
import { Box } from '../../box/Box';
import type { AppDispatch, RootState } from '../../../store/Store';
import { savePlayerSettings, setMediaFolder } from '../../../store/slices/PlaybackSettingsStore';

declare global {
    interface Window {
        electronAPI?: EZPElectronAPI;
    }
}

export const ShowFolderSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const storedShowDirectory = useSelector((s: RootState) => s.auth.showDirectory);
    const mediaFolder = useSelector((s: RootState) => s.playbackSettings.settings.mediaFolder);
    const [selectedDirectory, setSelectedDirectory] = useState<string>('');
    const [mediaFolderLocal, setMediaFolderLocal] = useState<string>(mediaFolder ?? '');

    useEffect(() => {
        if (storedShowDirectory) setSelectedDirectory(storedShowDirectory);
    }, [storedShowDirectory]);

    useEffect(() => {
        setMediaFolderLocal(mediaFolder ?? '');
    }, [mediaFolder]);

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

    const persistMediaFolder = async (next: string | undefined) => {
        dispatch(setMediaFolder(next));
        try {
            await dispatch(savePlayerSettings()).unwrap();
        } catch (error) {
            console.error('Failed to save media folder:', error);
            ToastMsgs.showErrorMessage('Failed to save media folder', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    const handleSelectMediaFolder = async () => {
        if (!isElectron() || !window.electronAPI?.selectDirectory) return;
        try {
            const dirs = await window.electronAPI.selectDirectory({
                title: 'Select Media Folder',
                buttonLabel: 'Use Folder',
            });
            const chosen = dirs[0];
            if (!chosen) return;
            setMediaFolderLocal(chosen);
            await persistMediaFolder(chosen);
            ToastMsgs.showSuccessMessage(`Media folder set: ${chosen}`, {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } catch (error) {
            console.error('Error selecting media folder:', error);
            ToastMsgs.showErrorMessage('Failed to select media folder', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        }
    };

    const handleClearMediaFolder = async () => {
        setMediaFolderLocal('');
        await persistMediaFolder(undefined);
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Select a directory containing your show files.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button
                    variant="contained"
                    onClick={handleSelectDirectory}
                    sx={{ whiteSpace: 'nowrap', minWidth: 180, px: 2, py: 1 }}
                >
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

            <Typography variant="subtitle2" sx={{ mt: 4, mb: 0.5 }}>
                Media Folder (optional)
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                Extra location searched for companion MP3 files after the sequence&apos;s own folder. Used by song
                autodetection and bulk import.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Button
                    variant="contained"
                    onClick={handleSelectMediaFolder}
                    disabled={!isElectron()}
                    sx={{ whiteSpace: 'nowrap', minWidth: 180, px: 2, py: 1 }}
                >
                    Choose Media Folder
                </Button>
                <TextField
                    fullWidth
                    variant="outlined"
                    size="small"
                    placeholder="Not set — search sequence folder only"
                    value={mediaFolderLocal}
                    disabled
                    sx={{ '& .MuiInputBase-input': { color: 'text.primary' } }}
                />
                <Button
                    variant="outlined"
                    onClick={handleClearMediaFolder}
                    disabled={!mediaFolderLocal}
                    sx={{ whiteSpace: 'nowrap', px: 2, py: 1 }}
                >
                    Clear
                </Button>
            </Box>
        </Box>
    );
};
