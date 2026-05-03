import { Navigate, RouteObject } from 'react-router-dom';
import {
    ShowStatusScreen,
    SidebarLayout,
    Routes as ROUTES,
    JukeboxScreen,
    SongList,
    PlaylistList,
    PlayerScreen,
    SchedulePreview,
    Schedule,
    CreateEditPlaylist,
    PlaybackSettingsDrawer,
    Preview3DPage,
    toRouteChildren,
} from '@ezplayer/player-ui-components';
import type { MenuRoute } from '@ezplayer/player-ui-components';

import TableChartTwoToneIcon from '@mui/icons-material/TableChartTwoTone';
import PlayArrow from '@mui/icons-material/PlayArrow';
import InfoRounded from '@mui/icons-material/InfoRounded';
import ListTwoToneIcon from '@mui/icons-material/ListTwoTone';
import MusicIcon from '@mui/icons-material/MusicNoteTwoTone';
import PreviewIcon from '@mui/icons-material/Preview';
import ViewInArIcon from '@mui/icons-material/ViewInAr';
import DisplaySettingsIcon from '@mui/icons-material/DisplaySettings';

import { AddSongDialogElectron } from '../../../ezplayer-ui-electron/src/components/song/AddSongDialogElectron';

const isKiosk = (window as any).__EZPLAYER_MODE__ === 'kiosk';

/** Routes excluded in kiosk mode. */
const KIOSK_HIDDEN_ROUTES = new Set<string>([
    ROUTES.SONGS,
    ROUTES.PLAYLIST,
    ROUTES.SCHEDULE,
    ROUTES.BACKGROUND_SCHEDULE,
    ROUTES.PLAYBACKSETTINGS,
]);

const getStatusArea = () => [];

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
        path: ROUTES.BACKGROUND_SCHEDULE,
        element: <Schedule title="Background Schedule" statusArea={getStatusArea()} scheduleType="background" />,
        sidebar: { icon: <TableChartTwoToneIcon />, label: 'Background Schedule' },
    },
    {
        path: ROUTES.SCHEDULE_PREVIEW,
        element: <SchedulePreview title="Schedule Preview" statusArea={getStatusArea()} />,
        sidebar: { icon: <PreviewIcon />, label: 'Schedule Preview' },
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
        path: ROUTES.PLAYBACKSETTINGS,
        element: <PlaybackSettingsDrawer title="Settings" statusArea={getStatusArea()} />,
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
