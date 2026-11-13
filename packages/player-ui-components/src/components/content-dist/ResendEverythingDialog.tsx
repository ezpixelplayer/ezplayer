/**
 * Confirmation for sending the whole show again, file by file, to every device
 * that holds content.
 *
 * An ordinary distribution asks each device what it already has and sends only
 * the difference.  That question can be answered wrongly through no fault of
 * ours: a device can report a file's size, frame count, step time and channel
 * count, and a re-render that moves models around inside one controller's
 * channel range matches on all four while the pixels underneath are different.
 * Nothing can be deleted from a card either, so overwriting everything is the
 * only cure — and it is a whole-show transfer, which is worth a question
 * first.
 */

import ReplayIcon from '@mui/icons-material/Replay';
import {
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Typography,
} from '@mui/material';
import React from 'react';

export const ResendEverythingDialog: React.FC<{
    open: boolean;
    /** How many content-holding devices the send would reach. */
    deviceCount: number;
    onClose: () => void;
    onConfirm: () => void;
}> = ({ open, deviceCount, onClose, onConfirm }) => (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>Send everything again?</DialogTitle>
        <DialogContent>
            <DialogContentText>
                Every sequence and audio file in the show goes to{' '}
                {deviceCount === 1 ? 'the one device' : `all ${deviceCount} devices`} that hold content, whether or not
                it looks current. Nothing else about them changes.
            </DialogContentText>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Use this after re-rendering the show — above all when models have moved to different ports or channels.
                A device can only report a file’s size, frame count, step time and channel count; a re-render that
                rearranges models inside one controller’s range matches on all four, so an ordinary send calls those
                files current and leaves the old pixels in place.
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                It is a full transfer, so expect it to take as long as filling the devices did the first time.
            </Typography>
        </DialogContent>
        <DialogActions>
            <Button onClick={onClose}>Cancel</Button>
            <Button
                variant="contained"
                color="warning"
                startIcon={<ReplayIcon />}
                onClick={() => {
                    onConfirm();
                    onClose();
                }}
            >
                Send everything
            </Button>
        </DialogActions>
    </Dialog>
);
