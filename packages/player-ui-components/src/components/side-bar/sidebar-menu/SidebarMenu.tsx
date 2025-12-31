import TableChartTwoToneIcon from '@mui/icons-material/TableChartTwoTone';
import PlayArrow from '@mui/icons-material/PlayArrow';
import InfoRounded from '@mui/icons-material/InfoRounded';
import ListTwoToneIcon from '@mui/icons-material/ListTwoTone';
import MusicIcon from '@mui/icons-material/MusicNoteTwoTone';
import HomeIcon from '@mui/icons-material/Home';
import SettingsIcon from '@mui/icons-material/Settings';
import BrushIcon from '@mui/icons-material/Brush';
import PreviewIcon from '@mui/icons-material/Preview';
import { SidebarMenus } from '@ezplayer/shared-ui-components';
import { Routes as ROUTES } from '../../..';
import DisplaySettingsIcon from '@mui/icons-material/DisplaySettings';
import PaletteIcon from '@mui/icons-material/Palette';
import React from 'react';
//import { useSelector } from 'react-redux';
//import { RootState } from "../../../../src/store/configure-store";

export const SidebarMenu = (props: { hidePlayer: boolean; hideCloud: boolean; hideLocal: boolean }) => {
    //const userData = useSelector((state: RootState) => state.userData);

    return (
        <>
            <SidebarMenus
                menuname={''}
                option={[
                    ...(props.hideCloud
                        ? []
                        : [
                            {
                                pathname: ROUTES.HOME,
                                subpathname: '',
                                icon: <HomeIcon />,
                                submenuname: 'Home',
                            },
                            {
                                pathname: ROUTES.SHOWSETTINGS,
                                subpathname: '',
                                icon: <SettingsIcon />,
                                submenuname: 'Show Settings',
                            },
                            {
                                pathname: ROUTES.LAYOUT_EDITOR,
                                subpathname: '',
                                icon: <BrushIcon />,
                                submenuname: 'Layout Editor',
                            },
                        ]),
                    ...(props.hidePlayer
                        ? []
                        : [
                            {
                                pathname: ROUTES.PLAYER,
                                subpathname: '',
                                icon: <TableChartTwoToneIcon />,
                                submenuname: 'Player',
                            },
                            {
                                pathname: ROUTES.SONGS,
                                subpathname: '',
                                icon: <MusicIcon />,
                                submenuname: 'Songs',
                            },
                            {
                                pathname: ROUTES.PLAYLIST,
                                subpathname: '',
                                icon: <ListTwoToneIcon />,
                                submenuname: 'Playlists',
                            },
                            {
                                pathname: ROUTES.SCHEDULE,
                                subpathname: '',
                                icon: <TableChartTwoToneIcon />,
                                submenuname: 'Schedule',
                            },
                            {
                                pathname: ROUTES.BACKGROUND_SCHEDULE,
                                subpathname: '',
                                icon: <TableChartTwoToneIcon />,
                                submenuname: 'Background Schedule',
                            },
                            {
                                pathname: ROUTES.SCHEDULE_PREVIEW,
                                subpathname: '',
                                icon: <PreviewIcon />,
                                submenuname: 'Schedule Preview',
                            },
                            {
                                pathname: ROUTES.JUKEBOXSCR,
                                subpathname: '',
                                icon: <PlayArrow />,
                                submenuname: 'Jukebox',
                            },
                            {
                                pathname: ROUTES.SHOWSTATUS,
                                subpathname: '',
                                icon: <InfoRounded />,
                                submenuname: 'Show Status',
                            },
                        ]),

                    ...(props.hideCloud
                        ? []
                        : [
                            {
                                pathname: ROUTES.CLOUDSETTINGS,
                                subpathname: '',
                                icon: <DisplaySettingsIcon />,
                                submenuname: 'Cloud Settings',
                            },
                        ]),
                    ...(props.hideLocal
                        ? []
                        : [
                            {
                                pathname: ROUTES.PLAYBACKSETTINGS,
                                subpathname: '',
                                icon: <DisplaySettingsIcon />,
                                submenuname: 'Playback Settings',
                            },
                            {
                                pathname: ROUTES.COLOR_PALETTE_TEST,
                                subpathname: '',
                                icon: <PaletteIcon />,
                                submenuname: 'Color Palette Test',
                            },
                        ]),
                ]}
            />
        </>
    );
};
