import React, { ComponentType, Suspense, lazy } from 'react';
import { Navigate, RouteObject } from 'react-router';

import { SuspenseLoader } from '@ezplayer/shared-ui-components';

import {
    AudioSettings,
    CloudPage,
    CreateEditPlaylist,
    JukeboxScreen,
    JukeboxFullScreen,
    JukeboxSettings,
    PlayerCloudRegistrationDialog,
    PlayerScreen,
    PlayerSettings,
    PlaylistList,
    Routes as ROUTES,
    Schedule,
    SidebarLayout,
    SongList,
    ShowFolderSettings,
    ShowStatusScreen,
    SettingsDrawer,
    Preview3DPage,
    UISettings,
    ViewerSettings,
    toRouteChildren,
} from '@ezplayer/player-ui-components';
import type { MenuRoute, SettingsSection } from '@ezplayer/player-ui-components';
import { useState } from 'react';

import TableChartTwoToneIcon from '@mui/icons-material/TableChartTwoTone';
import PlayArrow from '@mui/icons-material/PlayArrow';
import InfoRounded from '@mui/icons-material/InfoRounded';
import ListTwoToneIcon from '@mui/icons-material/ListTwoTone';
import MusicIcon from '@mui/icons-material/MusicNoteTwoTone';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import DisplaySettingsIcon from '@mui/icons-material/DisplaySettings';
import CloudIcon from '@mui/icons-material/Cloud';
import FolderIcon from '@mui/icons-material/Folder';
import ContrastIcon from '@mui/icons-material/Contrast';
import VisibilityIcon from '@mui/icons-material/Visibility';
import LibraryMusicIcon from '@mui/icons-material/LibraryMusic';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import TuneIcon from '@mui/icons-material/Tune';

import { AddSongDialogElectron } from '../components/song/AddSongDialogElectron';
import { WelcomeScreen, WELCOME_ROUTE } from '../modules/Welcome/WelcomeScreen';

const ERROR_PAGE = import('../modules/ErrorPage/ErrorPage');

const Loader =
    <P extends object>(Component: ComponentType<P>) =>
    (props: P) => (
        <Suspense fallback={<SuspenseLoader />}>
            <Component {...props} />
        </Suspense>
    );

const ErrorPage = Loader(lazy(() => ERROR_PAGE));

//const getStatusArea = ()=>[<ConnectivityStatus key="connectivity-status" />];
const getStatusArea = () => [];

const ElectronSettingsPage = () => {
    const [cloudOpen, setCloudOpen] = useState(false);
    const sections: SettingsSection[] = [
        {
            key: 'showFolder',
            label: 'Show Folder',
            icon: <FolderIcon sx={{ fontSize: 56 }} />,
            content: <ShowFolderSettings />,
        },
        {
            key: 'ui',
            label: 'UI',
            icon: <ContrastIcon sx={{ fontSize: 56 }} />,
            content: <UISettings />,
        },
        {
            key: 'viewer',
            label: 'Viewer Control',
            icon: <VisibilityIcon sx={{ fontSize: 56 }} />,
            title: 'Viewer Control',
            content: <ViewerSettings />,
        },
        {
            key: 'jukebox',
            label: 'Jukebox',
            icon: <LibraryMusicIcon sx={{ fontSize: 56 }} />,
            content: <JukeboxSettings />,
        },
        {
            key: 'audio',
            label: 'Audio',
            icon: <VolumeUpIcon sx={{ fontSize: 56 }} />,
            content: <AudioSettings />,
        },
        {
            key: 'cloud',
            label: 'Cloud',
            icon: <CloudIcon sx={{ fontSize: 56 }} />,
            onClick: () => setCloudOpen(true),
        },
        {
            key: 'player',
            label: 'Player',
            icon: <TuneIcon sx={{ fontSize: 56 }} />,
            title: 'Player Settings',
            content: <PlayerSettings />,
        },
    ];
    return (
        <>
            <SettingsDrawer title="Settings" statusArea={getStatusArea()} sections={sections} />
            <PlayerCloudRegistrationDialog open={cloudOpen} onClose={() => setCloudOpen(false)} />
        </>
    );
};

const menuRoutes: MenuRoute[] = [
    {
        path: ROUTES.PLAYER,
        element: <PlayerScreen title="Player" statusArea={getStatusArea()} />,
        sidebar: { icon: <TableChartTwoToneIcon />, label: 'Player' },
    },
    {
        path: ROUTES.SONGS,
        element: <SongList title="Songs" AddSongDialog={AddSongDialogElectron} statusArea={getStatusArea()} />,
        sidebar: { icon: <MusicIcon />, label: 'Songs' },
    },
    {
        path: ROUTES.PLAYLIST,
        element: <PlaylistList title="Playlists" statusArea={getStatusArea()} />,
        sidebar: { icon: <ListTwoToneIcon />, label: 'Playlists' },
    },
    {
        path: ROUTES.SCHEDULE,
        element: <Schedule title="Schedule" statusArea={getStatusArea()} />,
        sidebar: { icon: <TableChartTwoToneIcon />, label: 'Schedule' },
    },
    {
        path: ROUTES.JUKEBOXSCR,
        element: <JukeboxScreen title="Jukebox" statusArea={getStatusArea()} />,
        sidebar: { icon: <PlayArrow />, label: 'Jukebox' },
    },
    {
        path: ROUTES.SHOWSTATUS,
        element: <ShowStatusScreen title="Show Status" statusArea={getStatusArea()} />,
        sidebar: { icon: <InfoRounded />, label: 'Show Status' },
    },
    {
        path: ROUTES.PREVIEW_3D,
        element: <Preview3DPage title="3D Preview" statusArea={getStatusArea()} />,
        sidebar: { icon: <ViewInArIcon />, label: '3D Preview' },
    },
    {
        path: ROUTES.CLOUD,
        element: <CloudPage title="Cloud" statusArea={getStatusArea()} />,
        sidebar: { icon: <CloudIcon />, label: 'Cloud' },
    },
    {
        path: ROUTES.PLAYBACKSETTINGS,
        element: <ElectronSettingsPage />,
        sidebar: { icon: <DisplaySettingsIcon />, label: 'Settings' },
    },
    {
        path: `${ROUTES.CREATE_EDIT_PLAYLIST}/:id`,
        element: <CreateEditPlaylist title="unused" statusArea={getStatusArea()} />,
    },
];

const routes: RouteObject[] = [
    {
        path: WELCOME_ROUTE,
        element: <WelcomeScreen />,
    },
    {
        path: '',
        element: <SidebarLayout menuItems={menuRoutes} />,
        children: [
            {
                index: true,
                element: <Navigate to={ROUTES.PLAYER} replace />,
            },
            ...toRouteChildren(menuRoutes),
        ],
    },
    {
        path: ROUTES.JUKEBOXSA,
        element: <JukeboxFullScreen />,
    },
    {
        path: ROUTES.ERROR_PAGE,
        element: <ErrorPage />,
    },
];

export default routes;
