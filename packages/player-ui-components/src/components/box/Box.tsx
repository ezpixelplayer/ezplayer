import { BoxProps, Box as MuiBox } from '@mui/material';

type Props = Omit<BoxProps, 'component'>;

export const Box = (props: Props) => <MuiBox component={'div'} {...props} />;
