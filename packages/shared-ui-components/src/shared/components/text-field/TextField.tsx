import { TextField as MuiTextField } from '@mui/material';
import { TextFieldProps } from './services/textFieldInterface';

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
