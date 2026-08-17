import React from 'react';
import {
    Select as MuiSelect,
    MenuItem,
    InputLabel,
    OutlinedInput,
    Checkbox,
    ListItemText,
    FormControl,
    FormHelperText,
} from '@mui/material';
import { CombinedProps } from './services/selectInterface';

export const Select = <T = string,>({
    isMultiple = false,
    defaultValue,
    options,
    isObject,
    helperText,
    itemValue,
    itemText,
    label,
    ...props
}: CombinedProps<T>) => {
    const [data, _setData] = React.useState<string[]>([]);

    // Multiple mode renders plain string options; single mode renders keyed objects.
    const renderCheckboxes = (option: string) => (
        <MenuItem key={option} value={option}>
            <Checkbox checked={data.indexOf(option) > -1} />
            <ListItemText primary={option} />
        </MenuItem>
    );

    const renderOption = (option: Record<string, string | number>) => (
        <MenuItem key={option[itemValue]} value={option[itemValue]}>
            {option[itemText]}
        </MenuItem>
    );

    return (
        <FormControl data-testid="selectinput" className="selectformcontrol">
            <InputLabel>{label}</InputLabel>
            <MuiSelect
                {...props}
                multiple={isMultiple}
                defaultValue={defaultValue}
                input={<OutlinedInput label={label} />}
            >
                {options.map((option) =>
                    isMultiple
                        ? renderCheckboxes(option as string)
                        : renderOption(option as Record<string, string | number>),
                )}
            </MuiSelect>
            <FormHelperText className="errorState">{helperText}</FormHelperText>
        </FormControl>
    );
};
