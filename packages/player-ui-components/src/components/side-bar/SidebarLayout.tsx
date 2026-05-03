import { FC, ReactNode } from 'react';
import { Box } from '../box/Box';
import { useTheme } from '@mui/material/styles';
import { ExtendedTheme } from '@ezplayer/shared-ui-components';
import { Outlet } from 'react-router-dom';
// import { Header } from '../..';
import { Sidebar } from './Sidebar';
import type { MenuRoute } from '../../types/menuRoute';

interface SidebarLayoutProps {
    children?: ReactNode;
    logo?: ReactNode;
    menuItems: MenuRoute[];
}

export const SidebarLayout: FC<SidebarLayoutProps> = ({ logo, menuItems }: SidebarLayoutProps) => {
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
                <Sidebar logo={logo} menuItems={menuItems} />
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
