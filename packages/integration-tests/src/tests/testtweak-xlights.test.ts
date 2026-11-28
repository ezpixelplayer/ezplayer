/** Test + Tweak against what xLights has for a model: with nothing set in the
 *  player the model goes out in its string type's order through its dimming
 *  curve, a profile setting replaces the xLights one, and the controller
 *  connection's own settings are left to the controller. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import type { TestTweakDoc, TestTweakSnapshot } from '@ezplayer/ezplayer-core';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

const CHANNELS = 150;
let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;

type Reply = ({ ok: true } & TestTweakSnapshot) | { ok: false; error: string };

async function ok(method: string, sub = '', body?: unknown): Promise<TestTweakSnapshot> {
    const res = await fetch(`${app.base}/api/ezp/testtweak${sub}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const reply = JSON.parse(await res.text()) as Reply;
    expect(res.status, JSON.stringify(reply)).toBe(200);
    if (!reply.ok) throw new Error(reply.error);
    return reply;
}

async function waitForFirstPixel(want: number[], label: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const bytes = mock.ddp.channelRange(0, CHANNELS);
        if (Array.from(bytes.subarray(0, 3)).join() === want.join()) return;
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${label}: want ${want}, wire=${Array.from(bytes.subarray(0, 3))}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

const emptyDoc = (): TestTweakDoc => ({ version: 2, models: {}, profiles: [], groups: [], presets: [] });
/** Red 255, green 128, blue 0. */
const solid = { kind: 'solid', colors: ['#ff8000'], intensity: 1 };

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    show = await createFixtureShow({
        channels: CHANNELS,
        stringType: 'GRB Nodes',
        // Half brightness after a gamma of 2; and a controller connection that swaps and dims again.
        modelInnerXml:
            '<dimmingCurve><all gamma="2.0" brightness="-50"/></dimmingCurve>' +
            '<ControllerConnection Port="1" Protocol="ws2811" colorOrder="BGR" Brightness="30" gamma="2.5"/>',
    });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('test + tweak over the xLights settings', () => {
    it('reports what xLights has for the model', async () => {
        const [m] = (await ok('GET')).models;
        expect(m).toMatchObject({
            name: 'Line1',
            xlStringOrder: 'GRB',
            xlDimGamma: 2,
            xlDimBrightness: 50,
            xlColorOrder: 'BGR',
            xlBrightness: 30,
            xlGamma: 2.5,
        });
    });

    it('tells the viewers there is no curve to undo in what they are fed', async () => {
        for (const path of ['model-coordinates', 'model-coordinates-2d']) {
            const coords = (await (await fetch(`${app.base}/api/ezp/${path}`)).json()) as Record<
                string,
                { colorProfile?: { allGamma?: number; allBrightness?: number } }
            >;
            expect(coords.Line1.colorProfile, path).toMatchObject({ allGamma: 1, allBrightness: 1 });
        }
    });

    it('sends the string type order and dimming curve when nothing is set', async () => {
        await ok('POST', '/test', { targets: { models: ['Line1'] }, pattern: solid });
        // 255 * 0.5 * (v/255)^2, green first. The connection's BGR, 30% and 2.5 are the controller's to apply.
        await waitForFirstPixel([32, 128, 0], 'the model as xLights has it');
    });

    it('runs a test at the default frame rate, not the idle one', async () => {
        mock.ddp.reset();
        await new Promise((r) => setTimeout(r, 2000));
        // 40 a second unless set otherwise; plain idle black is 5.
        const frames = mock.ddp.framesReceived();
        expect(frames).toBeGreaterThan(60);
        expect(frames).toBeLessThan(100);
    });

    it('replaces only what a profile sets', async () => {
        const doc: TestTweakDoc = {
            ...emptyDoc(),
            profiles: [{ id: 'p', name: 'Brighter', brightness: 80 }],
            models: { Line1: { profile: 'p' } },
        };
        await ok('PUT', '/doc', doc);
        // Still green first through gamma 2, now at 80%.
        await waitForFirstPixel([51, 204, 0], 'the profile brightness over the xLights curve');
    });

    it('goes out straight when a profile says so', async () => {
        const doc: TestTweakDoc = {
            ...emptyDoc(),
            profiles: [{ id: 'p', name: 'Straight', brightness: 100, gamma: 1, colorOrder: 'RGB' }],
            models: { Line1: { profile: 'p' } },
        };
        await ok('PUT', '/doc', doc);
        await waitForFirstPixel([255, 128, 0], 'the profile in place of everything xLights has');
        await ok('PUT', '/doc', emptyDoc());
        await waitForFirstPixel([32, 128, 0], 'back to xLights with the profile gone');
        await ok('DELETE', '/test');
    });
});
