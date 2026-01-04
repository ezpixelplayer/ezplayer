// import { useContext } from 'react';
import {
    Box as MuiBox,
    Stack,
    Divider,
    // IconButton,
    // Tooltip,
    useTheme,
} from '@mui/material';
import {
    Box
} from '../box/Box'
// import MenuTwoToneIcon from '@mui/icons-material/MenuTwoTone';
// import { SidebarContext } from '@ezplayer/shared-ui-components';
// import CloseTwoToneIcon from '@mui/icons-material/CloseTwoTone';

export const Header = () => {
    // const { sidebarToggle, toggleSidebar } = useContext(SidebarContext);
    const theme = useTheme();
    return (
        <Box
            className={
                theme.palette.mode === 'dark'
                    ? 'HeaderWrapperDarkTheme HeaderWrapper'
                    : 'HeaderWrapperLightTheme HeaderWrapper'
            }
            display="flex"
            alignItems="center"
        >
            <Stack
                direction="row"
                divider={<Divider orientation="vertical" flexItem />}
                alignItems="center"
                spacing={2}
            ></Stack>
            <Box display="flex" alignItems="center">
                <MuiBox
                    component="span"
                    sx={{
                        ml: 2,
                    }}
                    className="userbox"
                >
                    {/* <Tooltip arrow title="Toggle Menu"> */}
                    {/* <IconButton color="primary" onClick={toggleSidebar}>
            {!sidebarToggle ? (
              <MenuTwoToneIcon fontSize="small" />
            ) : (
              <CloseTwoToneIcon fontSize="small" />
            )}
          </IconButton> */}
                    {/* </Tooltip> */}
                </MuiBox>
            </Box>
        </Box>
    );
};
