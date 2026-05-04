import { Navigate, RouteObject } from 'react-router-dom';
import { useState } from 'react';
import {
    AudioSettings,
    CloudPage,
    JukeboxSettings,
    PlayerCloudRegistrationDialog,
    PlayerSettings,
    ShowStatusScreen,
    SidebarLayout,
    Routes as ROUTES,
    JukeboxScreen,
    SongList,
    PlaylistList,
    PlayerScreen,
    Schedule,
    CreateEditPlaylist,
    SettingsDrawer,
    Preview3DPage,
    UISettings,
    ViewerSettings,
    toRouteChildren,
} from '@ezplayer/player-ui-components';
import type { MenuRoute, SettingsSection } from '@ezplayer/player-ui-components';

import TableChartTwoToneIcon from '@mui/icons-material/TableChartTwoTone';
import PlayArrow from '@mui/icons-material/PlayArrow';
import InfoRounded from '@mui/icons-material/InfoRounded';
import ListTwoToneIcon from '@mui/icons-material/ListTwoTone';
import MusicIcon from '@mui/icons-material/MusicNoteTwoTone';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import DisplaySettingsIcon from '@mui/icons-material/DisplaySettings';
import CloudIcon from '@mui/icons-material/Cloud';
import ContrastIcon from '@mui/icons-material/Contrast';
import LanguageIcon from '@mui/icons-material/Language';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import TuneIcon from '@mui/icons-material/Tune';

import { AddSongDialogElectron } from '../../../ezplayer-ui-electron/src/components/song/AddSongDialogElectron';

const isKiosk = (window as any).__EZPLAYER_MODE__ === 'kiosk';

/** Routes excluded in kiosk mode. */
const KIOSK_HIDDEN_ROUTES = new Set<string>([
    ROUTES.SONGS,
    ROUTES.PLAYLIST,
    ROUTES.SCHEDULE,
    ROUTES.PLAYBACKSETTINGS,
    ROUTES.CLOUD,
]);

const getStatusArea = () => [];

const EmbeddedSettingsPage = () => {
    const [cloudOpen, setCloudOpen] = useState(false);
    // Embedded is a browser; show-folder selection isn't possible here.
    const sections: SettingsSection[] = [
        {
            key: 'ui',
            label: 'UI',
            icon: <ContrastIcon sx={{ fontSize: 56 }} />,
            content: <UISettings />,
        },
        {
            key: 'viewer',
            label: 'Viewer',
            icon: <LanguageIcon sx={{ fontSize: 56 }} />,
            title: 'Viewer Control',
            content: <ViewerSettings />,
        },
        {
            key: 'jukebox',
            label: 'Jukebox',
            icon: <PlayArrow sx={{ fontSize: 56 }} />,
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

const allMenuRoutes: MenuRoute[] = [
    {
        path: ROUTES.SHOWSTATUS,
        element: <ShowStatusScreen title="Show Status" statusArea={getStatusArea()} />,
        sidebar: { icon: <InfoRounded />, label: 'Show Status' },
    },
    {
        path: ROUTES.JUKEBOXSCR,
        element: <JukeboxScreen title="Jukebox" statusArea={getStatusArea()} />,
        sidebar: { icon: <PlayArrow />, label: 'Jukebox' },
    },
    {
        path: ROUTES.SONGS,
        element: (
            <SongList
                title="Songs"
                AddSongDialog={AddSongDialogElectron}
                statusArea={getStatusArea()}
                showEditAction={false}
                showDeleteAction={!isKiosk}
                showAddSongButton={false}
            />
        ),
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
        path: ROUTES.PLAYER,
        element: <PlayerScreen title="Player" statusArea={getStatusArea()} />,
        sidebar: { icon: <TableChartTwoToneIcon />, label: 'Player' },
    },
    {
        path: ROUTES.PREVIEW_3D,
        element: <Preview3DPage title="3D Preview" statusArea={getStatusArea()} compressed />,
        sidebar: { icon: <ViewInArIcon />, label: '3D Preview' },
    },
    {
        path: ROUTES.CLOUD,
        element: <CloudPage title="Cloud" statusArea={getStatusArea()} />,
        sidebar: { icon: <CloudIcon />, label: 'Cloud' },
    },
    {
        path: ROUTES.PLAYBACKSETTINGS,
        element: <EmbeddedSettingsPage />,
        sidebar: { icon: <DisplaySettingsIcon />, label: 'Settings' },
    },
    {
        path: `${ROUTES.CREATE_EDIT_PLAYLIST}/:id`,
        element: <CreateEditPlaylist title="unused" statusArea={getStatusArea()} />,
    },
];

const menuRoutes: MenuRoute[] = isKiosk
    ? allMenuRoutes.filter((r) => !KIOSK_HIDDEN_ROUTES.has(r.path))
    : allMenuRoutes;

const routes: RouteObject[] = [
    {
        path: '',
        element: <SidebarLayout menuItems={menuRoutes} />,
        children: [
            {
                index: true,
                element: <Navigate to={ROUTES.SHOWSTATUS} replace />,
            },
            ...toRouteChildren(menuRoutes),
        ],
    },
];

export default routes;
