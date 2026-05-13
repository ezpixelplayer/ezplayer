import {
    Dialog,
    DialogContent,
    DialogTitle,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import React from 'react';
import { PlayerCloudRegistrationPanel } from './PlayerCloudRegistrationPanel';

interface PlayerCloudRegistrationDialogProps {
    open: boolean;
    onClose: () => void;
}

/**
 * Modal wrapper around `PlayerCloudRegistrationPanel`. Use the panel directly when
 * embedding inline (e.g. the Welcome bootstrap flow).
 */
export const PlayerCloudRegistrationDialog: React.FC<PlayerCloudRegistrationDialogProps> = ({
    open,
    onClose,
}) => (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth PaperProps={{ sx: { maxHeight: '90vh' } }}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h5">Player Cloud Registration</Typography>
            <Tooltip title="Close">
                <IconButton onClick={onClose} size="small" aria-label="close">
                    <CloseIcon />
                </IconButton>
            </Tooltip>
        </DialogTitle>
        <DialogContent dividers>
            <PlayerCloudRegistrationPanel />
        </DialogContent>
    </Dialog>
);
