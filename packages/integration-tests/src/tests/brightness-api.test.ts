/** Output brightness over REST: defaults and schedule windows through
 *  /api/ezp/brightness, the setbrightness player command, and the live level
 *  the player reports once it has slewed to the default. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

let show: FixtureShow;
let app: EzPlayerProc;

const getJson = async (p: string) => {
    const res = await fetch(`${app.base}${p}`);
    return { status: res.status, body: await res.json() };
};
const post = async (p: string, value: unknown) => {
    const res = await fetch(`${app.base}${p}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
    });
    return { status: res.status, body: await res.json() };
};

/** The live level from the status API, once the slew has reached `level`. */
const liveBrightness = async (level: number) => {
    const deadline = Date.now() + 5000;
    for (;;) {
        const res = await fetch(`${app.base}/api/ezp/brightness`);
        const body = (await res.json()) as { level?: number; colorTemperature?: number };
        if (body.level === level || Date.now() > deadline) return body;
        await new Promise((r) => setTimeout(r, 200));
    }
};

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

describe('brightness API', () => {
    it('starts full and neutral with no windows', async () => {
        const { status, body } = await getJson('/api/ezp/brightness');
        expect(status).toBe(200);
        expect(body).toMatchObject({
            defaultBrightness: 100,
            defaultColorTemperature: 6500,
            schedule: [],
            activeWindow: null,
        });
    });

    it('POST writes the defaults, the player slews to them, and the settings file follows', async () => {
        const r = await post('/api/ezp/brightness', { brightness: 60, colorTemperature: 3000 });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({
            success: true,
            defaultInEffect: true,
            brightness: { defaultBrightness: 60, defaultColorTemperature: 3000 },
        });
        expect(await liveBrightness(60)).toMatchObject({ level: 60, colorTemperature: 3000 });
        expect(await getJson('/api/ezp/playback-settings/brightnessControl')).toMatchObject({
            status: 200,
            body: { defaultBrightness: 60, defaultColorTemperature: 3000 },
        });
    });

    it('setbrightness is the same write, and neutral clears the colour temperature', async () => {
        const r = await post('/api/ezp/player-command', {
            command: 'setbrightness',
            brightness: 100,
            colorTemperature: 6500,
        });
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({
            success: true,
            brightness: { defaultBrightness: 100, defaultColorTemperature: 6500 },
        });
        expect(await liveBrightness(100)).toMatchObject({ level: 100, colorTemperature: 6500 });
        const stored = (await getJson('/api/ezp/playback-settings/brightnessControl')).body;
        expect('defaultColorTemperature' in stored).toBe(false);
    });

    it('rejects a write with nothing to set or a non-numeric value', async () => {
        expect((await post('/api/ezp/brightness', {})).status).toBe(400);
        expect((await post('/api/ezp/brightness', { brightness: 'dim' })).status).toBe(400);
        expect(
            (await post('/api/ezp/player-command', { command: 'setbrightness', colorTemperature: 'warm' })).status,
        ).toBe(400);
    });

    it('a schedule window in effect takes over and the write reports it', async () => {
        // A window that is always in effect: every day, all week long.
        const windows = [{ days: 'all', startTime: '00:00', endTime: '24:00', brightness: 30, colorTemperature: 2700 }];
        const r = await post('/api/ezp/brightness/schedule', windows);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ success: true, defaultInEffect: false });
        expect(r.body.warning).toMatch(/scheduled brightness window is in effect/);
        expect(r.body.brightness.activeWindow).toMatchObject({ brightness: 30, colorTemperature: 2700 });
        expect(r.body.brightness.schedule[0].id).toMatch(/[0-9a-f-]{36}/);
        expect(await liveBrightness(30)).toMatchObject({ level: 30, colorTemperature: 2700 });

        const listed = await getJson('/api/ezp/brightness/schedule');
        expect(listed.body).toHaveLength(1);

        // Writing the default while the window holds does not change the live level.
        const d = await post('/api/ezp/brightness', { brightness: 90 });
        expect(d.body).toMatchObject({ defaultInEffect: false, brightness: { defaultBrightness: 90 } });
        expect((await getJson('/api/ezp/brightness')).body.level).toBe(30);

        // Clearing the schedule returns to the default.
        expect((await post('/api/ezp/brightness/schedule', [])).status).toBe(200);
        expect(await liveBrightness(90)).toMatchObject({ level: 90, colorTemperature: 6500 });
    });

    it('rejects malformed windows naming the field', async () => {
        const bad = await post('/api/ezp/brightness/schedule', [{ days: 'all', startTime: '1:00', endTime: '2:00' }]);
        expect(bad.status).toBe(400);
        expect(bad.body.error).toBe('schedule[0].brightness must be a number 0-100');
        expect((await post('/api/ezp/brightness/schedule', { not: 'an array' })).status).toBe(400);
    });
});
