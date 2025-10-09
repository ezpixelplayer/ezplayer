import * as React from 'react';
import { Stepper as MuiStepper, Step, StepLabel } from '@mui/material';
import { makeStyles } from '@mui/styles';
import { CombinedProps } from './services/stepperInterface';

const useStyles = makeStyles({
    stepper: {
        '& .MuiSvgIcon-root': {
            '& .MuiStepIcon-text': {
                visibility: 'hidden',
            },
        },
    },
});

export const Stepper = ({ stepsList, activestep, ...props }: CombinedProps) => {
    const classes = useStyles();
    return (
        <MuiStepper activeStep={activestep} data-testid="muistepper" {...props}>
            {stepsList.map((step) => (
                <Step key={step.key} {...props}>
                    <StepLabel className={classes.stepper} {...props}>
                        {step.value}
                    </StepLabel>
                </Step>
            ))}
        </MuiStepper>
    );
};
export default Stepper;
