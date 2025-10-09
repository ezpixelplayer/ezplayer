import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import 'nprogress/nprogress.css';
import App from './App';
import { SidebarProvider } from '@ezplayer/shared-ui-components';
import 'react-toastify/dist/ReactToastify.css';

import { initI18N } from '@ezplayer/player-ui-components';

initI18N();

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <HelmetProvider>
        <SidebarProvider>
            <MemoryRouter>
                <App />
            </MemoryRouter>
        </SidebarProvider>
    </HelmetProvider>,
);
