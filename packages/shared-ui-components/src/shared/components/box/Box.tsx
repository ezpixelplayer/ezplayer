import { forwardRef } from 'react';
import { BoxProps, Box as MuiBox } from '@mui/material';

type Props = Omit<BoxProps, 'component'>;

export const Box = forwardRef<HTMLDivElement, Props>((props, ref) => <MuiBox ref={ref} component={'div'} {...props} />);
