import React, { useMemo } from 'react';
import { Typography, useTheme } from '@mui/material';
import { Box } from '../../box/Box';
import { getScheduleColorVariant } from '../../../util/scheduleDisplayColor';

const PRESET_PALETTE_KEYS = ['primary', 'info', 'success', 'warning', 'secondary'] as const;

export interface ScheduleColorPickerProps {
    className?: string;
    value: string;
    onChange: (color: string) => void;
}

function colorsEqual(a: string, b: string): boolean {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const ScheduleColorPicker: React.FC<ScheduleColorPickerProps> = ({
    className = '',
    value,
    onChange,
}) => {
    const theme = useTheme();

    const presets = useMemo(() => {
        const paletteColors = PRESET_PALETTE_KEYS.map((key) => theme.palette[key].main);
        const variants = [
            getScheduleColorVariant(theme.palette.primary.main, 1),
            getScheduleColorVariant(theme.palette.primary.main, 2),
            getScheduleColorVariant(theme.palette.info.main, 1),
        ];
        return [...paletteColors, ...variants];
    }, [theme]);

    const hexValue = /^#[0-9A-Fa-f]{6}$/.test(value) ? value : '#1976d2';

    return (
        <Box className={className}>
            <Typography variant="body2" sx={{ mb: 1 }}>
                Color
            </Typography>
            <Box
                role="radiogroup"
                aria-label="Schedule color"
                sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
            >
                {presets.map((color) => {
                    const selected = colorsEqual(color, value);
                    return (
                        <Box
                            key={color}
                            role="radio"
                            aria-checked={selected}
                            aria-label={`Select color ${color}`}
                            tabIndex={0}
                            onClick={() => onChange(color)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    onChange(color);
                                }
                            }}
                            sx={{
                                width: 28,
                                height: 28,
                                borderRadius: '50%',
                                bgcolor: color,
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
                            }}
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
    );
};
