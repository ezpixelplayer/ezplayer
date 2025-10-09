import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { AutocompleteProps, Autocomplete as MuiAutocomplete, Theme } from '@mui/material';
import React from 'react';

export type CombinedProps = AutocompleteProps<any, boolean | undefined, boolean | undefined, boolean | undefined>;
export interface StyleProps {
    currentThemes: Theme;
}

export const Autocomplete = React.forwardRef<any, CombinedProps>(({ renderInput, ...props }: CombinedProps, ref: any) => {
    const defaultRenderInput = (params: any) => {
        const InputComponent = params.InputComponent;
        return (
            <InputComponent
                {...params}
                inputProps={{
                    ...params.inputProps,
                    spellCheck: false,
                    autoCorrect: 'off',
                    autoComplete: 'off',
                }}
            />
        );
    };

    return (
        <MuiAutocomplete
            popupIcon={<ArrowDropDownIcon />}
            ref={ref}
            renderInput={renderInput || defaultRenderInput}
            {...props}
        />
    );
});
export default Autocomplete;
