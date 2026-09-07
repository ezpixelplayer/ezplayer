import { IconButton, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import React, { useState } from 'react';
import { Box } from '../box/Box';

interface MaskedPlayerIdProps {
    /** The token. Empty / undefined renders `emptyLabel` with no controls. */
    value?: string;
    emptyLabel?: string;
}

/** Fixed-width mask regardless of the real token — its length and shape are
 *  not the viewer's business either. */
const MASK = '••••••••••••••••••••';

/**
 * Player ID display that hides the token until the eye is pressed. The token is
 * a bearer credential (anyone holding it can drive the player through the cloud),
 * so it must not sit on screen unprompted — but it also needs to be one click to
 * copy for the "enter it on another machine" flow. Masked by default, reveal
 * toggles, copy works whether revealed or not.
 */
export const MaskedPlayerId: React.FC<MaskedPlayerIdProps> = ({ value, emptyLabel = '(not set)' }) => {
    const [revealed, setRevealed] = useState(false);
    const [copied, setCopied] = useState(false);

    if (!value) {
        return (
            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {emptyLabel}
            </Typography>
        );
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch (e) {
            console.warn('[MaskedPlayerId] clipboard write failed:', e);
        }
    };

    return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
            <Typography
                variant="body2"
                sx={{ fontFamily: 'monospace', wordBreak: 'break-all', userSelect: revealed ? 'text' : 'none' }}
            >
                {revealed ? value : MASK}
            </Typography>
            <Tooltip title={revealed ? 'Hide Player ID' : 'Show Player ID'}>
                <IconButton
                    size="small"
                    onClick={() => setRevealed((r) => !r)}
                    aria-label={revealed ? 'hide player id' : 'show player id'}
                >
                    {revealed ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                </IconButton>
            </Tooltip>
            <Tooltip title={copied ? 'Copied' : 'Copy Player ID'}>
                <IconButton size="small" onClick={() => void handleCopy()} aria-label="copy player id">
                    <ContentCopyIcon fontSize="small" />
                </IconButton>
            </Tooltip>
        </Box>
    );
};
