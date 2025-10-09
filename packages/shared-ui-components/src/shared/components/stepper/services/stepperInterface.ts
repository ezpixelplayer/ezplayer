import { StepperProps, StepProps, StepLabelProps } from '@mui/material';

export interface CustomProps {
    stepsList: {
        value: string;
        key?: number;
    }[];
    activestep?: number;
}

export type CombinedProps = CustomProps & StepperProps & StepProps & StepLabelProps;
