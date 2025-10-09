import { TextFieldProps } from '@mui/material';

export interface CustomProps {
    fieldType: string[];
    fieldId: string;
    onPlaceSelection: (placeData: any) => void;
}

export type GPlacesProps = CustomProps & TextFieldProps;
