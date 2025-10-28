import { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { ListSubheader, Box, List, Button, ListItem } from '@mui/material';
import { NavLink as RouterLink } from 'react-router-dom';
import { SidebarContext } from '../../providers/SidebarContext';

interface sidebarmenuprops {
    menuname: string;
    option: sidebarprop[];
}

export interface sidebarprop {
    pathname: string;
    subpathname: string;
    icon: JSX.Element;
    submenuname: string;
}
export const SidebarMenus = ({ menuname, option }: sidebarmenuprops) => {
    const { closeSidebar, sidebarToggle } = useContext(SidebarContext);
    const { i18n: _i18n, t } = useTranslation('sidebarmenu');
    return (
        <>
            <Box className="MenuWrapper ">
                <List
                    component="div"
                    subheader={
                        <ListSubheader component="div" disableSticky>
                            {t(menuname)}
                        </ListSubheader>
                    }
                >
                    <Box className="SubMenuWrapper">
                        <List component="div">
                            {option.map((item) => {
                                return (
                                    <ListItem component="div" key={`${item.pathname}${item.subpathname}`}>
                                        <Button
                                            disableRipple
                                            component={RouterLink}
                                            // onClick={closeSidebar}
                                            onClick={(e) => {
                                                e.currentTarget.blur();
                                                closeSidebar();
                                            }}
                                            to={`${item.pathname}${item.subpathname}`}
                                            startIcon={item.icon}
                                            tabIndex={sidebarToggle ? 0 : -1}
                                        >
                                            {t(item.submenuname)}
                                        </Button>
                                    </ListItem>
                                );
                            })}
                        </List>
                    </Box>
                </List>
            </Box>
        </>
    );
};
