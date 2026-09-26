import React, { type ErrorInfo } from 'react';
import { Typography } from '@mui/material';
import { Box } from '../box/Box';

/**
 * WebGL availability probe + an error boundary for the preview viewers.
 *
 * Why this exists: three.js's `WebGLRenderer` constructor throws
 * "Error creating WebGL context." when Chromium refuses to hand out a
 * context (GPU on the software blocklist, ancient driver, `--disable-gpu`,
 * etc.). react-three-fiber builds that renderer inside a *layout* effect,
 * so the throw happens on the very first commit of `<Canvas>` — before any
 * `useEffect`-based check has run and before `onCreated` is ever called.
 * With no boundary above it, React 18 unmounts the whole root and the user
 * sees a blank white window.
 *
 * Both the probe and the boundary are deliberately synchronous / mount-time
 * so the viewer is never rendered on a machine that cannot support it.
 */

export interface WebGLSupport {
    supported: boolean;
    /** Human-readable reason when `supported` is false. */
    reason?: string;
}

let cached: WebGLSupport | undefined;

/**
 * Synchronously check whether a WebGL context can be created. Result is
 * memoized for the page lifetime — GPU blocklisting doesn't change while the
 * renderer process is alive, and repeated probing would burn context slots.
 */
export function probeWebGLSupport(): WebGLSupport {
    if (cached) return cached;
    if (typeof document === 'undefined') {
        cached = { supported: false, reason: 'No DOM available' };
        return cached;
    }
    try {
        const canvas = document.createElement('canvas');
        // Same order three.js tries: webgl2 first, then webgl.
        const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl');
        if (gl && typeof (gl as WebGLRenderingContext).getParameter === 'function') {
            // Release the probe context right away so it doesn't count toward
            // Chromium's per-page live-context limit.
            (gl as WebGLRenderingContext).getExtension('WEBGL_lose_context')?.loseContext();
            cached = { supported: true };
        } else {
            cached = {
                supported: false,
                reason: 'The graphics driver on this computer does not provide WebGL, or Chromium has disabled it for this GPU.',
            };
        }
    } catch (err) {
        cached = { supported: false, reason: err instanceof Error ? err.message : String(err) };
    }
    return cached;
}

/** Test hook: forget the cached probe result. */
export function resetWebGLSupportCache(): void {
    cached = undefined;
}

/** Message body shown when the preview cannot be rendered. */
export const WebGLUnavailableMessage: React.FC<{ reason?: string; title?: string }> = ({
    reason,
    title = '3D preview unavailable',
}) => (
    <Box
        sx={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            width: '100%',
            height: '100%',
            minHeight: 240,
            flexDirection: 'column',
            gap: 1,
            p: 3,
            textAlign: 'center',
        }}
    >
        <Typography variant="h6" color="error.main" gutterBottom>
            {title}
        </Typography>
        <Typography variant="body2" color="text.secondary">
            {reason ?? 'WebGL is required to display the preview but is not available on this computer.'}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            Playback and scheduling still work without the preview. To see the preview, update the graphics driver or
            use a computer with a WebGL-capable graphics card.
        </Typography>
    </Box>
);

interface BoundaryProps {
    children: React.ReactNode;
    /** Change this to reset the boundary (e.g. when switching 2D/3D). */
    resetKey?: string | number;
}

interface BoundaryState {
    error: Error | null;
}

/**
 * Catches anything thrown while mounting or rendering a preview viewer and
 * shows an in-place message instead of letting React unmount the whole app.
 */
export class PreviewErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
    state: BoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): BoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('[Preview] viewer failed to render:', error, info.componentStack);
    }

    componentDidUpdate(prev: BoundaryProps) {
        if (this.state.error && prev.resetKey !== this.props.resetKey) {
            this.setState({ error: null });
        }
    }

    render() {
        const { error } = this.state;
        if (error) {
            const isContextError = /webgl/i.test(error.message);
            return (
                <WebGLUnavailableMessage
                    title={isContextError ? '3D preview unavailable' : 'Preview failed to render'}
                    reason={
                        isContextError
                            ? 'This computer’s graphics driver could not create a WebGL context.'
                            : error.message
                    }
                />
            );
        }
        return this.props.children;
    }
}
