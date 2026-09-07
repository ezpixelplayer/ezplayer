import { IconButton, Tooltip, Typography } from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import React, { useState } from 'react';
import { Box } from '../box/Box';

interface MaskedPlayerIdProps {
    /** Empty renders `emptyLabel` with no controls. */
    value?: string;
    emptyLabel?: string;
}

/** Fixed width so the mask reveals nothing about the token's length or shape. */
const MASK = '••••••••••••••••••••';

/** Player ID shown masked, with an eye to reveal and a copy button that works
 *  either way. The ID is a credential, so it should not sit on screen unasked. */
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
