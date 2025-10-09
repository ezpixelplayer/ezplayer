import React, { useState } from 'react';
import { Slider as MuiSlider } from '@mui/material';
import { SliderProps } from './services/sliderInterface';

export const Slider = ({ disabled = false, ...props }: SliderProps) => {
    const [_value, setValue] = useState(1);
    const handleChange = (_event: Event, newValue: number | number[]) => {
        setValue(newValue as number);
    };
    return <MuiSlider disabled={disabled} {...props} valueLabelDisplay="auto" onChange={handleChange} />;
};
