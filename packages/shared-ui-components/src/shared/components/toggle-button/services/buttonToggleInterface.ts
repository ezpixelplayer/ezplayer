import { ToggleButtonProps, ToggleButtonGroupProps } from '@mui/material';

export type ButtonToggleType = {
    content: React.ReactNode | string;
    value: string | number;
};

export interface ButtonToggleProps {
    buttons: ButtonToggleType[];
}

export type CombinedProps = ButtonToggleProps & ToggleButtonProps & ToggleButtonGroupProps;
