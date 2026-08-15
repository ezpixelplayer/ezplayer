import { Dialog, DialogContent, DialogTitle, IconButton, Tooltip, Typography } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import PreviewIcon from '@mui/icons-material/Preview';
import { Box } from '../box/Box';
import { SchedulePreview } from './SchedulePreview';

interface SchedulePreviewDialogProps {
    open: boolean;
    onClose: () => void;
    title?: string;
}

export const SchedulePreviewDialog: React.FC<SchedulePreviewDialogProps> = ({
    open,
    onClose,
    title = 'Schedule Preview',
}) => {
    return (
        <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <PreviewIcon />
                    <Typography variant="h5">{title}</Typography>
                </Box>
                <Tooltip title="Close">
                    <IconButton onClick={onClose} size="small" aria-label="close">
                        <CloseIcon />
                    </IconButton>
                </Tooltip>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 0 }}>
                <SchedulePreview />
            </DialogContent>
        </Dialog>
    );
};
