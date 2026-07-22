/** Fixture self-checks — no app boot. The FSEQ writer must round-trip through
 *  the real reader, and the generated show must parse into a usable localhost
 *  DDP controller, or every downstream test is chasing ghosts. */

import { describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FSEQReaderAsync, readControllersFromXlights } from '@ezplayer/epp';
import { writeFseq } from '../fixtures/fseq.js';
import { createFixtureShow } from '../fixtures/showfolder.js';

describe('fseq fixture', () => {
    it('round-trips through FSEQReaderAsync', async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ezp-fseq-'));
        const file = path.join(dir, 'test.fseq');
        try {
            await writeFseq(file, {
                channels: 150,
                frames: 40,
                msPerFrame: 50,
                pattern: (f, ch) => ch.fill(f % 256),
            });

            const rdr = new FSEQReaderAsync(file);
            await rdr.open();
            expect(rdr.header!.majver).toBe(2);
            expect(rdr.header!.channels).toBe(150);
            expect(rdr.header!.frames).toBe(40);
            expect(rdr.header!.msperframe).toBe(50);
            expect(rdr.header!.compression).toBe(0);

            // readFrame is the same path playback's prefetcher uses
            for (const fnum of [0, 1, 20, 39]) {
                const frame = await rdr.readFrame(fnum);
                expect(frame[0]).toBe(fnum % 256);
                expect(frame[149]).toBe(fnum % 256);
            }
            await rdr.close();
        } finally {
            await fsp.rm(dir, { recursive: true, force: true });
        }
    });
});

describe('show-folder fixture', () => {
    it('parses into a usable localhost DDP controller', async () => {
        const show = await createFixtureShow({ channels: 150 });
        try {
            const { controllers } = await readControllersFromXlights(show.dir);
            expect(controllers.length).toBe(1);
            expect(controllers[0].setup).toMatchObject({
                usable: true,
                name: 'Moc',
                address: '127.0.0.1',
                startCh: 1,
                nCh: 150,
                proto: 'DDP',
            });
        } finally {
            await show.cleanup();
        }
    });
});
