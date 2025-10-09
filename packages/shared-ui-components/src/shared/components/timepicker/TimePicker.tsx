import React from 'react';
import { TextField as MuiTextField } from '@mui/material';
import { TextFieldProps } from './services/timepickerInterface';

export const TimePicker = ({ ...props }: TextFieldProps) => {
    return <MuiTextField type="time" {...props} />;
};
export default TimePicker;
