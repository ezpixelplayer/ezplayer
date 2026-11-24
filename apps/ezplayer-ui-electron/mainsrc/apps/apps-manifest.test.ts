import { describe, expect, it } from 'vitest';
import { parseManifest, runsHere } from './apps-manifest';

const good = {
    id: 'tetris',
    name: 'Tetris',
    version: '1',
    runtime: 'node',
    start: ['tetris.mjs'],
    page: 'page/',
    config: { proxy: true },
    inputs: [{ name: 'left', kind: 'event' }],
    platforms: ['win32', 'linux'],
};

describe('parseManifest', () => {
    it('accepts a full manifest and normalizes directories', () => {
        const m = parseManifest(good);
        expect(m.id).toBe('tetris');
        expect(m.page).toBe('page');
        expect(m.config).toEqual({ proxy: true });
        expect(m.inputs).toEqual([{ name: 'left', kind: 'event', min: undefined, max: undefined }]);
        expect(runsHere(m, 'linux')).toBe(true);
        expect(runsHere(m, 'darwin')).toBe(false);
    });

    it('refuses bad ids, runtimes and start lists', () => {
        expect(() => parseManifest({ ...good, id: 'Tetris' })).toThrow(/id/);
        expect(() => parseManifest({ ...good, runtime: 'ruby' })).toThrow(/runtime/);
        expect(() => parseManifest({ ...good, start: [] })).toThrow(/start/);
    });

    it('keeps page directories inside the package', () => {
        expect(() => parseManifest({ ...good, page: '../elsewhere' })).toThrow(/inside the package/);
        expect(() => parseManifest({ ...good, page: '/abs' })).toThrow(/inside the package/);
        expect(() => parseManifest({ ...good, page: 'C:\\x' })).toThrow(/inside the package/);
        expect(parseManifest({ ...good, page: './' }).page).toBe('.');
    });
});
