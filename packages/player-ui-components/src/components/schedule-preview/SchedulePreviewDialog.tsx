import { Dialog, IconButton, Tooltip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
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
    const closeButton = (
        <Tooltip key="schedule-preview-close" title="Close">
            <IconButton onClick={onClose} size="small" aria-label="close">
                <CloseIcon />
            </IconButton>
        </Tooltip>
    );

    return (
        <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth PaperProps={{ sx: { height: '90vh' } }}>
            <SchedulePreview title={title} statusArea={[closeButton]} />
        </Dialog>
    );
};
