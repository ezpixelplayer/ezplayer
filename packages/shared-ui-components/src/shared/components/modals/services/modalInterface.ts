import { Dialog as MuiDialog, DialogProps as MuiDialogProps } from '@mui/material';

export interface MuiDialog extends MuiDialogProps {
    onclose?: (event: object, reason: string) => void;
    open: boolean;
    selectedValue?: string;
    model_title?: JSX.Element;
    model_content?: JSX.Element;
    model_actions?: JSX.Element;
}
