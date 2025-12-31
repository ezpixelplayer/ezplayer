import React, { useMemo } from 'react';
import { Box, Card, CardContent, Grid, Typography, useTheme } from '@mui/material';
import { PageHeader } from '@ezplayer/shared-ui-components';
import { useThemeContext } from '../../theme/ThemeBase';

interface ColorSwatchProps {
    name: string;
    color: string;
    className?: string;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ name, color, className }) => {
    const theme = useTheme();

    // Calculate contrast ratio for text readability
    const getContrastColor = (bgColor: string): string => {
        // Simple heuristic: if it's a gradient or rgba with low opacity, use dark text
        if (bgColor.includes('gradient') || bgColor.includes('rgba')) {
            // For gradients, check if it's generally dark or light
            if (bgColor.includes('black') || bgColor.includes('dark')) {
                return theme.palette.common.white;
            }
            return theme.palette.common.black;
        }

        // Extract RGB values from hex or rgb string
        const rgbMatch = bgColor.match(/\d+/g);
        if (rgbMatch && rgbMatch.length >= 3) {
            const r = parseInt(rgbMatch[0]);
            const g = parseInt(rgbMatch[1]);
            const b = parseInt(rgbMatch[2]);
            // Calculate relative luminance
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? theme.palette.common.black : theme.palette.common.white;
        }

        // Fallback: check if color name suggests dark/light
        if (bgColor.toLowerCase().includes('black') || bgColor.toLowerCase().includes('dark')) {
            return theme.palette.common.white;
        }
        return theme.palette.common.black;
    };

    const textColor = getContrastColor(color);

    return (
        <Card
            className={className}
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid',
                borderColor: 'divider',
            }}
        >
            <Box
                sx={{
                    width: '100%',
                    height: 120,
                    background: color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative',
                }}
            >
                <Typography
                    variant="body2"
                    sx={{
                        color: textColor,
                        fontWeight: 'bold',
                        textAlign: 'center',
                        padding: 1,
                        backgroundColor: textColor === theme.palette.common.white
                            ? 'rgba(0, 0, 0, 0.3)'
                            : 'rgba(255, 255, 255, 0.3)',
                        borderRadius: 1,
                    }}
                >
                    Sample Text
                </Typography>
            </Box>
            <CardContent sx={{ flexGrow: 1, padding: 1.5 }}>
                <Typography variant="caption" sx={{ fontWeight: 'bold', display: 'block', mb: 0.5 }}>
                    {name}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{
                        color: 'text.secondary',
                        fontFamily: 'monospace',
                        fontSize: '0.7rem',
                        wordBreak: 'break-all',
                    }}
                >
                    {color}
                </Typography>
            </CardContent>
        </Card>
    );
};

interface ColorSectionProps {
    title: string;
    colors: Array<{ name: string; value: string }>;
}

const ColorSection: React.FC<ColorSectionProps> = ({ title, colors }) => {
    if (colors.length === 0) return null;

    return (
        <Box sx={{ mb: 4 }}>
            <Typography variant="h5" sx={{ mb: 2, fontWeight: 'bold' }}>
                {title}
            </Typography>
            <Grid container spacing={2}>
                {colors.map((color) => (
                    <Grid item xs={12} sm={6} md={4} lg={3} key={color.name}>
                        <ColorSwatch name={color.name} color={color.value} />
                    </Grid>
                ))}
            </Grid>
        </Box>
    );
};

interface ColorPaletteTestViewProps {
    title: string;
    statusArea?: React.ReactNode[];
}

export const ColorPaletteTestView: React.FC<ColorPaletteTestViewProps> = ({ title, statusArea = [] }) => {
    const theme = useTheme();
    const { themeName } = useThemeContext();

    // Extract only colors actually used in the codebase
    const colorSections = useMemo(() => {
        const sections: Array<{ title: string; colors: Array<{ name: string; value: string }> }> = [];

        // MUI Palette Colors - only those actually used in codebase
        const paletteColors: Array<{ name: string; value: string }> = [];

        // Primary colors used
        if (theme.palette.primary?.main) {
            paletteColors.push({ name: 'palette.primary.main', value: theme.palette.primary.main });
        }
        if (theme.palette.primary?.dark) {
            paletteColors.push({ name: 'palette.primary.dark', value: theme.palette.primary.dark });
        }
        if (theme.palette.primary?.light) {
            paletteColors.push({ name: 'palette.primary.light', value: theme.palette.primary.light });
        }
        if (theme.palette.primary?.contrastText) {
            paletteColors.push({ name: 'palette.primary.contrastText', value: theme.palette.primary.contrastText });
        }

        // Secondary colors used
        if (theme.palette.secondary?.main) {
            paletteColors.push({ name: 'palette.secondary.main', value: theme.palette.secondary.main });
        }

        // Error colors used
        if (theme.palette.error?.main) {
            paletteColors.push({ name: 'palette.error.main', value: theme.palette.error.main });
        }
        if (theme.palette.error?.dark) {
            paletteColors.push({ name: 'palette.error.dark', value: theme.palette.error.dark });
        }
        if (theme.palette.error?.contrastText) {
            paletteColors.push({ name: 'palette.error.contrastText', value: theme.palette.error.contrastText });
        }

        // Warning colors used
        if (theme.palette.warning?.main) {
            paletteColors.push({ name: 'palette.warning.main', value: theme.palette.warning.main });
        }

        // Info colors used
        if (theme.palette.info?.main) {
            paletteColors.push({ name: 'palette.info.main', value: theme.palette.info.main });
        }
        if (theme.palette.info?.dark) {
            paletteColors.push({ name: 'palette.info.dark', value: theme.palette.info.dark });
        }
        if (theme.palette.info?.light) {
            paletteColors.push({ name: 'palette.info.light', value: theme.palette.info.light });
        }
        if (theme.palette.info?.contrastText) {
            paletteColors.push({ name: 'palette.info.contrastText', value: theme.palette.info.contrastText });
        }

        // Text colors used
        if (theme.palette.text?.primary) {
            paletteColors.push({ name: 'palette.text.primary', value: theme.palette.text.primary });
        }
        if (theme.palette.text?.secondary) {
            paletteColors.push({ name: 'palette.text.secondary', value: theme.palette.text.secondary });
        }

        // Background colors used
        if (theme.palette.background?.default) {
            paletteColors.push({ name: 'palette.background.default', value: theme.palette.background.default });
        }
        if (theme.palette.background?.paper) {
            paletteColors.push({ name: 'palette.background.paper', value: theme.palette.background.paper });
        }

        // Action colors used
        if (theme.palette.action?.disabled) {
            paletteColors.push({ name: 'palette.action.disabled', value: theme.palette.action.disabled });
        }
        if (theme.palette.action?.disabledBackground) {
            paletteColors.push({ name: 'palette.action.disabledBackground', value: theme.palette.action.disabledBackground });
        }
        if (theme.palette.action?.hover) {
            paletteColors.push({ name: 'palette.action.hover', value: theme.palette.action.hover });
        }

        // Common colors used
        if (theme.palette.common?.black) {
            paletteColors.push({ name: 'palette.common.black', value: theme.palette.common.black });
        }
        if (theme.palette.common?.white) {
            paletteColors.push({ name: 'palette.common.white', value: theme.palette.common.white });
        }

        if (paletteColors.length > 0) {
            sections.push({ title: 'MUI Palette Colors (Used in Codebase)', colors: paletteColors });
        }

        // Extended Theme Colors - only those actually used
        const extendedColors: Array<{ name: string; value: string }> = [];

        if (theme.colors?.primary?.main) {
            extendedColors.push({ name: 'colors.primary.main', value: theme.colors.primary.main });
        }
        if (theme.colors?.primary?.dark) {
            extendedColors.push({ name: 'colors.primary.dark', value: theme.colors.primary.dark });
        }
        if (theme.colors?.primary?.light) {
            extendedColors.push({ name: 'colors.primary.light', value: theme.colors.primary.light });
        }
        if (theme.colors?.primary?.lighter) {
            extendedColors.push({ name: 'colors.primary.lighter', value: theme.colors.primary.lighter });
        }

        if (theme.colors?.secondary?.main) {
            extendedColors.push({ name: 'colors.secondary.main', value: theme.colors.secondary.main });
        }

        if (theme.colors?.error?.main) {
            extendedColors.push({ name: 'colors.error.main', value: theme.colors.error.main });
        }
        if (theme.colors?.error?.dark) {
            extendedColors.push({ name: 'colors.error.dark', value: theme.colors.error.dark });
        }
        if (theme.colors?.error?.light) {
            extendedColors.push({ name: 'colors.error.light', value: theme.colors.error.light });
        }
        if (theme.colors?.error?.lighter) {
            extendedColors.push({ name: 'colors.error.lighter', value: theme.colors.error.lighter });
        }

        if (theme.colors?.success?.main) {
            extendedColors.push({ name: 'colors.success.main', value: theme.colors.success.main });
        }
        if (theme.colors?.success?.lighter) {
            extendedColors.push({ name: 'colors.success.lighter', value: theme.colors.success.lighter });
        }

        if (theme.colors?.warning?.main) {
            extendedColors.push({ name: 'colors.warning.main', value: theme.colors.warning.main });
        }
        if (theme.colors?.warning?.lighter) {
            extendedColors.push({ name: 'colors.warning.lighter', value: theme.colors.warning.lighter });
        }

        if (theme.colors?.info?.main) {
            extendedColors.push({ name: 'colors.info.main', value: theme.colors.info.main });
        }
        if (theme.colors?.info?.dark) {
            extendedColors.push({ name: 'colors.info.dark', value: theme.colors.info.dark });
        }
        if (theme.colors?.info?.light) {
            extendedColors.push({ name: 'colors.info.light', value: theme.colors.info.light });
        }
        if (theme.colors?.info?.lighter) {
            extendedColors.push({ name: 'colors.info.lighter', value: theme.colors.info.lighter });
        }

        if (extendedColors.length > 0) {
            sections.push({ title: 'Extended Theme Colors (Used in Codebase)', colors: extendedColors });
        }

        // Alpha colors - only those actually used in codebase
        const alphaColors: Array<{ name: string; value: string }> = [];
        if (theme.colors?.alpha) {
            // Black alpha values used: 100, 70, 50, 30, 10, 5
            if (theme.colors.alpha.black?.[100]) {
                alphaColors.push({ name: 'colors.alpha.black.100', value: theme.colors.alpha.black[100] });
            }
            if (theme.colors.alpha.black?.[70]) {
                alphaColors.push({ name: 'colors.alpha.black.70', value: theme.colors.alpha.black[70] });
            }
            if (theme.colors.alpha.black?.[50]) {
                alphaColors.push({ name: 'colors.alpha.black.50', value: theme.colors.alpha.black[50] });
            }
            if (theme.colors.alpha.black?.[30]) {
                alphaColors.push({ name: 'colors.alpha.black.30', value: theme.colors.alpha.black[30] });
            }
            if (theme.colors.alpha.black?.[10]) {
                alphaColors.push({ name: 'colors.alpha.black.10', value: theme.colors.alpha.black[10] });
            }
            if (theme.colors.alpha.black?.[5]) {
                alphaColors.push({ name: 'colors.alpha.black.5', value: theme.colors.alpha.black[5] });
            }

            // White alpha values used: 100
            if (theme.colors.alpha.white?.[100]) {
                alphaColors.push({ name: 'colors.alpha.white.100', value: theme.colors.alpha.white[100] });
            }

            // TrueWhite alpha values used: 100, 70, 50, 5
            if (theme.colors.alpha.trueWhite?.[100]) {
                alphaColors.push({ name: 'colors.alpha.trueWhite.100', value: theme.colors.alpha.trueWhite[100] });
            }
            if (theme.colors.alpha.trueWhite?.[70]) {
                alphaColors.push({ name: 'colors.alpha.trueWhite.70', value: theme.colors.alpha.trueWhite[70] });
            }
            if (theme.colors.alpha.trueWhite?.[50]) {
                alphaColors.push({ name: 'colors.alpha.trueWhite.50', value: theme.colors.alpha.trueWhite[50] });
            }
            if (theme.colors.alpha.trueWhite?.[5]) {
                alphaColors.push({ name: 'colors.alpha.trueWhite.5', value: theme.colors.alpha.trueWhite[5] });
            }
        }
        if (alphaColors.length > 0) {
            sections.push({ title: 'Alpha Colors (Used in Codebase)', colors: alphaColors });
        }

        return sections;
    }, [theme]);

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                overflow: 'auto',
                backgroundColor: 'background.default',
            }}
        >
            <Box sx={{ padding: 2, flexShrink: 0 }}>
                <PageHeader heading={title} children={statusArea} />
                <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                    Active Theme: <strong>{themeName}</strong>
                </Typography>
                <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary', mb: 2 }}>
                    Use this view to review readability and contrast. Each color swatch shows sample text to help
                    identify contrast issues.
                </Typography>
            </Box>

            <Box sx={{ padding: 2, flexGrow: 1 }}>
                {colorSections.map((section) => (
                    <ColorSection key={section.title} title={section.title} colors={section.colors} />
                ))}
            </Box>
        </Box>
    );
};

