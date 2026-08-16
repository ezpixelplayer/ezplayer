import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { MemoryRouter } from 'react-router-dom';
import 'nprogress/nprogress.css';
import App from './App';
import { SidebarProvider, PageHeaderLogoProvider } from '@ezplayer/shared-ui-components';
import 'react-toastify/dist/ReactToastify.css';
import { WELCOME_ROUTE } from './modules/Welcome/WelcomeScreen';

import { initI18N } from '@ezplayer/player-ui-components';
import ezplayerLogo from './assets/images/EZPlayerLogoTransparent128.png';

initI18N();

// Forward uncaught renderer errors (incl. exceptions thrown during React
// render — the classic white screen) to main's diagnostics reporter, which
// applies the consent gate and upload throttle. Dedupe locally so a render
// loop re-throwing the same error doesn't spam IPC.
let lastReportedError = '';
let lastReportedAt = 0;
const forwardRendererError = (message: string, stack?: string) => {
    const now = Date.now();
    if (message === lastReportedError && now - lastReportedAt < 30_000) return;
    lastReportedError = message;
    lastReportedAt = now;
    void window.electronAPI?.reportRendererError?.(message, stack);
};
window.addEventListener('error', (e) => {
    forwardRendererError(String(e.message ?? 'unknown error'), (e.error as Error | undefined)?.stack);
});
window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason as { message?: string; stack?: string } | undefined;
    forwardRendererError(String(reason?.message ?? reason ?? 'unhandled rejection'), reason?.stack);
});

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
