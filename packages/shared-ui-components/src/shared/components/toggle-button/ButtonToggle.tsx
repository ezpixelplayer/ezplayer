import { ToggleButton, ToggleButtonGroup as MuiToggleButtonGroup } from '@mui/material';

import { CombinedProps } from './services/buttonToggleInterface';

export const ButtonToggle = ({ buttons, ...props }: CombinedProps) => {
    // HTML
    return (
        <MuiToggleButtonGroup {...props} aria-label="Platform">
            {buttons?.map((item, index) => (
                <ToggleButton {...props} key={index} value={item?.value}>
                    {item?.content}
                </ToggleButton>
            ))}
        </MuiToggleButtonGroup>
    );
};
