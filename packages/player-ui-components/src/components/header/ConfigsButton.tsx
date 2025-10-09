import React, { useState } from 'react';
import { Box, IconButton, Menu, Divider, ListItemText, FormControl, SelectChangeEvent } from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import { ezrgbThemeOptions, useThemeContext } from '../../theme/ThemeBase';
import { Select } from '@ezplayer/shared-ui-components';

export const ConfigsButton = () => {
    const { themeName, handleThemeChange } = useThemeContext();
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const open = Boolean(anchorEl);

    const handleClick = (event: React.MouseEvent<HTMLElement>) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleSwitchChange = (event: SelectChangeEvent<unknown>) => {
        const currentTheme = event.target.value as string;
        handleThemeChange(currentTheme);
        handleClose();
    };

    return (
        <Box className="configsButton">
            {/* Settings Button */}
            <IconButton onClick={handleClick} sx={{ color: 'black' }}>
                <SettingsIcon />
            </IconButton>

            {/* Dropdown Menu */}
            <Menu
                anchorEl={anchorEl}
                id="setting-menu"
                open={open}
                onClose={handleClose}
                transformOrigin={{ horizontal: 'right', vertical: 'top' }}
                anchorOrigin={{ horizontal: 'right', vertical: 'top' }}
            >
                <ListItemText sx={{ padding: '15px' }}>Global Settings</ListItemText>
                <Divider />
                {/* This code is commented beacuse in future if we want to change the theme on switch button */}
                {/* <MenuItem>
          Light / Dark
          <ListItemIcon>
            <Switch checked={themeChange} onChange={handleSwitchChange} />
          </ListItemIcon>
        </MenuItem> */}
                {/* Theme Selector */}
                <FormControl sx={{ m: 2, minWidth: 120 }} size="small">
                    <Select
                        options={ezrgbThemeOptions}
                        itemText="id"
                        itemValue="name"
                        onChange={(e) => handleSwitchChange(e as SelectChangeEvent<string>)}
                        label="select theme"
                        value={themeName}
                    />
                </FormControl>
            </Menu>
        </Box>
    );
};
