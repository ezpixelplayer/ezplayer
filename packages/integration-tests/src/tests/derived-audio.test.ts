/** Derived playback audio is precomputed: add songs the way the web UI does
 *  (upload files, POST /api/ezp/sequences) and check that the derived MP3 exists
 *  by the time the save returns, that the source is untouched, that the
 *  "normalize new songs" default applies, that a song whose audio cannot be
 *  derived is not saved, and that playback runs off the derived file. Runs the
 *  real bundled ffmpeg. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { writeFseq } from '../fixtures/fseq.js';
import { sineWav } from '../fixtures/wav.js';

const CHANNELS = 30;
const FRAME_MS = 50;
const SONG_SECS = 4;

let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;
let derivedDir: string;

type Rec = {
    id: string;
    work: { title: string; length: number };
    files: { fseq?: string; audio?: string };
    settings?: { normalize?: boolean; volume_adj?: number };
    updatedAt?: number;
};

const baseSettings = {
    audioSyncAdjust: 0,
    backgroundSequence: 'overlay',
    viewerControl: { enabled: false, type: 'disabled', schedule: [] },
    volumeControl: { defaultVolume: 100, schedule: [] },
};

function hms(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

async function postJson(url: string, body: unknown): Promise<Response> {
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function register(rec: Partial<Rec>): Promise<Rec[]> {
    const res = await postJson(`${app.base}/api/ezp/sequences`, [rec]);
    expect(res.status).toBe(200);
    return ((await res.json()) as { sequences: Rec[] }).sequences;
}

async function writeSong(name: string, seed: number): Promise<void> {
    await writeFseq(path.join(show.dir, `${name}.fseq`), {
        channels: CHANNELS,
        frames: (SONG_SECS * 1000) / FRAME_MS,
        msPerFrame: FRAME_MS,
        pattern: (f, ch) => ch.fill((f * seed) & 0xff),
    });
}

async function derivedFiles(): Promise<string[]> {
    return (await fsp.readdir(derivedDir).catch(() => [] as string[])).filter((n) => n.endsWith('.mp3')).sort();
}

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    show = await createFixtureShow({ channels: CHANNELS });
    derivedDir = path.join(show.dir, '.ezplayer', 'derived-audio');
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('derived audio', () => {
    it('derives an uploaded WAV before the save returns, leaving the source alone', async () => {
        await writeSong('Wav', 1);
        const wav = sineWav({ seconds: SONG_SECS });
        expect((await fpp.uploadFile('music', 'Wav.wav', wav)).status).toBe(200);
        expect(await derivedFiles()).toEqual([]);

        // Same call the web UI's Add Song makes; no normalize flag -> setting default (off).
        const rec = (
            await register({ files: { fseq: 'Wav.fseq', audio: 'Wav.wav' }, work: { title: 'Wav Song', length: 0 } })
        ).find((s) => s.work.title === 'Wav Song')!;
        expect(rec.settings?.normalize).toBe(false);
        expect(rec.files.audio?.toLowerCase().endsWith('wav.wav')).toBe(true);

        // Precomputed: present as soon as the save has returned, no waiting.
        expect(await derivedFiles()).toEqual([expect.stringMatching(/^Wav-[0-9a-f]{16}\.mp3$/)]);
        expect(await fsp.readFile(path.join(show.dir, 'Wav.wav'))).toEqual(Buffer.from(wav));
        expect((await fsp.readdir(show.dir)).filter((n) => n.toLowerCase().endsWith('.mp3'))).toEqual([]);
    });

    it('refuses to save a song whose audio cannot be derived', async () => {
        await writeSong('Bad', 3);
        expect((await fpp.uploadFile('music', 'Bad.wav', new Uint8Array(64).fill(0x5a))).status).toBe(200);
        const res = await postJson(`${app.base}/api/ezp/sequences`, [
            { files: { fseq: 'Bad.fseq', audio: 'Bad.wav' }, work: { title: 'Bad Song', length: 0 } },
        ]);
        expect(res.status).not.toBe(200);
        const body = (await res.json()) as { error?: string };
        expect(body.error).toMatch(/ffmpeg conversion failed|derive/i);

        const listed = (await fpp.currentShow()).sequences as Rec[] | undefined;
        expect(listed?.find((s) => s.work.title === 'Bad Song')).toBeUndefined();
        expect((await derivedFiles()).filter((n) => n.startsWith('Bad-'))).toEqual([]);
    });

    it('applies the "normalize new songs" default and derives the normalized variant', async () => {
        const on = await postJson(`${app.base}/api/ezp/playback-settings`, {
            ...baseSettings,
            normalizeNewSongs: true,
        });
        expect(on.status).toBe(200);

        await writeSong('Norm', 7);
        expect((await fpp.uploadFile('music', 'Norm.wav', sineWav({ seconds: SONG_SECS }))).status).toBe(200);
        const rec = (
            await register({ files: { fseq: 'Norm.fseq', audio: 'Norm.wav' }, work: { title: 'Norm Song', length: 0 } })
        ).find((s) => s.work.title === 'Norm Song')!;
        expect(rec.settings?.normalize).toBe(true);

        // Only the normalized variant is derived for this record, and it is already there.
        expect((await derivedFiles()).filter((n) => n.startsWith('Norm-'))).toEqual([
            expect.stringMatching(/^Norm-norm-[0-9a-f]{16}\.mp3$/),
        ]);

        // Unchecking is a record edit; the plain variant is derived before that save returns.
        const edited = (
            await register({ ...rec, settings: { ...rec.settings, normalize: false }, updatedAt: Date.now() })
        ).find((s) => s.id === rec.id)!;
        expect(edited.settings?.normalize).toBe(false);
        expect((await derivedFiles()).find((n) => /^Norm-[0-9a-f]{16}\.mp3$/.test(n))).toBeDefined();

        // Omitting the flag on a later edit keeps the record's value, not the default.
        const kept = (await register({ ...edited, settings: { volume_adj: 3 }, updatedAt: Date.now() + 1 })).find(
            (s) => s.id === rec.id,
        )!;
        expect(kept.settings?.normalize).toBe(false);
        expect(kept.settings?.volume_adj).toBe(3);

        const off = await postJson(`${app.base}/api/ezp/playback-settings`, {
            ...baseSettings,
            normalizeNewSongs: false,
        });
        expect(off.status).toBe(200);
    });

    it('plays a song from its derived audio', async () => {
        const res = await fpp.putPlaylist('Derived', {
            name: 'Derived',
            mainPlaylist: [{ type: 'sequence', sequenceName: 'Wav.fseq' }],
        });
        expect(res.status).toBe(200);
        const playlists = (await fpp.currentShow()).playlists as Array<{ id: string; title: string }>;
        const pl = playlists.find((p) => p.title === 'Derived')!;

        const now = new Date();
        const start = new Date(now.getTime() + 4000);
        const end = new Date(start.getTime() + 60_000);
        if (start.getDate() !== end.getDate()) return; // skip near midnight
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        const put = await postJson(`${app.base}/api/ezp/schedules`, [
            {
                id: 'derived-sched',
                scheduleType: 'main',
                playlistId: pl.id,
                title: 'Derived',
                playlistTitle: 'Derived',
                date: midnight.getTime(),
                fromTime: hms(start),
                toTime: hms(end),
                duration: 0,
            },
        ]);
        expect(put.status).toBe(200);
        mock.ddp.reset();
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'derived start', timeoutMs: 30_000 });
        await fpp.waitForStatus((s) => s.status_name === 'idle', { label: 'derived end', timeoutMs: 90_000 });
        expect(mock.ddp.framesReceived()).toBeGreaterThan(0);
        await postJson(`${app.base}/api/ezp/schedules`, [{ id: 'derived-sched', deleted: true }]);
    });
});
