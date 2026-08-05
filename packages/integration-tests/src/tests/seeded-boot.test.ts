/** First-boot behavior: a show folder with pre-existing .ezplayer content and
 *  a schedule window already open must start playing with no API nudges.
 *  The schedule entry deliberately omits scheduleType (entries predating
 *  background schedules don't have it). */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { writeFseq } from '../fixtures/fseq.js';

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

function hhmm(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

beforeAll(async () => {
    mock = await startMockController({ channels: 150, ddpPort: 4048 });
    show = await createFixtureShow({ channels: 150 });

    await writeFseq(path.join(show.dir, 'Seeded.fseq'), { channels: 150, frames: 1200, value: 91 }); // 60s

    const now = new Date();
    const from = new Date(now.getTime() - 2 * 60_000);
    const to = new Date(now.getTime() + 30 * 60_000);
    if (from.getDate() !== to.getDate()) return; // skip the last half hour of the day

    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    const ez = path.join(show.dir, '.ezplayer');
    await fsp.mkdir(ez, { recursive: true });
    await fsp.writeFile(
        path.join(ez, 'sequences.json'),
        JSON.stringify({
            data: {
                allSongs: [
                    {
                        id: 'seedseq1',
                        instanceId: 'seedseq1',
                        work: { title: 'Seeded', artist: '', length: 60 },
                        files: { fseq: 'Seeded.fseq' },
                    },
                ],
            },
        }),
    );
    await fsp.writeFile(
        path.join(ez, 'playlists.json'),
        JSON.stringify({
            data: {
                playlists: [
                    { id: 'seedpl1', title: 'Seeded Show', tags: [], createdAt: 0, items: [{ id: 'seedseq1', sequence: 1 }] },
                ],
            },
        }),
    );
    await fsp.writeFile(
        path.join(ez, 'schedule.json'),
        JSON.stringify({
            data: {
                scheduledPlaylists: [
                    {
                        // no scheduleType — legacy entry
                        id: 'seedsch1',
                        playlistId: 'seedpl1',
                        title: 'Seeded',
                        playlistTitle: 'Seeded Show',
                        date: midnight.getTime(),
                        fromTime: hhmm(from),
                        toTime: hhmm(to),
                        duration: 0,
                        loop: true,
                    },
                ],
            },
        }),
    );

    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('first boot with seeded show content', () => {
    it('starts the open schedule window with no API nudges', async () => {
        const now = new Date();
        if (now.getHours() === 23 && now.getMinutes() >= 28) return; // window would cross midnight

        const playing = await fpp.waitForStatus((s) => s.status_name === 'playing', {
            label: 'seeded schedule fired at boot',
            timeoutMs: 45_000,
        });
        expect(playing.current_sequence).toBe('Seeded.fseq');
        expect(playing.current_playlist.playlist).toBe('Seeded Show');

        await mock.ddp.waitForFrames(10, { timeoutMs: 20_000 });
        expect(Array.from(mock.ddp.channelRange(0, 3))).toEqual([91, 91, 91]);
    });
});
