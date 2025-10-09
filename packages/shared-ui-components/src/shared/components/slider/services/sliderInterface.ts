import { SliderProps as MuiSliderProps } from '@mui/material';

type Variant = 'primary' | 'secondary';
export interface SliderProps extends MuiSliderProps {
    disabled?: boolean;
    max?: number;
    min?: number;
    name?: string;
    onChange?: (event: Event, value: number | Array<number>, activeThumb: number) => void;
    step?: number;
    defaultValue?: number;
    marks?: boolean;
    color?: Variant;
}
