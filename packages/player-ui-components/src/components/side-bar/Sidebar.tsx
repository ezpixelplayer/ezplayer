import { ReactNode, useContext } from 'react';
import { Scrollbar } from '@ezplayer/shared-ui-components';
import { SidebarContext } from '@ezplayer/shared-ui-components';
import { Drawer, Divider, useTheme, useMediaQuery, Stack } from '@mui/material';
import { Box } from '../box/Box';

import { SidebarMenu } from './sidebar-menu/SidebarMenu';
import type { MenuRoute } from '../../types/menuRoute';

type SidebarProps = {
    logo?: ReactNode;
    menuItems: MenuRoute[];
};

export const Sidebar = ({ logo, menuItems }: SidebarProps) => {
    const { sidebarToggle, closeSidebar } = useContext(SidebarContext);
    const theme = useTheme();
    const isLg = useMediaQuery(theme.breakpoints.up('lg'));
    const handleClose = () => {
        const activeElement = document.activeElement as HTMLElement | null;
        activeElement?.blur?.();
        closeSidebar();
    };
    const classes = isLg ? 'large SidebarWrapper ' : 'small SidebarWrapper';
    const wrapperclass = theme.palette.mode === 'dark' ? 'sidebarwrapperDark' : 'sidebarwrapperLight';
    const finalclass = `${classes} ${wrapperclass}`;
    return (
        <>
            <Box className={finalclass}>
                <Scrollbar>
                    {logo && (
                        <>
                            <Box mt={3}>
                                <Stack direction="row" spacing={2}>
                                    <Box mx={2} className="w-20">
                                        {logo}
                                    </Box>
                                    <Box mx={2} className="w-20"></Box>
                                </Stack>
                            </Box>
                            <Divider
                                className="sidebarDividerbg"
                                sx={{
                                    mt: theme.spacing(3),
                                    mx: theme.spacing(2),
                                }}
                            />
                        </>
                    )}
                    <SidebarMenu menuItems={menuItems} />
                </Scrollbar>
            </Box>
            <Drawer
                className="sidebarDrawer"
                anchor={theme.direction === 'rtl' ? 'right' : 'left'}
                open={sidebarToggle}
                onClose={handleClose}
                variant="temporary"
                elevation={9}
                keepMounted={false}
                disableRestoreFocus
            >
                <Box
                    className={
                        theme.palette.mode === 'dark'
                            ? 'SidebarWrapperDarkTheme SidebarWrapper'
                            : 'SidebarWrapperlightTheme SidebarWrapper'
                    }
                >
                    <Scrollbar>
                        {logo && (
                            <>
                                <Box mt={3}>
                                    <Box mx={2} className="w-20">
                                        {logo}
                                    </Box>
                                </Box>
                                <Divider
                                    sx={{
                                        mt: theme.spacing(3),
                                        mx: theme.spacing(2),
                                    }}
                                    className="sidebarDividerbg"
                                />
                            </>
                        )}
                        <SidebarMenu menuItems={menuItems} />
                    </Scrollbar>
                </Box>
            </Drawer>
        </>
    );
};
