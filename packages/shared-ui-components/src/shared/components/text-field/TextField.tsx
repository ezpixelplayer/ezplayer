import { TextField as MuiTextField, TextFieldProps } from '@mui/material';

export const TextField = ({ ...props }: TextFieldProps) => {
    return (
        <MuiTextField
            {...props}
            inputProps={{
                spellCheck: false,
                autoCorrect: 'off',
                autoComplete: 'off',
                ...props.inputProps,
            }}
        />
    );
};
export default TextField;
