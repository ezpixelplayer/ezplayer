import { Box as MuiBox, Button, Card, CardContent, Typography, useTheme } from '@mui/material';
import HowToRegIcon from '@mui/icons-material/HowToReg';
import React from 'react';
import { useSelector } from 'react-redux';
import { Box } from '../box/Box';
import type { RootState } from '../../store/Store';

/**
 * True when this player should be offered EZRGB registration: the cloud worker
 * is active and the cloud has not confirmed the Player ID.  A paused cloud is
 * excluded — pausing resets `playerIdIsRegistered`, so it can't tell paused
 * from unregistered (same reasoning as CloudPage's "unregistered" mode).
 */
export const useShowEzrgbPromo = (): boolean =>
    useSelector((s: RootState) => s.cloudConfig.cloudEnabled !== false && !s.cloudStatus.playerIdIsRegistered);

const BENEFITS: { title: string; short: string; points: string[] }[] = [
    {
        title: 'Automatic sequence mapping & downloads',
        short: 'mapped to your layout, downloaded for you, plus free xLights Around The World sequences',
        points: [
            'Sequences are mapped to your layout automatically',
            'Downloaded to your player for you',
            'Free xLights Around The World sequences',
        ],
    },
    {
        title: 'Remote cloud management',
        short: 'manage your player and show from the EZRGB cloud',
        points: ['Manage your player and show remotely from the EZRGB cloud UI'],
    },
    {
        title: 'Show viewer page',
        short: 'show info, audio (non-commercial use) and song choices for visitors',
        points: [
            'A viewer page for your show with show information',
            'Visitors can listen to the show audio (non-commercial use)',
            'Visitors can choose songs',
        ],
    },
];

/** Decorative illustration: a player linked through the cloud to a lit house. Uses theme colors. */
const PromoGraphic: React.FC = () => {
    const theme = useTheme();
    const primary = theme.palette.primary.main;
    const secondary = theme.palette.secondary.main;
    const bulbs = [primary, secondary, theme.palette.success.main, theme.palette.warning.main];
    return (
        <svg
            viewBox="0 0 240 150"
            role="img"
            aria-label="Player connected to the EZRGB cloud and a lit show"
            style={{ width: '100%', maxWidth: 240, height: 'auto' }}
        >
            {/* cloud */}
            <path
                d="M70 62a22 22 0 0 1 42-8 18 18 0 0 1 30 12 16 16 0 0 1-4 31H78a18 18 0 0 1-8-35z"
                fill={primary}
                opacity={0.9}
            />
            <text x="106" y="82" textAnchor="middle" fontSize="13" fontWeight="bold" fill="#fff">
                EZRGB
            </text>
            {/* links */}
            <path d="M52 112 L88 92" stroke={secondary} strokeWidth="2" strokeDasharray="4 4" fill="none" />
            <path d="M168 112 L134 92" stroke={secondary} strokeWidth="2" strokeDasharray="4 4" fill="none" />
            {/* player */}
            <rect x="22" y="108" width="46" height="30" rx="4" fill="none" stroke={primary} strokeWidth="3" />
            <path d="M40 116l14 7-14 7z" fill={primary} />
            {/* house + lights */}
            <path d="M150 138v-24l28-22 28 22v24z" fill="none" stroke={primary} strokeWidth="3" strokeLinejoin="round" />
            {bulbs.map((c, i) => (
                <circle key={i} cx={156 + i * 14} cy={i === 1 || i === 2 ? 102 : 108} r="3.5" fill={c} />
            ))}
        </svg>
    );
};

interface EzrgbPromoCardProps {
    /** Registration call-to-action. Omit to hide the button (e.g. when registration isn't allowed here). */
    onRegister?: () => void;
    /** Label for the call-to-action. */
    registerLabel?: string;
    /** `compact` shows the headline with one-line benefits (Show Status); `full` lists the details (Cloud page). */
    variant?: 'full' | 'compact';
    /** Card sizing; the Cloud page's cards cap at 720px and carry a bottom margin. */
    sx?: React.ComponentProps<typeof Card>['sx'];
}

export const EzrgbPromoCard: React.FC<EzrgbPromoCardProps> = ({
    onRegister,
    registerLabel = 'Register with EZRGB',
    variant = 'full',
    sx,
}) => {
    const theme = useTheme();
    const compact = variant === 'compact';
    return (
        <Card sx={sx}>
            <CardContent>
                <Box sx={{ display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Box sx={{ flex: '0 1 200px', minWidth: 140, display: 'flex', justifyContent: 'center' }}>
                        <PromoGraphic />
                    </Box>
                    <Box sx={{ flex: '1 1 280px', minWidth: 0 }}>
                        <Typography
                            variant={compact ? 'h3' : 'h6'}
                            fontWeight="bold"
                            color={compact ? theme.palette.secondary.main : 'primary.main'}
                        >
                            Get more from your show with EZRGB
                        </Typography>
                        <MuiBox component="ul" sx={{ m: 0, mt: 1, pl: 2.5 }}>
                            {BENEFITS.map((b) => (
                                <MuiBox component="li" key={b.title} sx={{ mb: compact ? 0.25 : 1 }}>
                                    <Typography variant="body1" fontWeight="bold" component="span">
                                        {b.title}
                                    </Typography>
                                    {compact ? (
                                        <Typography variant="body2" component="span" color="text.secondary">
                                            {' — '}
                                            {b.short}
                                        </Typography>
                                    ) : (
                                        <MuiBox component="ul" sx={{ m: 0, pl: 2 }}>
                                            {b.points.map((p) => (
                                                <Typography key={p} variant="body2" component="li" color="text.secondary">
                                                    {p}
                                                </Typography>
                                            ))}
                                        </MuiBox>
                                    )}
                                </MuiBox>
                            ))}
                        </MuiBox>
                        {onRegister && (
                            <Button
                                startIcon={<HowToRegIcon />}
                                variant="contained"
                                size="small"
                                onClick={onRegister}
                                sx={{ mt: 2, textTransform: 'none' }}
                            >
                                {registerLabel}
                            </Button>
                        )}
                    </Box>
                </Box>
            </CardContent>
        </Card>
    );
};
