import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import { usePlayerSystemTime } from '../../hooks/usePlayerSystemTime';

interface PlayerSystemTimeProps {
    className?: string;
    /** Optional API origin for LAN / cloud-proxy clients. Defaults to `window.location.origin`. */
    apiBaseUrl?: string;
}

export const PlayerSystemTime = ({ className, apiBaseUrl }: PlayerSystemTimeProps) => {
    const {
        playerTime,
        playerTimeZone,
        playerTimeZoneLabel,
        localTime,
        localTimeZone,
        localTimeZoneLabel,
        showLocalTime,
    } = usePlayerSystemTime(apiBaseUrl);

    return (
        <Box className={className} sx={{ textAlign: 'right', minWidth: 0 }}>
            <Typography variant="body2" color="text.primary" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }} title={playerTimeZone}>
                {showLocalTime ? 'Player: ' : ''}
                {playerTime}{' '}
                <Typography component="span" variant="body2" color="text.secondary">
                    {playerTimeZoneLabel}
                </Typography>
            </Typography>
            {showLocalTime && localTime && localTimeZoneLabel && (
                <Typography
                    variant="caption"
                    color="text.secondary"
                    noWrap
                    sx={{ display: 'block', fontVariantNumeric: 'tabular-nums' }}
                    title={localTimeZone}
                >
                    Local: {localTime} {localTimeZoneLabel}
                </Typography>
            )}
        </Box>
    );
};
