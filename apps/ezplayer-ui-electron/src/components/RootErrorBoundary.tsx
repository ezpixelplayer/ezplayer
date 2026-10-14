import React, { type ErrorInfo } from 'react';
import { reportUiError } from '@ezplayer/player-ui-components';

interface State {
    error: Error | null;
}

/**
 * Last-resort boundary: an error that escapes every other boundary would
 * otherwise unmount the whole app and leave a blank window. Plain styles, since
 * the theme may be what failed.
 */
export class RootErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
    state: State = { error: null };

    static getDerivedStateFromError(error: Error): State {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[RootErrorBoundary]', error, info.componentStack);
        reportUiError('RootErrorBoundary', error, info.componentStack);
        // The window is up and showing this panel, so main's not-ready watchdog has nothing to add.
        window.electronAPI?.rendererReady?.();
    }

    render() {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div
                style={{ padding: 24, fontFamily: 'sans-serif', color: '#222', background: '#fff', minHeight: '100vh' }}
            >
                <h2 style={{ marginTop: 0 }}>EZPlayer hit an error</h2>
                <p>
                    The window could not be drawn. Playback is not affected; reloading the window may recover it. The
                    error has been written to the log.
                </p>
                <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f4f4', padding: 12 }}>{error.message}</pre>
                <button onClick={() => window.location.reload()}>Reload</button>
            </div>
        );
    }
}
