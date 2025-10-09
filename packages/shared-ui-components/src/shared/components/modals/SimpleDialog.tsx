import DialogTitle from '@mui/material/DialogTitle';
import { Dialog, DialogContent } from '@mui/material';
import { MuiDialog } from './services/modalInterface';

export const SimpleDialog = ({ ...props }: MuiDialog) => {
    const { onClose, selectedValue, open, model_title, model_content } = props;

    const handleClose = () => {
        onClose?.(selectedValue || {}, 'backdropClick');
    };

    return (
        <Dialog onClose={handleClose} open={open} data-testid="modalcomponent">
            <DialogTitle>{model_title}</DialogTitle>
            <DialogContent>{model_content}</DialogContent>
        </Dialog>
    );
};
