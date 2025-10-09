import { ReactNode, useContext } from 'react';
import { Scrollbar } from '@ezplayer/shared-ui-components';
import { SidebarContext } from '@ezplayer/shared-ui-components';
import { Box, Drawer, Divider, useTheme, useMediaQuery, Stack } from '@mui/material';

import { SidebarMenu } from './sidebar-menu/SidebarMenu';

type SidebarProps = {
    logo?: ReactNode;
    hidePlayer: boolean;
    hideCloud: boolean;
    hideLocal: boolean;
};

export const Sidebar = ({ logo, hideCloud, hideLocal, hidePlayer }: SidebarProps) => {
    const { sidebarToggle, toggleSidebar } = useContext(SidebarContext);
    const theme = useTheme();
    const isLg = useMediaQuery(theme.breakpoints.up('lg'));
    const closeSidebar = () => toggleSidebar();
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
                    <SidebarMenu hideCloud={hideCloud} hideLocal={hideLocal} hidePlayer={hidePlayer} />
                </Scrollbar>
            </Box>
            <Drawer
                className="sidebarDrawer"
                anchor={theme.direction === 'rtl' ? 'right' : 'left'}
                open={sidebarToggle}
                onClose={closeSidebar}
                variant="temporary"
                elevation={9}
                keepMounted={false}
                disablePortal
                disableEnforceFocus
                disableRestoreFocus
                hideBackdrop={!sidebarToggle}
                ModalProps={{
                    keepMounted: false,
                    disableScrollLock: !sidebarToggle,
                }}
                PaperProps={{
                    sx: {
                        visibility: sidebarToggle ? 'visible' : 'hidden',
                    },
                }}
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
                        <SidebarMenu hideCloud={hideCloud} hideLocal={hideLocal} hidePlayer={hidePlayer} />
                    </Scrollbar>
                </Box>
            </Drawer>
        </>
    );
};
