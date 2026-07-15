/** File API + FPP playlist/schedule round-trips against a live headless app.
 *  One app boot for the whole file. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

describe('file API', () => {
    it('uploads (single-shot + chunked), lists, downloads, registers', async () => {
        const fseqA = buildFseq({ channels: 150, frames: 200, value: 10 }); // 10s @ 50ms
        const fseqB = buildFseq({ channels: 150, frames: 200, value: 20 });

        const up = await fpp.uploadFile('sequences', 'SongA.fseq', fseqA);
        expect(up.status).toBe(200);
        await fpp.uploadFileChunked('sequences', 'SongB.fseq', fseqB, 16384);

        expect(await fpp.listFiles('sequences')).toEqual(['SongA.fseq', 'SongB.fseq']);

        const back = await fpp.download('sequences', 'SongA.fseq');
        expect(Buffer.from(back).equals(fseqA)).toBe(true);

        // EZP-native registration fills duration from the FSEQ header
        const reg = await fetch(`${app.base}/api/sequences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{ files: { fseq: 'SongA.fseq' }, work: { title: 'Song A', artist: '', length: 0 } }]),
        });
        expect(reg.status).toBe(200);
        const regBody = (await reg.json()) as { sequences: Array<{ work: { title: string; length: number } }> };
        const songA = regBody.sequences.find((s) => s.work.title === 'Song A')!;
        expect(songA.work.length).toBe(10);
    });
});

describe('FPP playlists + schedule', () => {
    it('creates a playlist (auto-registering uploaded fseqs) and round-trips', async () => {
        const res = await fpp.putPlaylist('Main Show', {
            name: 'Main Show',
            mainPlaylist: [
                { type: 'sequence', sequenceName: 'SongA.fseq' },
                { type: 'sequence', sequenceName: 'SongB' }, // extension optional; SongB unregistered -> auto
                { type: 'pause', duration: 5 }, // skipped with a warning
            ],
        });
        expect(res.status).toBe(200);

        expect(await fpp.playlistNames()).toEqual(['Main Show']);
        const round = await fpp.getPlaylist('Main Show');
        expect(round.mainPlaylist.map((e: any) => e.sequenceName)).toEqual(['SongA.fseq', 'SongB.fseq']);
        expect(round.playlistInfo.total_items).toBe(2);
        expect(round.playlistInfo.total_duration).toBe(20);
    });

    it('round-trips an FPP schedule and reflects it natively', async () => {
        // Dates must lie within the ~13-month materialization horizon.
        const ymd = (d: Date) => {
            const p2 = (n: number) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
        };
        const start = new Date();
        const end = new Date(start.getTime() + 13 * 24 * 3600 * 1000);
        const put = await fpp.putSchedule([
            {
                enabled: 1,
                day: 7,
                playlist: 'Main Show',
                startTime: '17:00:00',
                endTime: '22:00:00',
                startDate: ymd(start),
                endDate: ymd(end),
                repeat: 1,
                stopType: 0,
            },
        ]);
        expect(put.status).toBe(200);

        const back = await fpp.getSchedule();
        expect(back).toEqual([
            {
                enabled: 1,
                playlist: 'Main Show',
                day: 7,
                startTime: '17:00:00',
                endTime: '22:00:00',
                startDate: ymd(start),
                endDate: ymd(end),
                repeat: 1,
                stopType: 0,
            },
        ]);

        const native = await fpp.currentShow();
        expect(native.schedule.length).toBe(14); // one per day, today .. today+13
        expect(native.schedule[0]).toMatchObject({ playlistTitle: 'Main Show', fromTime: '17:00', toTime: '22:00' });

        // A daily 17:00-22:00 schedule shouldn't be playing outside the window
        // — but don't assert either way; scheduled-start.test.ts owns playback.
        expect((await fpp.putSchedule([])).status).toBe(200); // clean up for later tests
    });
});
