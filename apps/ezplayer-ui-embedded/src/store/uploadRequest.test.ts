// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadRequest } from './uploadRequest';
class Request {
    static last: Request;
    upload: { onprogress?: (event: { loaded: number; total: number; lengthComputable: boolean }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    status = 200;
    responseText = 'OK';
    open = vi.fn();
    setRequestHeader = vi.fn();
    send = vi.fn();
    constructor() {
        Request.last = this;
    }
}
beforeEach(() => vi.stubGlobal('XMLHttpRequest', Request));
afterEach(() => vi.unstubAllGlobals());
describe('upload completion and progress', () => {
    it('reports bytes but waits for server acknowledgement before resolving', async () => {
        const progress = vi.fn();
        const complete = vi.fn();
        const pending = uploadRequest('/api/file/uploads/song.mp3', new Blob(['audio']), {}, progress).then(complete);
        Request.last.upload.onprogress?.({ loaded: 5, total: 5, lengthComputable: true });
        await Promise.resolve();
        expect(progress).toHaveBeenLastCalledWith(5, 5);
        expect(complete).not.toHaveBeenCalled();
        Request.last.onload?.();
        await pending;
        expect(complete).toHaveBeenCalledWith('OK');
    });
    it('rejects with the player error rather than declaring success', async () => {
        const pending = uploadRequest('/api/file/uploads/song.mp3', new Blob(['audio']), {});
        Request.last.status = 413;
        Request.last.responseText = JSON.stringify({ error: 'Upload exceeds maximum size' });
        Request.last.onload?.();
        await expect(pending).rejects.toThrow('Upload exceeds maximum size');
    });
});
