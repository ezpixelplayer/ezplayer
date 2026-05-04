import { Button, TextField, Typography } from '@mui/material';
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
        </Box>
    );
};
