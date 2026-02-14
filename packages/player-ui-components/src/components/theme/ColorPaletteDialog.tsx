import React, { useMemo } from 'react';
import {
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Card,
    CardContent,
    Grid,
    Typography,
    useTheme,
} from '@mui/material';
import { Box } from '../box/Box';
import CloseIcon from '@mui/icons-material/Close';
import { useThemeContext } from '../../theme/ThemeBase';

interface ColorPaletteDialogProps {
    open: boolean;
    onClose: () => void;
}

interface ColorSwatchProps {
    name: string;
    color: string;
}

const ColorSwatch: React.FC<ColorSwatchProps> = ({ name, color }) => {
    const theme = useTheme();

    const getContrastColor = (bgColor: string): string => {
        if (bgColor.includes('gradient') || bgColor.includes('rgba')) {
            if (bgColor.includes('black') || bgColor.includes('dark')) {
                return theme.palette.common.white;
            }
            return theme.palette.common.black;
        }

        const rgbMatch = bgColor.match(/\d+/g);
        if (rgbMatch && rgbMatch.length >= 3) {
            const r = parseInt(rgbMatch[0]);
            const g = parseInt(rgbMatch[1]);
            const b = parseInt(rgbMatch[2]);
            const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            return luminance > 0.5 ? theme.palette.common.black : theme.palette.common.white;
        }

        if (bgColor.toLowerCase().includes('black') || bgColor.toLowerCase().includes('dark')) {
            return theme.palette.common.white;
        }
        return theme.palette.common.black;
    };

    const textColor = getContrastColor(color);

    return (
        <Card
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
                        backgroundColor:
                            textColor === theme.palette.common.white
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

export const ColorPaletteDialog: React.FC<ColorPaletteDialogProps> = ({ open, onClose }) => {
    const theme = useTheme();
    const { themeName } = useThemeContext();

    const colorSections = useMemo(() => {
        const sections: Array<{ title: string; colors: Array<{ name: string; value: string }> }> = [];

        // MUI Palette Colors
        const paletteColors: Array<{ name: string; value: string }> = [];

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

        if (theme.palette.secondary?.main) {
            paletteColors.push({ name: 'palette.secondary.main', value: theme.palette.secondary.main });
        }

        if (theme.palette.error?.main) {
            paletteColors.push({ name: 'palette.error.main', value: theme.palette.error.main });
        }
        if (theme.palette.error?.dark) {
            paletteColors.push({ name: 'palette.error.dark', value: theme.palette.error.dark });
        }
        if (theme.palette.error?.contrastText) {
            paletteColors.push({ name: 'palette.error.contrastText', value: theme.palette.error.contrastText });
        }

        if (theme.palette.warning?.main) {
            paletteColors.push({ name: 'palette.warning.main', value: theme.palette.warning.main });
        }
        if (theme.palette.warning?.dark) {
            paletteColors.push({ name: 'palette.warning.dark', value: theme.palette.warning.dark });
        }

        if (theme.palette.info?.main) {
            paletteColors.push({ name: 'palette.info.main', value: theme.palette.info.main });
        }

        if (theme.palette.success?.main) {
            paletteColors.push({ name: 'palette.success.main', value: theme.palette.success.main });
        }
        if (theme.palette.success?.dark) {
            paletteColors.push({ name: 'palette.success.dark', value: theme.palette.success.dark });
        }

        if (theme.palette.text?.primary) {
            paletteColors.push({ name: 'palette.text.primary', value: theme.palette.text.primary });
        }
        if (theme.palette.text?.secondary) {
            paletteColors.push({ name: 'palette.text.secondary', value: theme.palette.text.secondary });
        }

        if (theme.palette.background?.default) {
            paletteColors.push({ name: 'palette.background.default', value: theme.palette.background.default });
        }
        if (theme.palette.background?.paper) {
            paletteColors.push({ name: 'palette.background.paper', value: theme.palette.background.paper });
        }

        if (theme.palette.divider) {
            paletteColors.push({ name: 'palette.divider', value: theme.palette.divider });
        }

        if (paletteColors.length > 0) {
            sections.push({ title: 'MUI Palette Colors (Used in Codebase)', colors: paletteColors });
        }

        // Custom Theme Colors
        const customColors: Array<{ name: string; value: string }> = [];
        if ((theme as any).colors?.gradients?.blue1) {
            customColors.push({ name: 'colors.gradients.blue1', value: (theme as any).colors.gradients.blue1 });
        }
        if ((theme as any).colors?.gradients?.blue2) {
            customColors.push({ name: 'colors.gradients.blue2', value: (theme as any).colors.gradients.blue2 });
        }
        if ((theme as any).colors?.gradients?.blue3) {
            customColors.push({ name: 'colors.gradients.blue3', value: (theme as any).colors.gradients.blue3 });
        }
        if ((theme as any).colors?.gradients?.blue4) {
            customColors.push({ name: 'colors.gradients.blue4', value: (theme as any).colors.gradients.blue4 });
        }
        if ((theme as any).colors?.gradients?.blue5) {
            customColors.push({ name: 'colors.gradients.blue5', value: (theme as any).colors.gradients.blue5 });
        }

        if (customColors.length > 0) {
            sections.push({ title: 'Custom Theme Colors (Gradients)', colors: customColors });
        }

        // Alpha Colors
        const alphaColors: Array<{ name: string; value: string }> = [];
        if ((theme as any).colors?.alpha?.black?.[100]) {
            alphaColors.push({ name: 'colors.alpha.black.100', value: (theme as any).colors.alpha.black[100] });
        }
        if ((theme as any).colors?.alpha?.black?.[70]) {
            alphaColors.push({ name: 'colors.alpha.black.70', value: (theme as any).colors.alpha.black[70] });
        }
        if ((theme as any).colors?.alpha?.black?.[50]) {
            alphaColors.push({ name: 'colors.alpha.black.50', value: (theme as any).colors.alpha.black[50] });
        }
        if ((theme as any).colors?.alpha?.black?.[30]) {
            alphaColors.push({ name: 'colors.alpha.black.30', value: (theme as any).colors.alpha.black[30] });
        }
        if ((theme as any).colors?.alpha?.black?.[10]) {
            alphaColors.push({ name: 'colors.alpha.black.10', value: (theme as any).colors.alpha.black[10] });
        }
        if ((theme as any).colors?.alpha?.black?.[5]) {
            alphaColors.push({ name: 'colors.alpha.black.5', value: (theme as any).colors.alpha.black[5] });
        }

        if ((theme as any).colors?.alpha?.white) {
            if ((theme as any).colors.alpha.white?.[100]) {
                alphaColors.push({ name: 'colors.alpha.white.100', value: (theme as any).colors.alpha.white[100] });
            }
            if ((theme as any).colors.alpha.white?.[70]) {
                alphaColors.push({ name: 'colors.alpha.white.70', value: (theme as any).colors.alpha.white[70] });
            }
            if ((theme as any).colors.alpha.white?.[50]) {
                alphaColors.push({ name: 'colors.alpha.white.50', value: (theme as any).colors.alpha.white[50] });
            }
            if ((theme as any).colors.alpha.white?.[30]) {
                alphaColors.push({ name: 'colors.alpha.white.30', value: (theme as any).colors.alpha.white[30] });
            }
            if ((theme as any).colors.alpha.white?.[10]) {
                alphaColors.push({ name: 'colors.alpha.white.10', value: (theme as any).colors.alpha.white[10] });
            }
            if ((theme as any).colors.alpha.white?.[5]) {
                alphaColors.push({ name: 'colors.alpha.white.5', value: (theme as any).colors.alpha.white[5] });
            }
        }

        if ((theme as any).colors?.alpha?.trueWhite) {
            if ((theme as any).colors.alpha.trueWhite?.[100]) {
                alphaColors.push({
                    name: 'colors.alpha.trueWhite.100',
                    value: (theme as any).colors.alpha.trueWhite[100],
                });
            }
            if ((theme as any).colors.alpha.trueWhite?.[70]) {
                alphaColors.push({
                    name: 'colors.alpha.trueWhite.70',
                    value: (theme as any).colors.alpha.trueWhite[70],
                });
            }
            if ((theme as any).colors.alpha.trueWhite?.[50]) {
                alphaColors.push({
                    name: 'colors.alpha.trueWhite.50',
                    value: (theme as any).colors.alpha.trueWhite[50],
                });
            }
            if ((theme as any).colors.alpha.trueWhite?.[5]) {
                alphaColors.push({ name: 'colors.alpha.trueWhite.5', value: (theme as any).colors.alpha.trueWhite[5] });
            }
        }

        if (alphaColors.length > 0) {
            sections.push({ title: 'Alpha Colors (Used in Codebase)', colors: alphaColors });
        }

        return sections;
    }, [theme]);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    height: '90vh',
                    maxHeight: '90vh',
                },
            }}
        >
            <DialogTitle
                sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    pb: 1,
                }}
            >
                Color Palette Test
                <IconButton
                    aria-label="close"
                    onClick={onClose}
                    sx={{
                        color: (theme) => theme.palette.grey[500],
                    }}
                >
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent
                sx={{
                    p: 0,
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column',
                    backgroundColor: 'background.default',
                }}
            >
                <Box sx={{ padding: 2, flexShrink: 0 }}>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                        Active Theme: <strong>{themeName}</strong>
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary', mb: 2 }}>
                        Use this view to review readability and contrast. Each color swatch shows sample text to help
                        identify contrast issues.
                    </Typography>
                </Box>

                <Box
                    sx={{
                        flex: 1,
                        overflow: 'auto',
                        padding: 2,
                    }}
                >
                    {colorSections.map((section) => (
                        <ColorSection key={section.title} title={section.title} colors={section.colors} />
                    ))}
                </Box>
            </DialogContent>
        </Dialog>
    );
};
