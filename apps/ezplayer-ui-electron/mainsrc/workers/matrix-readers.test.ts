/**
 * Virtual matrix readers: who is counted, and what rates they are given.
 */

import { describe, expect, it } from 'vitest';
import { MATRIX_READER_FORGET_MS, MatrixReaders } from './matrix-readers';

function fixture() {
    const clock = { t: 1000 };
    return { clock, readers: new MatrixReaders(() => clock.t) };
}

describe('matrix readers', () => {
    it('reports made, sent and painted rates over the last few seconds', () => {
        const { clock, readers } = fixture();
        // 40 frames a second made; the reader gets every one and paints every other.
        for (let i = 0; i <= 80; i++) {
            readers.note({
                model: 'Matrix',
                client: 'a',
                ip: '127.0.0.1',
                seq: 500 + i,
                served: true,
                painted: i >> 1,
            });
            clock.t += 25;
        }
        const [r] = readers.list();
        expect(r.model).toBe('Matrix');
        expect(r.address).toBe('local');
        expect(r.sourceFps).toBeCloseTo(40, 0);
        expect(r.servedFps).toBeCloseTo(40, 0);
        expect(r.paintedFps).toBeCloseTo(20, 0);
    });

    it('does not count an empty answer as a frame sent', () => {
        const { clock, readers } = fixture();
        for (let i = 0; i <= 40; i++) {
            readers.note({ model: 'Matrix', client: 'a', ip: '10.0.0.7', seq: 9, served: false });
            clock.t += 50;
        }
        const [r] = readers.list();
        expect(r.address).toBe('10.0.0.7');
        expect(r.servedFps).toBe(0);
        expect(r.sourceFps).toBe(0);
        expect(r.paintedFps).toBeUndefined();
        expect(r.idleMs).toBe(50);
    });

    it('tells readers apart by id, and by address without one', () => {
        const { readers } = fixture();
        readers.note({ model: 'Matrix', client: 'a', ip: '10.0.0.7', seq: 1, served: true });
        readers.note({ model: 'Matrix', client: 'b', ip: '10.0.0.7', seq: 1, served: true });
        readers.note({ model: 'Matrix', ip: '::ffff:10.0.0.8', seq: 1, served: true });
        readers.note({ model: 'Matrix', ip: '10.0.0.8', seq: 2, served: true });
        readers.note({ model: 'Tree', client: 'a', ip: '10.0.0.7', seq: 1, served: true, output: 'vm-1' });
        const list = readers.list();
        expect(list.map((r) => `${r.model} ${r.address}`)).toEqual([
            'Matrix 10.0.0.7',
            'Matrix 10.0.0.7',
            'Matrix 10.0.0.8',
            'Tree 10.0.0.7',
        ]);
        expect(list[3].output).toBe('vm-1');
    });

    it('shows a reader that stopped as idle, then forgets it', () => {
        const { clock, readers } = fixture();
        for (let i = 0; i <= 40; i++) {
            readers.note({ model: 'Matrix', client: 'a', ip: '127.0.0.1', seq: i, served: true, painted: i });
            clock.t += 25;
        }
        clock.t += 5000;
        const [r] = readers.list();
        expect(r.idleMs).toBeGreaterThan(5000);
        expect(r.servedFps).toBe(0);
        expect(r.paintedFps).toBe(0);
        clock.t += MATRIX_READER_FORGET_MS;
        expect(readers.list()).toEqual([]);
    });

    it('starts over when a reader restarts its painted count', () => {
        const { clock, readers } = fixture();
        for (let i = 0; i <= 40; i++) {
            readers.note({ model: 'Matrix', client: 'a', ip: '127.0.0.1', seq: i, served: true, painted: 1000 + i });
            clock.t += 25;
        }
        readers.note({ model: 'Matrix', client: 'a', ip: '127.0.0.1', seq: 41, served: true, painted: 0 });
        const [r] = readers.list();
        expect(r.paintedFps).toBe(0);
    });
});
