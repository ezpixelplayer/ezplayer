import React from 'react';
import { FormLabelProps, FormLabel as MuiFormLabel } from '@mui/material';

export const FormLabel = ({ children, id }: FormLabelProps) => {
    return <MuiFormLabel id={id}>{children}</MuiFormLabel>;
};

export default FormLabel;
