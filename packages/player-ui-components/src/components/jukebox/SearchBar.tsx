import { FC, ChangeEvent } from 'react';
import { TextField, InputAdornment } from '@mui/material';
import { Search as SearchIcon } from '@mui/icons-material';

interface SearchBarProps {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
}

export const SearchBar: FC<SearchBarProps> = ({
    value,
    onChange,
    placeholder = 'Search by name or artist',
}: SearchBarProps) => {
    const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
        onChange(event.target.value);
    };

    return (
        <TextField
            fullWidth
            value={value}
            onChange={handleChange}
            placeholder={placeholder}
            variant="outlined"
            InputProps={{
                startAdornment: (
                    <InputAdornment position="start">
                        <SearchIcon color="action" />
                    </InputAdornment>
                ),
                sx: {
                    borderRadius: 2,
                    backgroundColor: 'background.paper',
                    '&:hover': {
                        backgroundColor: 'background.default',
                    },
                },
            }}
            sx={{
                width: '100%',
            }}
        />
    );
};
