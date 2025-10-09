import * as React from 'react';
import { Card as MuiCard, CardProps } from '@mui/material';

export const Card = ({ children, ...props }: CardProps) => {
    return <MuiCard {...props}>{children}</MuiCard>;
};
export default Card;
