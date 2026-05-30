import { Button, FormControl, FormControlLabel, IconButton, SelectChangeEvent, Slider, Switch, Typography } from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import React, { useEffect, useState } from 'react';
import { Select } from '@ezplayer/shared-ui-components';
import { Box } from '../../box/Box';
import {
    UI_SCALE_DEFAULT,
    UI_SCALE_MAX,
    UI_SCALE_MIN,
    ezrgbThemeOptions,
    useThemeContext,
} from '../../../theme/ThemeBase';
import { ColorPaletteDialog } from '../../theme/ColorPaletteDialog';
import { setOrbitPreference, useOrbitPreference } from '../../../util/orbitPreference';

interface UISettingsLocal {
    theme?: string;
}

export const UISettings: React.FC = () => {
    const { themeName, handleThemeChange, uiScale, setUiScale, canSetUiScale } = useThemeContext();
    const [colorPaletteDialogOpen, setColorPaletteDialogOpen] = useState(false);
    const [initialLoadComplete, setInitialLoadComplete] = useState(false);
    const preferOrbit = useOrbitPreference();

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

            {/* UI scale slider only renders in Electron, where
                `webContents.setZoomFactor` does proper device-pixel zoom.
                In browser SPAs we used to apply CSS `zoom` here, but that
                breaks MUI Popper / Tabs indicator positioning (everything
                that reads getBoundingClientRect drifts). Cloud users have
                native browser zoom (Ctrl±) which doesn't have that problem. */}
            {canSetUiScale ? (
                <>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 4, mb: 1 }}>
                        UI scale (helps when demoing on a video call).
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Slider
                            value={uiScale}
                            onChange={(_, v) => setUiScale(typeof v === 'number' ? v : v[0])}
                            min={UI_SCALE_MIN}
                            max={UI_SCALE_MAX}
                            step={0.05}
                            marks={[
                                { value: UI_SCALE_MIN, label: `${Math.round(UI_SCALE_MIN * 100)}%` },
                                { value: UI_SCALE_DEFAULT, label: '100%' },
                                { value: UI_SCALE_MAX, label: `${Math.round(UI_SCALE_MAX * 100)}%` },
                            ]}
                            valueLabelDisplay="auto"
                            valueLabelFormat={(v) => `${Math.round(v * 100)}%`}
                            sx={{ flex: 1 }}
                        />
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={() => setUiScale(UI_SCALE_DEFAULT)}
                            disabled={uiScale === UI_SCALE_DEFAULT}
                        >
                            Reset
                        </Button>
                    </Box>
                </>
            ) : null}

            <Typography variant="body2" color="text.secondary" sx={{ mt: 4, mb: 1 }}>
                3D preview controls. Orbit mode is friendlier on trackpads and
                touch devices; the default auto-picks based on whether your
                device looks touch-only.
            </Typography>
            <FormControlLabel
                control={
                    <Switch
                        checked={preferOrbit}
                        onChange={(e) => setOrbitPreference(e.target.checked)}
                    />
                }
                label="Always use orbit controls"
            />
        </Box>
    );
};
