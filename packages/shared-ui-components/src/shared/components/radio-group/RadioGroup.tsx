import React from 'react';
import { RadioGroup as MuiRadioGroup, RadioGroupProps } from '@mui/material';

export const RadioGroup = ({ children, name, value, row, onChange }: RadioGroupProps) => {
    return (
        <MuiRadioGroup name={name} value={value} row={row} onChange={onChange}>
            {children}
        </MuiRadioGroup>
    );
};

export default RadioGroup;
