import { FormControl, IconButton, SelectChangeEvent, Typography } from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import React, { useEffect, useState } from 'react';
import { Select } from '@ezplayer/shared-ui-components';
import { Box } from '../../box/Box';
import { ezrgbThemeOptions, useThemeContext } from '../../../theme/ThemeBase';
import { ColorPaletteDialog } from '../../theme/ColorPaletteDialog';

interface UISettingsLocal {
    theme?: string;
}

export const UISettings: React.FC = () => {
    const { themeName, handleThemeChange } = useThemeContext();
    const [colorPaletteDialogOpen, setColorPaletteDialogOpen] = useState(false);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);

    // Load saved theme from localStorage on first mount.
    useEffect(() => {
        const saved = localStorage.getItem('playbackSettings');
        if (saved) {
            try {
                const parsed = JSON.parse(saved) as UISettingsLocal;
                if (parsed?.theme) handleThemeChange(parsed.theme);
            } catch {
                // ignore malformed localStorage
            }
        }
        setInitialLoadComplete(true);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Persist theme on change.
    useEffect(() => {
        if (initialLoadComplete) {
            localStorage.setItem('playbackSettings', JSON.stringify({ theme: themeName }));
        }
    }, [themeName, initialLoadComplete]);

    const handleThemeSwitch = (event: SelectChangeEvent<unknown>) => {
        handleThemeChange(event.target.value as string);
    };

    return (
        <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Theme and color palette for the player UI.
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <FormControl fullWidth size="small" sx={{ flex: 1 }}>
                    <Select
                        options={ezrgbThemeOptions}
                        itemText="id"
                        itemValue="name"
                        onChange={(e) => handleThemeSwitch(e as SelectChangeEvent<unknown>)}
                        label="Theme"
                        value={themeName}
                    />
                </FormControl>
                <IconButton
                    onClick={() => setColorPaletteDialogOpen(true)}
                    size="medium"
                    sx={{
                        mt: '4px',
                        color: 'primary.main',
                        '&:hover': { backgroundColor: 'action.hover' },
                    }}
                    title="View Color Palette"
                >
                    <PaletteIcon />
                </IconButton>
            </Box>
            <ColorPaletteDialog open={colorPaletteDialogOpen} onClose={() => setColorPaletteDialogOpen(false)} />
        </Box>
    );
};
