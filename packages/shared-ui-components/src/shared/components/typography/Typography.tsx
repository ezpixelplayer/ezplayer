import { Typography as MuiTypography, TypographyProps } from '@mui/material';

export const Typography = ({ ...props }: TypographyProps) => {
    return <MuiTypography data-testid="typography" {...props} />;
};
export default Typography;
