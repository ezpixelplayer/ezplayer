import { Button, TextField, Typography } from '@mui/material';
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

/** Choose / set the optional media folder used by song auto-detect and bulk import.
 *  Desktop: native folder picker on this PC.
 *  LAN: permanent player paths are set in the desktop app; bulk-import retry
 *  picks a folder in the browser and uploads companion audio. */
export const MediaFolderSettings: React.FC = () => {
    const dispatch = useDispatch<AppDispatch>();
    const mediaFolder = useSelector((s: RootState) => s.playbackSettings.settings.mediaFolder);
    const [mediaFolderLocal, setMediaFolderLocal] = useState<string>(mediaFolder ?? '');
    const [saving, setSaving] = useState(false);
    const onDesktop = isElectron();

    useEffect(() => {
        setMediaFolderLocal(mediaFolder ?? '');
    }, [mediaFolder]);

    const persistMediaFolder = async (next: string | undefined) => {
        setSaving(true);
        try {
            dispatch(setMediaFolder(next));
            await dispatch(savePlayerSettings()).unwrap();
            ToastMsgs.showSuccessMessage(next ? `Media folder set: ${next}` : 'Media folder cleared', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } catch (error) {
            console.error('Failed to save media folder:', error);
            ToastMsgs.showErrorMessage('Failed to save media folder', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } finally {
            setSaving(false);
        }
    };

    const handleSelectMediaFolder = async () => {
        if (!onDesktop || !window.electronAPI?.selectDirectory) return;
        setSaving(true);
        try {
            const dirs = await window.electronAPI.selectDirectory({
                title: 'Select Media Folder',
                buttonLabel: 'Use Folder',
            });
            const chosen = dirs[0];
            if (!chosen) return;
            setMediaFolderLocal(chosen);
            await persistMediaFolder(chosen);
        } catch (error) {
            console.error('Error selecting media folder:', error);
            ToastMsgs.showErrorMessage('Failed to select media folder', {
                theme: 'colored',
                position: 'bottom-right',
                autoClose: 2000,
            });
        } finally {
            setSaving(false);
        }
    };

    const handleClearMediaFolder = async () => {
        setMediaFolderLocal('');
        await persistMediaFolder(undefined);
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {onDesktop ? (
                    <>
                        Extra location searched for companion MP3 files after the sequence&apos;s own folder. Used by
                        song autodetection and bulk import.
                    </>
                ) : (
                    <>
                        A permanent media folder path lives on the player PC and is set in the desktop app. During{' '}
                        <strong>Bulk Import</strong>, if audio is missing, choose a folder in this browser — matching
                        MP3s are uploaded and the failed sequences are retried.
                    </>
                )}
            </Typography>
            {onDesktop ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Button
                        variant="contained"
                        onClick={() => void handleSelectMediaFolder()}
                        disabled={saving}
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
                        onClick={() => void handleClearMediaFolder()}
                        disabled={!mediaFolderLocal || saving}
                        sx={{ whiteSpace: 'nowrap', px: 2, py: 1 }}
                    >
                        Clear
                    </Button>
                </Box>
            ) : mediaFolderLocal ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <TextField
                        fullWidth
                        variant="outlined"
                        size="small"
                        label="Current media folder (on player)"
                        value={mediaFolderLocal}
                        disabled
                        sx={{ '& .MuiInputBase-input': { color: 'text.primary' } }}
                    />
                    <Button
                        variant="outlined"
                        onClick={() => void handleClearMediaFolder()}
                        disabled={saving}
                        sx={{ whiteSpace: 'nowrap', px: 2, py: 1 }}
                    >
                        Clear
                    </Button>
                </Box>
            ) : null}
        </Box>
    );
};
