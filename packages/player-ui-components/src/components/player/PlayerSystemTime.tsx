import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import { usePlayerSystemTime } from '../../hooks/usePlayerSystemTime';

interface PlayerSystemTimeProps {
    className?: string;
}

export const PlayerSystemTime = ({ className }: PlayerSystemTimeProps) => {
    const {
        playerTime,
        playerTimeZone,
        playerTimeZoneLabel,
        localTime,
        localTimeZone,
        localTimeZoneLabel,
        showLocalTime,
    } = usePlayerSystemTime();

    return (
        <Box className={className} sx={{ minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ fontVariantNumeric: 'tabular-nums' }} title={playerTimeZone}>
                {showLocalTime ? 'Player: ' : ''}
                {playerTime} {playerTimeZoneLabel}
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
