import React, { useCallback, useMemo } from 'react';
import { Autocomplete, Chip, TextField } from '@mui/material';
import { normalizeTagList } from '../../services/jukeboxFilter';

export interface TagListInputProps {
    label: string;
    value: string[];
    onChange: (next: string[]) => void;
    helperText?: string;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    suggestions?: string[];
}

export const TagListInput: React.FC<TagListInputProps> = React.memo(
    ({ label, value, onChange, helperText, placeholder, disabled, className, suggestions }) => {
        const normalizedValue = useMemo(() => normalizeTagList(value, []), [value]);
        const normalizedSuggestions = useMemo(
            () => (suggestions ? normalizeTagList(suggestions, []) : []),
            [suggestions],
        );

        const handleChange = useCallback(
            (_: unknown, newValue: string[]) => {
                onChange(normalizeTagList(newValue, []));
            },
            [onChange],
        );

        return (
            <Autocomplete
                className={className}
                multiple
                freeSolo
                disableClearable={false}
                size="small"
                disabled={disabled}
                options={normalizedSuggestions}
                value={normalizedValue}
                onChange={handleChange}
                renderTags={(tagValue, getTagProps) =>
                    tagValue.map((option, index) => (
                        <Chip
                            variant="outlined"
                            size="small"
                            label={option}
                            {...getTagProps({ index })}
                            key={`${option}-${index}`}
                        />
                    ))
                }
                renderInput={(params) => (
                    <TextField
                        {...params}
                        label={label}
                        placeholder={placeholder}
                        helperText={helperText}
                        inputProps={{
                            ...params.inputProps,
                            autoCapitalize: 'none',
                            autoCorrect: 'off',
                            spellCheck: false,
                        }}
                    />
                )}
            />
        );
    },
);

