import React from 'react';
import { Box } from '../box/Box';
import { Dialog, IconButton, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { TestPanel, type TestPanelProps } from './TestPanel';

/**
 * The pattern controls as a panel floating over the bottom of the layout.
 * It takes no backdrop and no focus trap, so the layout behind stays in
 * view and in use while a pattern is tuned.  Closed, it stays mounted: a
 * running test goes on following the selection.
 */
export const TestPatternDialog: React.FC<TestPanelProps & { open: boolean; onClose: () => void }> = ({
    open,
    onClose,
    ...panel
}) => {
    const theme = useTheme();
    const small = useMediaQuery(theme.breakpoints.down('sm'));
    const running = !!panel.status?.active;
    return (
        <Dialog
            open={open}
            onClose={onClose}
            keepMounted
            hideBackdrop
            disableEnforceFocus
            disableAutoFocus
            disableRestoreFocus
            disableScrollLock
            maxWidth={false}
            // Only the panel itself takes the pointer; everything around it reaches the layout.
            sx={{
                pointerEvents: 'none',
                // Bottom middle: over the layout, clear of the navigation at the left.
                '& .MuiDialog-container': { alignItems: 'flex-end', justifyContent: 'center' },
            }}
            PaperProps={{
                elevation: 12,
                sx: {
                    pointerEvents: 'auto',
                    m: small ? 0 : 2,
                    width: small ? '100%' : 'min(620px, calc(100% - 32px))',
                    maxWidth: 'none',
                    maxHeight: small ? '55vh' : '70vh',
                    borderRadius: small ? '12px 12px 0 0' : 2,
                    opacity: 0.97,
                },
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                sx={{ pl: 2, pr: 0.5, py: 0.5, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}
            >
                <Typography variant="subtitle2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    Test pattern
                    <Typography component="span" variant="body2" color="text.secondary">
                        {panel.targetLabel
                            ? ` · ${running ? 'on' : 'for'} ${panel.targetLabel}`
                            : ' · pick a group or models first'}
                    </Typography>
                </Typography>
                <IconButton size="small" aria-label="Close the pattern controls" onClick={onClose}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Stack>
            <Box sx={{ overflowY: 'auto', px: 2, pb: 1.5 }}>
                <TestPanel {...panel} />
            </Box>
        </Dialog>
    );
};
