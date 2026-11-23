import { alpha, Box as MuiBox, Button, Card, CardContent, Typography, useTheme } from '@mui/material';
import CloudDownloadOutlined from '@mui/icons-material/CloudDownloadOutlined';
import CloudOutlined from '@mui/icons-material/CloudOutlined';
import DevicesOutlined from '@mui/icons-material/DevicesOutlined';
import QueueMusicOutlined from '@mui/icons-material/QueueMusicOutlined';
import React, { useId } from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/Store';
import { Box } from '../box/Box';
import { EZRGB_LOGO_URL } from './ezrgbLogo';

/**
 * True when this player should be offered EZRGB registration: the cloud worker
 * is active and the cloud has not confirmed the Player ID.  A paused cloud is
 * excluded — pausing resets `playerIdIsRegistered`, so it can't tell paused
 * from unregistered (same reasoning as CloudPage's "unregistered" mode).
 */
export const useShowEzrgbPromo = (): boolean =>
    useSelector((s: RootState) => s.cloudConfig.cloudEnabled !== false && !s.cloudStatus.playerIdIsRegistered);

const BENEFITS: { title: string; short: string; long: string; Icon: typeof CloudOutlined }[] = [
    {
        title: 'Automatic sequence downloads',
        short: 'Sequences tailored for your layout, downloaded for you.',
        long: 'Get sequences tailored for your layout, downloaded straight to your player, plus free xLights Around The World sequences.',
        Icon: CloudDownloadOutlined,
    },
    {
        title: 'Manage your show from anywhere',
        short: 'Control your player and show remotely.',
        long: 'Manage your player and show remotely from the EZRGB cloud.',
        Icon: DevicesOutlined,
    },
    {
        title: 'Give visitors an interactive experience',
        short: 'Show info, song choices and audio (non-commercial use).',
        long: 'A viewer page with your show information, where visitors can choose songs and listen to the show audio (non-commercial use).',
        Icon: QueueMusicOutlined,
    },
];

/** The EZRGB logo in an outlined cloud. Decorative; the heading names the service. */
const CloudLogo: React.FC<{ width: number }> = ({ width }) => {
    const { palette } = useTheme();
    return (
        <Box aria-hidden sx={{ position: 'relative', width, aspectRatio: '112 / 68', mx: 'auto', mb: 1 }}>
            <svg viewBox="0 0 112 68" width="100%" height="100%" focusable="false">
                <path
                    d="M27 56a16 16 0 0 1-1-32 23 23 0 0 1 43-5 16 16 0 0 1 23 9 14 14 0 0 1-3 28Z"
                    fill={palette.background.default}
                    stroke={palette.primary.main}
                    strokeWidth="2.5"
                />
            </svg>
            <img
                src={EZRGB_LOGO_URL}
                alt=""
                style={{ position: 'absolute', top: '17%', left: '50%', height: '58%', transform: 'translateX(-50%)' }}
            />
        </Box>
    );
};

interface EzrgbPromoCardProps {
    /** Registration call-to-action. Omit to hide the button (e.g. when registration isn't allowed here). */
    onRegister?: () => void;
    /** Label for the call-to-action. */
    registerLabel?: string;
    /** `compact` has one-line benefits side by side (Show Status); `full` stacks the details (Cloud page). */
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
    const { palette } = useTheme();
    const headingId = useId();
    const compact = variant === 'compact';
    const accent = palette.primary.main;

    return (
        <Card
            component="section"
            aria-labelledby={headingId}
            sx={[
                {
                    border: 1,
                    borderColor: alpha(accent, 0.5),
                    backgroundImage: `radial-gradient(ellipse at top, ${alpha(accent, 0.1)}, transparent 70%)`,
                },
                ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
            ]}
        >
            <CardContent>
                <MuiBox component="header" sx={{ textAlign: 'center', mb: compact ? 2 : 3 }}>
                    <CloudLogo width={compact ? 132 : 180} />
                    <Typography
                        id={headingId}
                        component="h2"
                        variant={compact ? 'h3' : 'h2'}
                        fontWeight={800}
                        color={palette.secondary.main}
                    >
                        Make your light show even{' '}
                        <MuiBox component="span" sx={{ color: accent, fontStyle: 'italic', whiteSpace: 'nowrap' }}>
                            EZier!
                        </MuiBox>
                    </Typography>
                    {!compact && (
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            Connect EZPlayer to the EZRGB cloud to unlock more for your show.
                        </Typography>
                    )}
                </MuiBox>

                <MuiBox
                    component="ul"
                    sx={{
                        listStyle: 'none',
                        p: 0,
                        m: 0,
                        mx: 'auto',
                        maxWidth: compact ? undefined : 600,
                        display: 'grid',
                        gap: 2,
                        gridTemplateColumns: compact ? 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))' : '1fr',
                    }}
                >
                    {BENEFITS.map(({ title, short, long, Icon }) => (
                        <MuiBox component="li" key={title} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
                            <Box
                                aria-hidden
                                sx={{
                                    flex: 'none',
                                    display: 'grid',
                                    placeItems: 'center',
                                    width: 40,
                                    height: 40,
                                    borderRadius: '50%',
                                    border: 1,
                                    borderColor: alpha(accent, 0.5),
                                    bgcolor: alpha(accent, 0.12),
                                    color: accent,
                                }}
                            >
                                <Icon fontSize="small" />
                            </Box>
                            <Box sx={{ minWidth: 0 }}>
                                <Typography component="h3" variant="subtitle1" fontWeight="bold" color={accent}>
                                    {title}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                    {compact ? short : long}
                                </Typography>
                            </Box>
                        </MuiBox>
                    ))}
                </MuiBox>

                {onRegister && (
                    <Box sx={{ display: 'flex', justifyContent: 'center', mt: compact ? 2 : 3 }}>
                        <Button
                            variant="contained"
                            size={compact ? 'small' : 'medium'}
                            startIcon={<CloudOutlined />}
                            onClick={onRegister}
                            disableElevation
                            sx={{ textTransform: 'none', fontWeight: 'bold', borderRadius: 8, px: 2.5 }}
                        >
                            {registerLabel}
                        </Button>
                    </Box>
                )}
            </CardContent>
        </Card>
    );
};
