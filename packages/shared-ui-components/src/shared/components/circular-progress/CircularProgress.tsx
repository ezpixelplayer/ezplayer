import { CircularProgress as MuiCircularProgress, CircularProgressProps } from '@mui/material';

export const CircularProgress = ({ ...props }: CircularProgressProps) => {
    return <MuiCircularProgress {...props} />;
};
export default CircularProgress;
