/** Test + Tweak end to end: run a test pattern on the fixture model over
 *  HTTP and see it at the mock controller, trim it with a saved tweak, bypass
 *  the tweak, rewire the model within its controller, and stop. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import type { TestTweakDoc, TestTweakSnapshot } from '@ezplayer/ezplayer-core';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

const CHANNELS = 150;
const PIXELS = 50;
let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;

type Reply = ({ ok: true } & TestTweakSnapshot) | { ok: false; error: string };

async function api(method: string, sub = '', body?: unknown): Promise<{ status: number; reply: Reply }> {
    const res = await fetch(`${app.base}/api/ezp/testtweak${sub}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, reply: JSON.parse(text) as Reply };
}

async function ok(method: string, sub = '', body?: unknown): Promise<TestTweakSnapshot> {
    const { status, reply } = await api(method, sub, body);
    expect(status, JSON.stringify(reply)).toBe(200);
    if (!reply.ok) throw new Error(reply.error);
    return reply;
}

const px = (bytes: Uint8Array, i: number) => Array.from(bytes.subarray(i * 3, i * 3 + 3));

async function waitForWire(pred: (bytes: Uint8Array) => boolean, label: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const bytes = mock.ddp.channelRange(0, CHANNELS);
        if (pred(bytes)) return bytes;
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${label}; wire=${Array.from(bytes.subarray(0, 9))}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

const emptyDoc = (): TestTweakDoc => ({ version: 1, models: {}, groups: [], presets: [] });
const solid = { kind: 'solid', colors: ['#204060'], intensity: 1 };

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    show = await createFixtureShow({ channels: CHANNELS });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await mock?.stop();
    await show?.cleanup();
});

describe('test + tweak', () => {
    it('describes the show', async () => {
        const snap = await ok('GET');
        expect(snap.doc).toEqual(emptyDoc());
        expect(snap.models.map((m) => [m.name, m.nodeCount, m.pixel])).toEqual([['Line1', PIXELS, true]]);
        expect(snap.controllers.length).toBe(1);
        expect(snap.status.active).toBeUndefined();
    });

    it('refuses a test with nothing to paint', async () => {
        const { status, reply } = await api('POST', '/test', { targets: { models: ['Nope'] }, pattern: solid });
        expect(status).toBe(400);
        expect(reply.ok).toBe(false);
        const bad = await api('POST', '/test', { targets: { models: ['Line1'] }, pattern: { kind: 'sparkle' } });
        expect(bad.status).toBe(400);
    });

    it('paints a solid color on the model while idle', async () => {
        const snap = await ok('POST', '/test', { targets: { models: ['Line1'] }, pattern: solid });
        expect(snap.status.activeModels).toEqual(['Line1']);
        const wire = await waitForWire(
            (b) => b[0] === 0x20 && b[1] === 0x40 && b[2] === 0x60,
            'solid test on the wire',
        );
        expect(px(wire, PIXELS - 1)).toEqual([0x20, 0x40, 0x60]);
    });

    it('applies a saved tweak to what goes out, through a group too', async () => {
        const doc: TestTweakDoc = {
            ...emptyDoc(),
            models: { Line1: { colorOrder: 'BGR' } },
            groups: [{ id: 'g1', name: 'Everything', models: ['Line1'], tweak: { brightness: 50 } }],
        };
        const snap = await ok('PUT', '/doc', doc);
        expect(snap.doc).toEqual(doc);
        // Half brightness, then blue first on the wire.
        await waitForWire((b) => b[0] === 0x30 && b[1] === 0x20 && b[2] === 0x10, 'tweaked test on the wire');
        const saved = JSON.parse(
            await fsp.readFile(path.join(show.dir, '.ezplayer', 'testtweak.json'), 'utf8'),
        ) as TestTweakDoc;
        expect(saved.models.Line1.colorOrder).toBe('BGR');
    });

    it('bypasses the tweak for the test when asked, and targets a group', async () => {
        await ok('POST', '/test', { targets: { groups: ['g1'] }, pattern: solid, bypassTweaks: true });
        await waitForWire((b) => b[0] === 0x20 && b[1] === 0x40 && b[2] === 0x60, 'untweaked test on the wire');
        await ok('POST', '/test', { targets: { groups: ['g1'] }, pattern: solid });
        await waitForWire((b) => b[0] === 0x30 && b[1] === 0x20 && b[2] === 0x10, 'tweak back on the wire');
    });

    it('rewires the model in position order and tells the controller upload about it', async () => {
        const controller = (await ok('GET')).controllers[0].name;
        const doc: TestTweakDoc = {
            ...emptyDoc(),
            models: {
                Line1: {
                    chunks: [
                        { nodeStart: 0, nodeCount: 25, controller, port: 1, order: 20 },
                        { nodeStart: 25, nodeCount: 25, controller, port: 1, order: 10 },
                    ],
                },
            },
        };
        const snap = await ok('PUT', '/doc', doc);
        expect(snap.problems).toEqual([]);
        expect(snap.rewired).toEqual(['Line1']);

        // First pixel of the wiring green, last red: the second half now leads on the wire.
        await ok('POST', '/test', { targets: { all: true }, pattern: { kind: 'markers', every: 1000 } });
        const wire = await waitForWire(
            (b) => px(b, 25).join() === '0,255,0' && px(b, 24).join() === '255,0,0',
            'rewired markers on the wire',
        );
        expect(px(wire, 0)).toEqual([0, 0, 0]);
        expect(px(wire, PIXELS - 1)).toEqual([0, 0, 0]);

        const res = await fetch(`${app.base}/api/ezp/controllers`);
        expect(res.status).toBe(200);
        const text = await res.text();
        const state = JSON.parse(text) as {
            known?: {
                name: string;
                modelIntents?: { name: string; controllerPort: number; startChannel: number; nodeCount: number }[];
            }[];
        };
        const intents = state.known?.find((k) => k.name === controller)?.modelIntents ?? [];
        expect(
            intents.map((i) => [i.name, i.controllerPort, i.startChannel, i.nodeCount]),
            text.slice(0, 400),
        ).toEqual([
            ['Line1', 1, 1, 25],
            ['Line1', 1, 76, 25],
        ]);
    });

    it('reports wiring that does not cover the model and keeps the xLights wiring', async () => {
        const controller = (await ok('GET')).controllers[0].name;
        const snap = await ok('PUT', '/doc', {
            ...emptyDoc(),
            models: { Line1: { chunks: [{ nodeStart: 0, nodeCount: 25, controller, port: 1, order: 10 }] } },
        });
        expect(snap.rewired).toEqual([]);
        expect(snap.problems.length).toBe(1);
        await waitForWire(
            (b) => px(b, 0).join() === '0,255,0' && px(b, PIXELS - 1).join() === '255,0,0',
            'markers back in layout order',
        );
    });

    it('goes dark when stopped', async () => {
        const snap = await ok('DELETE', '/test');
        expect(snap.status.active).toBeUndefined();
        await waitForWire((b) => b.every((v) => v === 0), 'black after stop');
        await ok('PUT', '/doc', emptyDoc());
    });
});
