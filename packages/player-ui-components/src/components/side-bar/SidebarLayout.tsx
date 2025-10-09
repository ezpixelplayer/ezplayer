import { FC, ReactNode } from 'react';
import { Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { ExtendedTheme } from '@ezplayer/shared-ui-components';
import { Outlet } from 'react-router-dom';
// import { Header } from '../..';
import { Sidebar } from './Sidebar';

interface SidebarLayoutProps {
    children?: ReactNode;
    logo?: ReactNode;
    hideCloud: boolean;
    hideLocal: boolean;
    hidePlayer: boolean;
}

export const SidebarLayout: FC<SidebarLayoutProps> = ({
    logo,
    hideCloud,
    hideLocal,
    hidePlayer,
}: SidebarLayoutProps) => {
    const theme = useTheme<ExtendedTheme>();

    return (
        <>
            <Box
                className={
                    theme.palette.error.main === 'dark'
                        ? 'layoutbox MuiPageTitlewrapperDark '
                        : 'layoutbox MuiPageTitlewrapperLight '
                }
            >
                {/* <Header /> */}
                <Sidebar logo={logo} hideCloud={hideCloud} hideLocal={hideLocal} hidePlayer={hidePlayer} />
                <Box
                    className="layout"
                    sx={{
                        //pt: `${theme.header.height}`,
                        pt: `${0}`,
                        [theme.breakpoints.up('lg')]: {
                            ml: theme.sidebar?.width || '252px',
                        },
                    }}
                >
                    <Box display="block">
                        <Outlet />
                    </Box>
                </Box>
            </Box>
        </>
    );
};
