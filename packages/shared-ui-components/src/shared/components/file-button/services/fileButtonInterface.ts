import { ButtonProps } from '@mui/material';
import { FILE_TYPES } from '../FileButton';

export interface FileButtonProps {
    fileType?: typeof FILE_TYPES;
    label?: string;
    isMultipleFile: boolean;
    onClick?: () => void;
    onChange: (val: object) => void;
}

export type CombinedProps = FileButtonProps & ButtonProps;
