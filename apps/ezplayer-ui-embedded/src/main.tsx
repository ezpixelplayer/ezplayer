import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { SidebarProvider, PageHeaderLogoProvider } from '@ezplayer/shared-ui-components';
import { initI18N } from '@ezplayer/player-ui-components';
import 'nprogress/nprogress.css';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import './index.css';
import ezplayerLogo from '../../ezplayer-ui-electron/src/assets/images/EZPlayerLogoTransparent128.png';

initI18N();

const headerLogo = <img src={ezplayerLogo} alt="EZPlayer" style={{ height: 28, width: 28, flexShrink: 0 }} />;

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <HelmetProvider>
            <SidebarProvider>
                <PageHeaderLogoProvider logo={headerLogo}>
                    <BrowserRouter>
                        <App />
                    </BrowserRouter>
                </PageHeaderLogoProvider>
            </SidebarProvider>
        </HelmetProvider>
    </React.StrictMode>,
);
