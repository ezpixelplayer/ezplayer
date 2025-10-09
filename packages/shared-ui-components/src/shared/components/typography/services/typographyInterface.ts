import { TypographyProps as MuiTypographyProps } from '@mui/material';
type align = 'center' | 'inherit' | 'right' | 'left' | 'justify';
type variant = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'body1' | 'body2' | 'inherit';
export interface TypographyProps extends MuiTypographyProps {
    variant?: variant;
    align?: align;
}
