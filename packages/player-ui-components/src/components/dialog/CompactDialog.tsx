import React from 'react';
import {
    Box as MuiBox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import type { Breakpoint } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';

/** Content dialog tuned for small screens: goes fullscreen on phones and
 *  keeps the header to a single slim row (title + close X), so the content
 *  scroll area gets nearly the whole viewport. Pass `actions` only when the
 *  dialog needs more than dismissal — the X replaces a Close actions bar. */
export const CompactDialog: React.FC<{
    title: React.ReactNode;
    onClose: () => void;
    maxWidth?: Breakpoint;
    actions?: React.ReactNode;
    children: React.ReactNode;
}> = ({ title, onClose, maxWidth = 'md', actions, children }) => {
    const theme = useTheme();
    const phone = useMediaQuery(theme.breakpoints.down('sm'));
    return (
        <Dialog open onClose={onClose} maxWidth={maxWidth} fullWidth fullScreen={phone}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1, pr: 1 }}>
                <MuiBox
                    component="span"
                    sx={{ flexGrow: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                >
                    {title}
                </MuiBox>
                <IconButton size="small" aria-label="close" onClick={onClose}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <DialogContent sx={phone ? { px: 1.5, pb: 1.5 } : undefined}>{children}</DialogContent>
            {actions && <DialogActions>{actions}</DialogActions>}
        </Dialog>
    );
};
