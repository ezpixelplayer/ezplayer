import { RadioProps as MuiRadioprops } from '@mui/material';

type Variant = 'success' | 'info' | 'warning' | 'error' | 'primary' | 'secondary' | 'default';

type sizeVariant = 'small' | 'medium';
export interface RadioProps extends MuiRadioprops {
    checked?: boolean;
    color?: Variant;
    disabled?: boolean;
    name?: string;
    size?: sizeVariant;
}
