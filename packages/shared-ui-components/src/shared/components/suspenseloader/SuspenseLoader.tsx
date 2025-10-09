import { useEffect } from 'react';
import NProgress from 'nprogress';
import { Box, CircularProgress } from '@mui/material';

export const SuspenseLoader = () => {
    useEffect(() => {
        NProgress.start();

        return () => {
            NProgress.done();
        };
    }, []);

    return (
        <Box className="suspenseloader" display="flex" alignItems="center" justifyContent="center">
            <CircularProgress size={64} disableShrink thickness={3} />
        </Box>
    );
};
