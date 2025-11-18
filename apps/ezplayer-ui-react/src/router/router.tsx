import { Navigate, RouteObject } from 'react-router-dom';
import { ShowStatusScreen, SidebarLayout, Routes as ROUTES } from '@ezplayer/player-ui-components';

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
        ],
    },
];

export default routes;

