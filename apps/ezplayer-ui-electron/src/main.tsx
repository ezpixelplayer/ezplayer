import { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import 'nprogress/nprogress.css';
import App from './App';
import { SidebarProvider, PageHeaderLogoProvider } from '@ezplayer/shared-ui-components';
import 'react-toastify/dist/ReactToastify.css';
import { WELCOME_ROUTE } from './modules/Welcome/WelcomeScreen';
import { RootErrorBoundary } from './components/RootErrorBoundary';

import { initI18N, setUiErrorReporter } from '@ezplayer/player-ui-components';
import ezplayerLogo from './assets/images/EZPlayerLogoTransparent128.png';

initI18N();

// Boundaries report via the early listener in index.html.
setUiErrorReporter((message, stack) => window.__ezpReportError?.(message, stack));

/** Tells main the app has mounted; main's watchdog reports a window that never gets here. */
function ReadySignal() {
    useEffect(() => {
        window.electronAPI?.rendererReady?.();
    }, []);
    return null;
}

const headerLogo = <img src={ezplayerLogo} alt="EZPlayer" style={{ height: 28, width: 28, flexShrink: 0 }} />;
const initialRoute = window.electronAPI?.shouldShowWelcomeOnLaunch?.() ? WELCOME_ROUTE : '/';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <RootErrorBoundary>
        <HelmetProvider>
            <SidebarProvider>
                <PageHeaderLogoProvider logo={headerLogo}>
                    <MemoryRouter initialEntries={[initialRoute]}>
                        <App />
                    </MemoryRouter>
                </PageHeaderLogoProvider>
            </SidebarProvider>
        </HelmetProvider>
        <ReadySignal />
    </RootErrorBoundary>,
);
