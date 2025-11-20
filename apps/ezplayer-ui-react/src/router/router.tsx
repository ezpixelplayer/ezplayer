import { Navigate, RouteObject } from 'react-router-dom';
import { ShowStatusScreen, SidebarLayout, Routes as ROUTES, JukeboxScreen, SongList, PlaylistList, PlayerScreen, SchedulePreview, Schedule, CreateEditPlaylist, PlaybackSettingsDrawer } from '@ezplayer/player-ui-components';
import { AddSongDialogElectron } from '../../../ezplayer-ui-electron/src/components/song/AddSongDialogElectron';

const getStatusArea = () => [];

const routes: RouteObject[] = [
    {
        path: '',
        element: <SidebarLayout hideLocal={false} hideCloud={true} hidePlayer={false} />,
        children: [
            {
                index: true,
                element: <Navigate to={ROUTES.SHOWSTATUS} replace />,
            },
            {
                path: ROUTES.SHOWSTATUS,
                element: <ShowStatusScreen title="Show Status" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.JUKEBOXSCR,
                element: <JukeboxScreen title="Jukebox" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.SONGS,
                element: <SongList title="Songs" AddSongDialog={AddSongDialogElectron} statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.PLAYLIST,
                element: <PlaylistList title="Playlists" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.SCHEDULE,
                element: <Schedule title="Schedule" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.BACKGROUND_SCHEDULE,
                element: (
                    <Schedule title="Background Schedule" statusArea={getStatusArea()} scheduleType="background" />
                ),
            },
            {
                path: ROUTES.SCHEDULE_PREVIEW,
                element: <SchedulePreview title="Schedule Preview" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.PLAYER,
                element: <PlayerScreen title="Player" statusArea={getStatusArea()} />,
            },
            {
                path: `${ROUTES.CREATE_EDIT_PLAYLIST}/:id`,
                element: <CreateEditPlaylist title="unused" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.PLAYBACKSETTINGS,
                element: <PlaybackSettingsDrawer title="Playback Settings" statusArea={getStatusArea()} />,
            },
        ],
    },
];

export default routes;

