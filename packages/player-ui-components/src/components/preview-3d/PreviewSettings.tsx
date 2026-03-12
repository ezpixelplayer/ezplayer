import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
    Popper,
    Paper,
    Slider,
    Typography,
    Button,
    Divider,
    IconButton,
    Tooltip,
    ClickAwayListener,
} from '@mui/material';
import { Box } from '../box/Box';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';

type SliderMark = {
    value: number;
    label: string;
};

const popoverPaperSx = {
    p: 2,
    minWidth: 280,
    maxWidth: 320,
} as const;

const contentBoxStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
};

const pixelSizeMarks: SliderMark[] = [
    { value: 0.5, label: '0.5x' },
    { value: 1.0, label: '1x' },
    { value: 2.0, label: '2x' },
    { value: 3.0, label: '3x' },
];

const brightnessMarks: SliderMark[] = [
    { value: 0, label: '0%' },
    { value: 50, label: '50%' },
    { value: 100, label: '100%' },
];

export interface PreviewSettingsData {
    pixelSize: number; // Multiplier: 0.5 to 3.0
    brightnessMultiplier: number; // 0–100 percentage multiplier applied to XML brightness
}

interface PreviewSettingsProps {
    anchorPosition: { top: number; left: number } | null;
    open: boolean;
    onClose: () => void;
    settings: PreviewSettingsData;
    onSettingsChange: (settings: PreviewSettingsData) => void;
    onSaveAsDefault: () => void;
}

export const PreviewSettings: React.FC<PreviewSettingsProps> = ({
    anchorPosition,
    open,
    onClose,
    settings,
    onSettingsChange,
    onSaveAsDefault,
}) => {
    const [localSettings, setLocalSettings] = useState<PreviewSettingsData>(settings);

    // Always-current ref so event handlers never read stale state.
    const localSettingsRef = useRef<PreviewSettingsData>(localSettings);
    localSettingsRef.current = localSettings;

    // Snapshot of settings when the popup was opened, used to revert on cancel
    const openSnapshotRef = useRef<PreviewSettingsData>(settings);
    const prevOpenRef = useRef(false);

    // Only sync and capture snapshot on the open transition (closed → open)
    useEffect(() => {
        if (open && !prevOpenRef.current) {
            openSnapshotRef.current = { ...settings };
            setLocalSettings(settings);
            localSettingsRef.current = settings;
        }
        prevOpenRef.current = open;
    }, [open, settings]);

    // Virtual anchor element for Popper positioning (from pixel coordinates)
    const popperAnchorEl = useMemo(() => {
        if (!anchorPosition) return null;
        return {
            getBoundingClientRect: () =>
                new DOMRect(anchorPosition.left, anchorPosition.top, 0, 0),
        };
    }, [anchorPosition]);

    // Cancel / close: revert to snapshot and close
    const handleCancel = useCallback(() => {
        const snapshot = openSnapshotRef.current;
        onClose();
        requestAnimationFrame(() => {
            onSettingsChange(snapshot);
        });
    }, [onClose, onSettingsChange]);

    // Close on Escape key (Popover/Modal handled this automatically, Popper does not)
    useEffect(() => {
        if (!open) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                handleCancel();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, handleCancel]);

    // ── Slider handlers ───────────────────────────────────────────────
    // Both update local state (slider visual) AND push to parent immediately.
    // This is safe because the Viewer now applies pixelSizeMultiplier via a
    // cheap uniform update (< 1 ms) instead of a full geometry rebuild.

    const handlePixelSizeChange = useCallback(
        (_event: Event | React.SyntheticEvent, value: number | number[]) => {
            const raw = typeof value === 'number' ? value : value[0];
            const clamped = Math.max(0.5, Math.min(3.0, raw));
            const next = { ...localSettingsRef.current, pixelSize: clamped };
            localSettingsRef.current = next;
            setLocalSettings(next);
            onSettingsChange(next);
        },
        [onSettingsChange],
    );

    const handleBrightnessChange = useCallback(
        (_event: Event | React.SyntheticEvent, value: number | number[]) => {
            const raw = typeof value === 'number' ? value : value[0];
            const clamped = Math.max(0, Math.min(100, raw));
            const next = { ...localSettingsRef.current, brightnessMultiplier: clamped };
            localSettingsRef.current = next;
            setLocalSettings(next);
            onSettingsChange(next);
        },
        [onSettingsChange],
    );

    if (!open) return null;

    return (
        <Popper
            open={open}
            anchorEl={popperAnchorEl}
            placement="bottom-start"
            style={{ zIndex: 1300 }}
            modifiers={[
                {
                    name: 'preventOverflow',
                    enabled: true,
                    options: { boundary: 'viewport', padding: 8 },
                },
            ]}
        >
            <ClickAwayListener onClickAway={handleCancel}>
                <Paper sx={popoverPaperSx} elevation={8}>
                    <Box style={contentBoxStyle}>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                Preview Settings
                            </Typography>
                            <IconButton size="small" onClick={handleCancel} aria-label="Close settings">
                                <CloseIcon fontSize="small" />
                            </IconButton>
                        </Box>

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
                                marks={pixelSizeMarks}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(value) => `${value.toFixed(1)}x`}
                            />
                        </Box>

                        {/* Brightness Multiplier Slider */}
                        <Box>
                            <Typography variant="body2" gutterBottom sx={{ mb: 1 }}>
                                Brightness: {Math.round(localSettings.brightnessMultiplier)}%
                            </Typography>
                            <Slider
                                value={localSettings.brightnessMultiplier}
                                onChange={handleBrightnessChange}
                                min={0}
                                max={100}
                                step={1}
                                marks={brightnessMarks}
                                valueLabelDisplay="auto"
                                valueLabelFormat={(value) => `${value}%`}
                            />
                        </Box>

                        <Divider />

                        {/* Action Buttons */}
                        <Box sx={{ display: 'flex', gap: 1.5, mt: 1, justifyContent: 'flex-end' }}>
                            <Button
                                variant="text"
                                color="inherit"
                                size="small"
                                onClick={handleCancel}
                                sx={{ textTransform: 'none', minWidth: 70 }}
                            >
                                Revert
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                size="small"
                                onClick={() => {
                                    onSaveAsDefault();
                                    onClose();
                                }}
                                sx={{ textTransform: 'none', minWidth: 120 }}
                            >
                                Ok
                            </Button>
                        </Box>
                    </Box>
                </Paper>
            </ClickAwayListener>
        </Popper>
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
