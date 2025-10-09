import React from 'react';
import { FormControlProps, FormControl as MuiFormControl } from '@mui/material';

export const FormControl = ({ children }: FormControlProps) => {
    return <MuiFormControl>{children}</MuiFormControl>;
};

export default FormControl;
