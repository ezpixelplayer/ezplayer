import React from 'react';
import { SvgIconProps, ButtonProps as MuiButtonProps } from '@mui/material';

export interface ButtonProps extends MuiButtonProps {
    btnText?: string;
    width?: string;
    icon?: React.ReactElement<SvgIconProps>;
    btnClass?: string;
    isDisable?: boolean;
}
