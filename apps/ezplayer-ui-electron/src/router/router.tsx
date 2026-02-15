import React, { ComponentType, Suspense, lazy } from 'react';
import { Navigate, RouteObject } from 'react-router';

import { SuspenseLoader } from '@ezplayer/shared-ui-components';

import {
    CreateEditPlaylist,
    JukeboxScreen,
    JukeboxFullScreen,
    PlayerScreen,
    PlaylistList,
    Routes as ROUTES,
    Schedule,
    SidebarLayout,
    SongList,
    ShowStatusScreen,
    PlaybackSettingsDrawer,
    SchedulePreview,
    Preview3DPage,
} from '@ezplayer/player-ui-components';

import { AddSongDialogElectron } from '../components/song/AddSongDialogElectron';

const ERROR_PAGE = import('../modules/ErrorPage/ErrorPage');

const Loader =
    <P extends object>(Component: ComponentType<P>) =>
    (props: P) => (
        <Suspense fallback={<SuspenseLoader />}>
            <Component {...props} />
        </Suspense>
    );

// Pages
const ErrorPage = Loader(lazy(() => ERROR_PAGE));

//const getStatusArea = ()=>[<ConnectivityStatus key="connectivity-status" />];
const getStatusArea = () => [];

const routes: RouteObject[] = [
    {
        path: '',
        element: <SidebarLayout hideLocal={false} hideCloud={true} hidePlayer={false} /*logo={<Logo />}*/ />,
        children: [
            {
                index: true, // This makes it the default child route
                element: <Navigate to={ROUTES.PLAYER} replace />, // Redirect to /songs
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
                path: ROUTES.JUKEBOXSCR,
                element: <JukeboxScreen title="Jukebox" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.SHOWSTATUS,
                element: <ShowStatusScreen title="Show Status" statusArea={getStatusArea()} />,
            },
            {
                path: `${ROUTES.CREATE_EDIT_PLAYLIST}/:id`,
                element: <CreateEditPlaylist title="unused" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.PLAYBACKSETTINGS,
                element: <PlaybackSettingsDrawer title="Playback Settings" statusArea={getStatusArea()} />,
            },
            {
                path: ROUTES.PREVIEW_3D,
                element: <Preview3DPage title="3D Preview" statusArea={getStatusArea()} />,
            },
        ],
    },

    // Special Fullscreen Jukebox Route (No Sidebar)
    {
        path: ROUTES.JUKEBOXSA,
        element: <JukeboxFullScreen />, // This will be the fullscreen view
    },

    {
        path: ROUTES.ERROR_PAGE,
        element: <ErrorPage />,
    },
];

export default routes;
