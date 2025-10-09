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

    const renderCheckboxes = (option: any) => (
        <MenuItem key={option} value={option}>
            <Checkbox checked={data.indexOf(option) > -1} />
            <ListItemText primary={option} />
        </MenuItem>
    );

    const renderOption = (option: any) => (
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
                {options.map((option) => (isMultiple ? renderCheckboxes(option) : renderOption(option)))}
            </MuiSelect>
            <FormHelperText className="errorState">{helperText}</FormHelperText>
        </FormControl>
    );
};
