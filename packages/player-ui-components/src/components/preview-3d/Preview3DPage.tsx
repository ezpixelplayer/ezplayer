import React from 'react';
import { Box } from '../box/Box';
import { PageHeader, ExtendedTheme } from '@ezplayer/shared-ui-components';
import { useTheme } from '@mui/material';
import { Preview3D } from './Preview3D';

export interface Preview3DPageProps {
    title: string;
    statusArea: React.ReactNode[];
    modelUrl?: string;
    enableAutoColorAnimation?: boolean;
}

export const Preview3DPage: React.FC<Preview3DPageProps> = ({
    title,
    statusArea,
    modelUrl,
    enableAutoColorAnimation = false,
}) => {
    const theme = useTheme<ExtendedTheme>();

    return (
        <Box
            sx={{
                display: 'flex',
                flexDirection: 'column',
                height: '100vh',
                width: '100%',
                overflow: 'hidden',
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                [theme.breakpoints.up('lg')]: {
                    left: theme.sidebar?.width || '252px',
                    width: `calc(100% - ${theme.sidebar?.width || '252px'})`,
                },
            }}
        >
            <PageHeader heading={title} children={statusArea} />
            <Box
                sx={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    p: 2,
                    overflow: 'hidden',
                }}
            >
                <Box
                    sx={{
                        flex: 1,
                        minHeight: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        backgroundColor: 'background.paper',
                        borderRadius: 2,
                        overflow: 'hidden',
                        boxShadow: 3,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}
                >
                    <Preview3D
                        modelUrl={modelUrl}
                        showList={true}
                        showControls={true}
                        enableAutoColorAnimation={enableAutoColorAnimation}
                        enableColorPicker={true}
                    />
                </Box>
            </Box>
        </Box>
    );
};

