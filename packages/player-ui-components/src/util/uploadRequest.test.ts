// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { groupByBytes, uploadRequest } from './uploadRequest';

class FakeRequest {
    static last: FakeRequest;
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
        FakeRequest.last = this;
    }
}

beforeEach(() => vi.stubGlobal('XMLHttpRequest', FakeRequest));
afterEach(() => vi.unstubAllGlobals());

describe('uploadRequest', () => {
    it('reports bytes but waits for the player before resolving', async () => {
        const progress = vi.fn();
        const complete = vi.fn();
        const pending = uploadRequest('/api/file/uploads/song.mp3', new Blob(['audio']), {}, progress).then(complete);
        FakeRequest.last.upload.onprogress?.({ loaded: 5, total: 5, lengthComputable: true });
        await Promise.resolve();
        expect(progress).toHaveBeenLastCalledWith(5, 5);
        expect(complete).not.toHaveBeenCalled();
        FakeRequest.last.onload?.();
        await pending;
        expect(complete).toHaveBeenCalledWith('OK');
    });

    it('rejects with the player error message', async () => {
        const pending = uploadRequest('/api/file/uploads/song.mp3', new Blob(['audio']), {});
        FakeRequest.last.status = 413;
        FakeRequest.last.responseText = JSON.stringify({ error: 'Upload exceeds maximum size' });
        FakeRequest.last.onload?.();
        await expect(pending).rejects.toThrow('Upload exceeds maximum size');
    });

    it('rejects when the connection drops', async () => {
        const pending = uploadRequest('/api/file/uploads/song.mp3', new Blob(['audio']), {});
        FakeRequest.last.onerror?.();
        await expect(pending).rejects.toThrow(/connection lost/);
    });
});

describe('groupByBytes', () => {
    const file = (name: string, size: number) => ({ name, data: { size } });
    it('fills groups in order up to the limit', () => {
        const groups = groupByBytes([file('a', 6), file('b', 3), file('c', 2), file('d', 1)], 10);
        expect(groups.map((g) => g.map((f) => f.name))).toEqual([
            ['a', 'b'],
            ['c', 'd'],
        ]);
    });
    it('sends an oversized file alone', () => {
        const groups = groupByBytes([file('a', 1), file('big', 50), file('c', 1)], 10);
        expect(groups.map((g) => g.map((f) => f.name))).toEqual([['a'], ['big'], ['c']]);
    });
    it('returns no groups for no files', () => {
        expect(groupByBytes([], 10)).toEqual([]);
    });
});
