// @vitest-environment jsdom
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { probeWebGLSupport, resetWebGLSupportCache, PreviewErrorBoundary } from './webglSupport';

describe('probeWebGLSupport', () => {
    beforeEach(() => resetWebGLSupportCache());
    afterEach(() => vi.restoreAllMocks());

    it('reports unsupported when no context can be created', () => {
        // jsdom has no canvas backend, so getContext returns null. Stub it
        // explicitly so the test doesn't depend on jsdom's "not implemented"
        // virtual-console noise.
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        const result = probeWebGLSupport();
        expect(result.supported).toBe(false);
        expect(result.reason).toMatch(/graphics driver/i);
    });

    it('reports supported when a context is returned, and releases it', () => {
        const loseContext = vi.fn();
        const fakeGl = {
            getParameter: () => 0,
            getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null),
        };
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
            fakeGl as unknown as WebGL2RenderingContext,
        );
        expect(probeWebGLSupport().supported).toBe(true);
        expect(loseContext).toHaveBeenCalledTimes(1);
    });

    it('memoizes the result', () => {
        const spy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
        probeWebGLSupport();
        probeWebGLSupport();
        // One probe → at most the three context names tried once.
        expect(spy.mock.calls.length).toBeLessThanOrEqual(3);
    });

    it('treats a throwing getContext as unsupported', () => {
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
            throw new Error('boom');
        });
        expect(probeWebGLSupport()).toEqual({ supported: false, reason: 'boom' });
    });
});

describe('PreviewErrorBoundary', () => {
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    const Thrower: React.FC<{ message: string }> = ({ message }) => {
        throw new Error(message);
    };

    it('shows the WebGL message instead of unmounting when the renderer throws', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <PreviewErrorBoundary>
                <Thrower message="Error creating WebGL context." />
            </PreviewErrorBoundary>,
        );
        expect(screen.getByText('3D preview unavailable')).toBeTruthy();
        expect(screen.getByText(/could not create a WebGL context/i)).toBeTruthy();
    });

    it('shows the raw message for non-WebGL errors', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        render(
            <PreviewErrorBoundary>
                <Thrower message="something else broke" />
            </PreviewErrorBoundary>,
        );
        expect(screen.getByText('Preview failed to render')).toBeTruthy();
        expect(screen.getByText('something else broke')).toBeTruthy();
    });

    it('recovers when resetKey changes', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const { rerender } = render(
            <PreviewErrorBoundary resetKey="3d">
                <Thrower message="Error creating WebGL context." />
            </PreviewErrorBoundary>,
        );
        expect(screen.getByText('3D preview unavailable')).toBeTruthy();
        rerender(
            <PreviewErrorBoundary resetKey="2d">
                <div>fine now</div>
            </PreviewErrorBoundary>,
        );
        expect(screen.getByText('fine now')).toBeTruthy();
    });
});
