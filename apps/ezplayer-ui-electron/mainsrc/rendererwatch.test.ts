import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

const { ipcMain, reportDiagEvent, injectRendererFaults } = await vi.hoisted(async () => {
    const { EventEmitter: EE } = await import('node:events');
    return { ipcMain: new EE(), reportDiagEvent: vi.fn(), injectRendererFaults: vi.fn() };
});
vi.mock('electron', () => ({ ipcMain }));
vi.mock('./diagnostics.js', () => ({ reportDiagEvent }));
vi.mock('./faultinject-main.js', () => ({ injectRendererFaults }));

const { watchRenderer, READY_TIMEOUT_MS, HANG_AFTER_MS, JS_STACK_TIMEOUT_MS } = await import('./rendererwatch.js');

type HeadersListener = (
    details: { resourceType: string; responseHeaders?: Record<string, string[]> },
    callback: (r: { responseHeaders?: Record<string, string[]> }) => void,
) => void;

const STUCK_STACK = '\n    at spin (file:///app/assets/main.js:1:2)';

class FakeContents extends EventEmitter {
    answering = true;
    isDestroyed = () => false;
    getURL = () => 'file:///app/index.html';
    executeJavaScript = vi.fn(async () => ({ rootChildren: 0 }));
    headersFilter: unknown;
    headersListener: HeadersListener | undefined;
    session = {
        webRequest: {
            onHeadersReceived: (filter: unknown, listener: HeadersListener) => {
                this.headersFilter = filter;
                this.headersListener = listener;
            },
        },
    };
    // Like an idle page: the stack request settles only once script runs.
    mainFrame = { collectJavaScriptCallStack: vi.fn((): Promise<string | void> => new Promise(() => {})) };
    // Async, like real IPC.
    send = (channel: string, seq: number) => {
        if (channel === 'ezp:ping' && this.answering)
            setTimeout(() => ipcMain.emit('ezp:pong', { sender: this }, seq), 0);
    };
}

class FakeWindow extends EventEmitter {
    webContents = new FakeContents();
    visible = true;
    isVisible = () => this.visible;
    isMinimized = () => false;
}

function setup() {
    const win = new FakeWindow();
    watchRenderer(win as never, () => ['E boom']);
    win.webContents.emit('did-navigate');
    return win;
}

const ready = (win: FakeWindow) => ipcMain.emit('ezp:renderer-ready', { sender: win.webContents });
const kinds = () => reportDiagEvent.mock.calls.map((c) => c[0]);

beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    reportDiagEvent.mockReset();
    injectRendererFaults.mockReset();
    ipcMain.removeAllListeners();
});

describe('watchRenderer', () => {
    it('reports a page whose app never comes up, with what the page shows', async () => {
        setup();
        await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS + JS_STACK_TIMEOUT_MS);
        expect(reportDiagEvent).toHaveBeenCalledWith(
            'renderer-not-ready',
            expect.stringContaining('not up after 45s'),
            undefined,
            expect.objectContaining({ page: { rootChildren: 0 }, recentErrors: ['E boom'] }),
        );
    });

    it('stays quiet when the app comes up, and hands over to fault injection', async () => {
        const win = setup();
        ready(win);
        await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS * 3);
        expect(reportDiagEvent).not.toHaveBeenCalled();
        expect(injectRendererFaults).toHaveBeenCalledTimes(1);
    });

    it('keeps watching a page whose link became a download', async () => {
        const win = setup();
        ready(win);
        win.webContents.emit('did-start-loading');
        await vi.advanceTimersByTimeAsync(READY_TIMEOUT_MS * 2);
        expect(reportDiagEvent).not.toHaveBeenCalled();
        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS + 10_000);
        expect(kinds()).toEqual(['renderer-hang']);
    });

    it('reports a hang once, and again only after the renderer has recovered', async () => {
        const win = setup();
        ready(win);
        await vi.advanceTimersByTimeAsync(20_000);
        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS + 10_000);
        expect(kinds()).toEqual(['renderer-hang']);
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS * 2);
        expect(kinds()).toEqual(['renderer-hang']);

        win.webContents.answering = true;
        await vi.advanceTimersByTimeAsync(10_000);
        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS + 10_000);
        expect(kinds()).toEqual(['renderer-hang', 'renderer-hang']);
    });

    it('reports the stack a stuck page is running', async () => {
        const win = setup();
        ready(win);
        win.webContents.mainFrame.collectJavaScriptCallStack.mockResolvedValue(STUCK_STACK);
        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS + 10_000);
        expect(reportDiagEvent).toHaveBeenCalledWith(
            'renderer-hang',
            expect.stringContaining('not answering'),
            STUCK_STACK,
            expect.objectContaining({ recentErrors: ['E boom'] }),
        );

        win.webContents.emit('unresponsive');
        await vi.advanceTimersByTimeAsync(0);
        expect(reportDiagEvent).toHaveBeenLastCalledWith(
            'unresponsive',
            'main window unresponsive',
            STUCK_STACK,
            undefined,
        );
    });

    it('reports a hang without a stack when none comes back in time', async () => {
        const win = setup();
        ready(win);
        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS + 10_000);
        expect(reportDiagEvent).toHaveBeenCalledWith('renderer-hang', expect.any(String), undefined, expect.anything());

        win.webContents.mainFrame.collectJavaScriptCallStack.mockRejectedValue(new Error('frame gone'));
        win.webContents.emit('unresponsive');
        await vi.advanceTimersByTimeAsync(0);
        expect(reportDiagEvent).toHaveBeenLastCalledWith(
            'unresponsive',
            'main window unresponsive',
            undefined,
            undefined,
        );
    });

    it('opts our page documents in to stack collection', () => {
        const wc = setup().webContents;
        expect(wc.headersFilter).toEqual({ urls: ['file:///*', 'http://localhost:5173/*'] });
        const headers = (resourceType: string) => {
            let out: Record<string, string[]> | undefined;
            wc.headersListener!({ resourceType, responseHeaders: { a: ['1'] } }, (r) => (out = r.responseHeaders));
            return out;
        };
        expect(headers('mainFrame')).toEqual({
            a: ['1'],
            'Document-Policy': ['include-js-call-stacks-in-crash-reports'],
        });
        expect(headers('script')).toBeUndefined();
    });

    it('does not count system sleep or a wall-clock jump as a hang', async () => {
        const win = setup();
        ready(win);
        await vi.advanceTimersByTimeAsync(22_000); // mid-interval, last pong received
        // Clock jumps with no timers running (sleep, time sync).
        vi.setSystemTime(Date.now() + 19_000_000);
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS * 2);
        vi.setSystemTime(Date.now() - 3_600_000);
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS * 2);
        expect(reportDiagEvent).not.toHaveBeenCalled();

        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS + 10_000);
        expect(kinds()).toEqual(['renderer-hang']);
    });

    it('does not judge a hidden window', async () => {
        const win = setup();
        ready(win);
        win.visible = false;
        win.webContents.answering = false;
        await vi.advanceTimersByTimeAsync(HANG_AFTER_MS * 3);
        expect(reportDiagEvent).not.toHaveBeenCalled();
    });

    it('reports errors the page could only write to the console', () => {
        const win = setup();
        win.webContents.emit('console-message', {
            level: 'error',
            message: '[ezp-report] {"message":"x is not defined","stack":"at y"}',
        });
        win.webContents.emit('console-message', { level: 'error', message: 'ordinary error' });
        expect(reportDiagEvent.mock.calls).toEqual([
            ['renderer-error', 'x is not defined', 'at y', { via: 'console' }],
        ]);
    });
});
