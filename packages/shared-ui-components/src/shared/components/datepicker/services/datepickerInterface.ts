import { TextFieldProps } from '@mui/material';
import { DatePickerProps } from '@mui/x-date-pickers';

export type CombinedProps = TextFieldProps & DatePickerProps<unknown, unknown>;
