import React, { useMemo, useState } from 'react';
import { Popover, Tooltip, Typography, useTheme } from '@mui/material';
import { rgbToHex } from '@mui/material/styles';
import { Box } from '../../box/Box';
import { getScheduleColorVariant } from '../../../util/scheduleDisplayColor';

const PRESET_PALETTE_KEYS = ['primary', 'info', 'success', 'warning', 'secondary'] as const;

export interface ScheduleColorPickerProps {
    className?: string;
    /** Saved custom color, or '' for automatic per-series coloring. */
    value: string;
    /** Color shown while `value` is '' (what automatic coloring would give this schedule). */
    autoColor: string;
    /** Called with a CSS color, or '' to return to automatic coloring. */
    onChange: (color: string) => void;
}

/**
 * Normalize any color MUI can parse (hex, rgb(), hsl()) to lowercase 6-digit hex,
 * which is the only form the native color input accepts. Null when it can't be.
 */
function toHex6(color: string): string | null {
    const trimmed = color.trim();
    if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toLowerCase();
    try {
        const hex = rgbToHex(trimmed);
        return /^#[0-9A-Fa-f]{6}$/.test(hex) ? hex.toLowerCase() : null;
    } catch {
        return null;
    }
}

function colorsEqual(a: string, b: string): boolean {
    const ha = toHex6(a);
    const hb = toHex6(b);
    return ha !== null && ha === hb;
}

const swatchSx = (selected: boolean) => ({
    width: 28,
    height: 28,
    borderRadius: '50%',
    cursor: 'pointer',
    border: selected ? '2px solid' : '1px solid',
    borderColor: selected ? 'text.primary' : 'divider',
    boxShadow: selected ? 1 : 0,
    outline: 'none',
    '&:focus-visible': {
        outline: '2px solid',
        outlineColor: 'primary.main',
        outlineOffset: 2,
    },
});

/**
 * Compact color control: a single swatch that opens a popover with the theme presets,
 * an "Automatic" option and a native custom-color input.
 */
export const ScheduleColorPicker: React.FC<ScheduleColorPickerProps> = ({
    className = '',
    value,
    autoColor,
    onChange,
}) => {
    const theme = useTheme();
    const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
    const open = Boolean(anchorEl);
    const isAuto = value === '';
    const displayColor = isAuto ? autoColor : value;

    const presets = useMemo(() => {
        const paletteColors = PRESET_PALETTE_KEYS.map((key) => theme.palette[key].main);
        const variants = [
            getScheduleColorVariant(theme.palette.primary.main, 1),
            getScheduleColorVariant(theme.palette.primary.main, 2),
            getScheduleColorVariant(theme.palette.info.main, 1),
        ];
        return [...paletteColors, ...variants];
    }, [theme]);

    const hexValue = toHex6(displayColor) ?? toHex6(theme.palette.primary.main) ?? '#808080';

    const handleSelect = (color: string) => {
        onChange(color);
        setAnchorEl(null);
    };

    const activate = (handler: () => void) => (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            handler();
        }
    };

    return (
        <>
            <Tooltip title={isAuto ? 'Schedule color (automatic)' : 'Schedule color'}>
                <Box
                    className={className}
                    role="button"
                    aria-label="Schedule color"
                    aria-haspopup="dialog"
                    aria-expanded={open}
                    tabIndex={0}
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    onKeyDown={(e) => activate(() => setAnchorEl(e.currentTarget as HTMLElement))(e)}
                    sx={{
                        width: 36,
                        height: 36,
                        flexShrink: 0,
                        borderRadius: '50%',
                        bgcolor: displayColor,
                        cursor: 'pointer',
                        border: '1px solid',
                        borderColor: 'divider',
                        boxShadow: open ? 2 : 1,
                        outline: 'none',
                        '&:hover': { boxShadow: 2 },
                        '&:focus-visible': {
                            outline: '2px solid',
                            outlineColor: 'primary.main',
                            outlineOffset: 2,
                        },
                    }}
                />
            </Tooltip>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={() => setAnchorEl(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <Box sx={{ p: 1.5 }}>
                    <Typography variant="body2" sx={{ mb: 1 }}>
                        Color
                    </Typography>
                    <Box
                        role="radiogroup"
                        aria-label="Schedule color"
                        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', maxWidth: 200 }}
                    >
                        <Tooltip title="Automatic (varies by schedule)">
                            <Box
                                role="radio"
                                aria-checked={isAuto}
                                aria-label="Automatic color"
                                tabIndex={0}
                                onClick={() => handleSelect('')}
                                onKeyDown={activate(() => handleSelect(''))}
                                sx={{
                                    ...swatchSx(isAuto),
                                    bgcolor: autoColor,
                                    borderStyle: 'dashed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: 12,
                                    fontWeight: 700,
                                    color: 'text.primary',
                                }}
                            >
                                A
                            </Box>
                        </Tooltip>
                        {presets.map((color) => {
                            const selected = !isAuto && colorsEqual(color, value);
                            return (
                                <Box
                                    key={color}
                                    role="radio"
                                    aria-checked={selected}
                                    aria-label={`Select color ${color}`}
                                    tabIndex={0}
                                    onClick={() => handleSelect(color)}
                                    onKeyDown={activate(() => handleSelect(color))}
                                    sx={{ ...swatchSx(selected), bgcolor: color }}
                                />
                            );
                        })}
                        <input
                            type="color"
                            aria-label="Custom schedule color"
                            value={hexValue}
                            onChange={(e) => onChange(e.target.value)}
                            style={{
                                width: 32,
                                height: 32,
                                padding: 0,
                                border: '1px solid rgba(0,0,0,0.23)',
                                borderRadius: 4,
                                cursor: 'pointer',
                                background: 'transparent',
                            }}
                        />
                    </Box>
                </Box>
            </Popover>
        </>
    );
};
