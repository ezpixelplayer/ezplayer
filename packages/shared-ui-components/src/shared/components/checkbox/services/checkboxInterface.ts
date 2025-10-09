import { CheckboxProps as MuiCheckboxprops } from '@mui/material';

type Variant = 'success' | 'info' | 'warning' | 'error' | 'primary' | 'secondary' | 'default';

export interface CheckboxProps extends MuiCheckboxprops {
    disabled?: boolean;
    defaultChecked?: boolean;
    color?: Variant;
}
