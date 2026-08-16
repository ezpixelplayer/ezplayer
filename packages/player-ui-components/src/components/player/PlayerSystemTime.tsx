import { Typography } from '@mui/material';
import { Box } from '../box/Box';
import { usePlayerSystemTime } from '../../hooks/usePlayerSystemTime';
import { ClockSkewSeverity } from '../../util/systemTimeUtils';

interface PlayerSystemTimeProps {
    className?: string;
}

const SKEW_COLOR: Record<Exclude<ClockSkewSeverity, 'none'>, string> = {
    info: 'info.main',
    warning: 'warning.main',
    error: 'error.main',
};

export const PlayerSystemTime = ({ className }: PlayerSystemTimeProps) => {
    const {
        playerTime,
        playerTimeZone,
        playerTimeZoneLabel,
        localTime,
        localTimeZone,
        localTimeZoneLabel,
        showLocalTime,
        clockOffsetMs,
        skewSeverity,
        skewLabel,
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
            {skewSeverity !== 'none' && skewLabel && (
                <Typography
                    variant="caption"
                    color={SKEW_COLOR[skewSeverity]}
                    noWrap
                    sx={{ display: 'block' }}
                    title={
                        clockOffsetMs !== undefined
                            ? `Offset vs this device: ${clockOffsetMs > 0 ? '+' : ''}${Math.round(clockOffsetMs / 1000)}s`
                            : undefined
                    }
                >
                    {skewLabel}
                </Typography>
            )}
        </Box>
    );
};
