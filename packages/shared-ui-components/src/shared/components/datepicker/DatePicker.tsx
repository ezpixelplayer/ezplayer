import { DatePicker as MuiDatePicker } from '@mui/x-date-pickers';
import { CombinedProps } from './services/datepickerInterface';
import TextField from '@mui/material/TextField';

export const DatePicker = ({ ...props }: CombinedProps) => {
    return <MuiDatePicker {...props} renderInput={(params) => <TextField {...params} />} />;
};
