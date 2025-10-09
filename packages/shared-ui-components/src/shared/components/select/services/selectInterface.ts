import { SelectProps, InputLabelProps, OutlinedInputProps } from '@mui/material';

interface CustomSelectProps<T = string> {
    options: T[];
    label: string;
    isMultiple?: boolean;
    defaultValue?: string | number;
    isObject?: boolean;
    itemValue: string;
    itemText: string;
    helperText?: string;
}

export type CombinedProps<T = string> = CustomSelectProps<T> & SelectProps & InputLabelProps & OutlinedInputProps;
