import { FC } from 'react';
import { Select, MenuItem, FormControl, InputLabel, SelectChangeEvent } from '@mui/material';

export type SortOption = {
    value: string;
    label: string;
};

interface SortDropdownProps {
    value: string;
    onChange: (value: string) => void;
    options: SortOption[];
    label?: string;
}

export const SortDropdown: FC<SortDropdownProps> = ({ value, onChange, options, label = 'Sort by' }) => {
    const handleChange = (event: SelectChangeEvent<string>) => {
        onChange(event.target.value);
    };

    return (
        <FormControl
            sx={{
                minWidth: 120,
                mb: 2,
            }}
        >
            <InputLabel id="sort-select-label">{label}</InputLabel>
            <Select
                labelId="sort-select-label"
                value={value}
                label={label}
                onChange={handleChange}
                sx={{
                    borderRadius: 2,
                }}
            >
                {options.map((option) => (
                    <MenuItem key={option.value} value={option.value}>
                        {option.label}
                    </MenuItem>
                ))}
            </Select>
        </FormControl>
    );
};
