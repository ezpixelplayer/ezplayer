import React from 'react';
import { Box } from '@mui/material';

interface TabPanelProps {
    children?: React.ReactNode;
    index: number;
    value: number;
}

const TabPanel = ({ children, value, index, ...props }: TabPanelProps) => {
    return (
        <Box
            role="tabpanel"
            hidden={value !== index}
            id={`custom-tabpanel-${index}`}
            aria-labelledby={`custom-tab-${index}`}
            sx={{ bgcolor: 'background.paper' }}
            {...props}
        >
            {value === index && <Box>{children}</Box>}
        </Box>
    );
};

export default TabPanel;
