import React, { useState } from 'react';
import {
    Popover,
    Box,
    Slider,
    Typography,
    Button,
    Divider,
    IconButton,
    Tooltip,
    useTheme,
} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';

export interface PreviewSettingsData {
    pixelSize: number; // Multiplier: 0.5 to 3.0
    backgroundBrightness: number; // 0 to 100
}

interface PreviewSettingsProps {
    anchorEl: HTMLElement | null;
    open: boolean;
    onClose: () => void;
    settings: PreviewSettingsData;
    onSettingsChange: (settings: PreviewSettingsData) => void;
    onSaveAsDefault: () => void;
}

export const PreviewSettings: React.FC<PreviewSettingsProps> = ({
    anchorEl,
    open,
    onClose,
    settings,
    onSettingsChange,
    onSaveAsDefault,
}) => {
    const theme = useTheme();
    const [localSettings, setLocalSettings] = useState<PreviewSettingsData>(settings);

    // Update local settings when prop changes
    React.useEffect(() => {
        setLocalSettings(settings);
    }, [settings]);

    const handlePixelSizeChange = (_event: Event, value: number | number[]) => {
        const newValue = typeof value === 'number' ? value : value[0];
        // Ensure value is within valid range and is a valid number
        const clampedValue = Math.max(0.5, Math.min(3.0, Number(newValue) || 1.0));
        console.log(`[PreviewSettings] Pixel size slider changed: ${localSettings.pixelSize} → ${clampedValue}`);
        // Only update if value actually changed to avoid unnecessary re-renders
        if (Math.abs(clampedValue - localSettings.pixelSize) > 0.001) {
            const updated: PreviewSettingsData = { ...localSettings, pixelSize: clampedValue };
            setLocalSettings(updated);
            onSettingsChange(updated);
        }
    };

    const handleBackgroundBrightnessChange = (_event: Event, value: number | number[]) => {
        const newValue = typeof value === 'number' ? value : value[0];
        const updated: PreviewSettingsData = { ...localSettings, backgroundBrightness: newValue };
        setLocalSettings(updated);
        onSettingsChange(updated);
    };

    return (
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={onClose}
            anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
            }}
            transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
            }}
            PaperProps={{
                sx: {
                    p: 2,
                    minWidth: 280,
                    maxWidth: 320,
                },
            }}
        >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                    Preview Settings
                </Typography>

                <Divider />

                {/* Pixel Size Slider */}
                <Box>
                    <Typography variant="body2" gutterBottom sx={{ mb: 1 }}>
                        Pixel Size: {localSettings.pixelSize.toFixed(2)}x
                    </Typography>
                    <Slider
                        value={localSettings.pixelSize}
                        onChange={handlePixelSizeChange}
                        min={0.5}
                        max={3.0}
                        step={0.1}
                        marks={[
                            { value: 0.5, label: '0.5x' },
                            { value: 1.0, label: '1x' },
                            { value: 2.0, label: '2x' },
                            { value: 3.0, label: '3x' },
                        ]}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${value.toFixed(1)}x`}
                    />
                </Box>

                {/* Background Brightness Slider */}
                <Box>
                    <Typography variant="body2" gutterBottom sx={{ mb: 1 }}>
                        Background Brightness: {Math.round(localSettings.backgroundBrightness)}%
                    </Typography>
                    <Slider
                        value={localSettings.backgroundBrightness}
                        onChange={handleBackgroundBrightnessChange}
                        min={0}
                        max={100}
                        step={1}
                        marks={[
                            { value: 0, label: '0%' },
                            { value: 50, label: '50%' },
                            { value: 100, label: '100%' },
                        ]}
                        valueLabelDisplay="auto"
                        valueLabelFormat={(value) => `${value}%`}
                    />
                </Box>

                <Divider />

                {/* Save as Default Button */}
                <Button
                    variant="outlined"
                    fullWidth
                    onClick={() => {
                        onSaveAsDefault();
                        onClose();
                    }}
                    sx={{ mt: 1 }}
                >
                    Make Current Settings Default
                </Button>
            </Box>
        </Popover>
    );
};

export const SettingsButton: React.FC<{
    onClick: (event: React.MouseEvent<HTMLElement>) => void;
}> = ({ onClick }) => {
    return (
        <Tooltip title="Preview Settings">
            <IconButton
                size="small"
                onClick={onClick}
                sx={{
                    color: 'inherit',
                }}
            >
                <SettingsIcon fontSize="small" />
            </IconButton>
        </Tooltip>
    );
};

