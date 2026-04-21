import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import 'nprogress/nprogress.css';
import App from './App';
import { SidebarProvider, PageHeaderLogoProvider } from '@ezplayer/shared-ui-components';
import 'react-toastify/dist/ReactToastify.css';
import { WELCOME_ROUTE } from './modules/Welcome/WelcomeScreen';

import { initI18N } from '@ezplayer/player-ui-components';

initI18N();

const ezplayerLogo = 'images/EZPlayerLogoTransparent128.png';
const headerLogo = <img src={ezplayerLogo} alt="EZPlayer" style={{ height: 28, width: 28, flexShrink: 0 }} />;
const initialRoute = window.electronAPI?.shouldShowWelcomeOnLaunch?.() ? WELCOME_ROUTE : '/';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <HelmetProvider>
        <SidebarProvider>
            <PageHeaderLogoProvider logo={headerLogo}>
                <MemoryRouter initialEntries={[initialRoute]}>
                    <App />
                </MemoryRouter>
            </PageHeaderLogoProvider>
        </SidebarProvider>
    </HelmetProvider>,
);
