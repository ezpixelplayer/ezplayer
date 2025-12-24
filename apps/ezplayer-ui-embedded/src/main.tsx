import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { HelmetProvider } from 'react-helmet-async';
import { SidebarProvider } from '@ezplayer/shared-ui-components';
import { initI18N } from '@ezplayer/player-ui-components';
import 'nprogress/nprogress.css';
import 'react-toastify/dist/ReactToastify.css';
import App from './App';
import './index.css';

initI18N();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <HelmetProvider>
            <SidebarProvider>
                <BrowserRouter>
                    <App />
                </BrowserRouter>
            </SidebarProvider>
        </HelmetProvider>
    </React.StrictMode>,
);
