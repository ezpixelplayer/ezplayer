import React from 'react';
import { useSelector } from 'react-redux';
import { Box } from '../box/Box';
import { PageHeader, ExtendedTheme } from '@ezplayer/shared-ui-components';
import { useTheme } from '@mui/material';
import { Preview3D } from './Preview3D';
import { useFrameServerUrl } from '../../hooks/useFrameServerUrl';
import { useFrameBuffer } from '../../hooks/useFrameBuffer';
import type { RootState } from '../../store/Store';

/** Isolated from home sequence modal and default `previewSettings`; stores Preview dropdown + per-group camera/mode. */
export const PREVIEW_3D_PAGE_STORAGE_KEY = 'previewSettings3DPreview';

export interface Preview3DPageProps {
    title: string;
    statusArea: React.ReactNode[];
    compressed?: boolean;
}

export const Preview3DPage: React.FC<Preview3DPageProps> = ({ title, statusArea, compressed = false }) => {
    const theme = useTheme<ExtendedTheme>();
    const showDirectory = useSelector((state: RootState) => state.auth.showDirectory);

    const { url } = useFrameServerUrl();
    const { buffer: liveData } = useFrameBuffer({
        baseUrl: url,
        enabled: !!url,
        compressed,
        resetKey: showDirectory,
    });

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
                        showList={true}
                        showControls={true}
                        frameServerUrl={url}
                        liveData={liveData}
                        compact={compressed}
                        previewSettingsStorageKey={PREVIEW_3D_PAGE_STORAGE_KEY}
                        defaultViewMode="3d"
                    />
                </Box>
            </Box>
        </Box>
    );
};
