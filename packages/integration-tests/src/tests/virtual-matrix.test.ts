/** Virtual matrix end to end: the /matrix page is served, a reader that asks
 *  for the frame after the one it has gets it when it exists, and the status
 *  route reports who is reading and how fast. */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VirtualMatrixStatus } from '@ezplayer/ezplayer-core';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

let show: FixtureShow;
let app: EzPlayerProc;

interface Frame {
    status: number;
    width: number;
    height: number;
    seq: number;
    ms: number;
}

async function frame(query = '', model = 'Line1'): Promise<Frame> {
    const t0 = performance.now();
    const res = await fetch(`${app.base}/api/ezp/pool/model/${model}${query}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const ms = performance.now() - t0;
    if (res.status !== 200) return { status: res.status, width: 0, height: 0, seq: 0, ms };
    return { status: 200, width: buf.readUInt16LE(0), height: buf.readUInt16LE(2), seq: buf.readUInt32LE(4), ms };
}

/** The player composes frames a moment after it starts. */
async function firstFrame(): Promise<Frame> {
    const deadline = Date.now() + 15_000;
    for (;;) {
        const f = await frame();
        if (f.status === 200) return f;
        if (Date.now() > deadline) throw new Error(`no frame for Line1; last status ${f.status}`);
        await new Promise((r) => setTimeout(r, 200));
    }
}

beforeAll(async () => {
    show = await createFixtureShow({ channels: 150 });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

describe('virtual matrix', () => {
    it('serves the page', async () => {
        const res = await fetch(`${app.base}/matrix?model=Line1`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('text/html');
        expect(await res.text()).toContain('/api/ezp/pool/model/');
    });

    it('serves a model as a picture of its nodes', async () => {
        const f = await firstFrame();
        expect(f.width).toBe(50);
        expect(f.height).toBe(1);
        expect(f.seq).toBeGreaterThan(0);
        expect((await frame('', 'NoSuchModel')).status).toBe(404);
    });

    it('answers a reader that waits with the next frame, not the one it has', async () => {
        let f = await firstFrame();
        // Follow the frames the way the page does.
        const end = Date.now() + 2000;
        while (Date.now() < end) {
            const next = await frame(`?after=${f.seq}&wait=1000`);
            if (next.status === 204) {
                // Nothing newer arrived: the player held the request rather than answer at once.
                expect(next.ms).toBeGreaterThan(800);
                continue;
            }
            expect(next.status).toBe(200);
            expect(next.seq).not.toBe(f.seq);
            f = next;
        }
        // Without wait, the frame already held is an immediate "nothing new".
        const again = await frame(`?after=${f.seq}`);
        if (again.status === 204) expect(again.ms).toBeLessThan(500);
    });

    it('reports who is reading and how fast', async () => {
        let f = await firstFrame();
        let painted = 0;
        const end = Date.now() + 2500;
        while (Date.now() < end) {
            const next = await frame(`?after=${f.seq}&wait=500&client=it-reader&out=vm-it&painted=${painted}`);
            if (next.status === 200) {
                f = next;
                painted++;
            }
        }
        const res = await fetch(`${app.base}/api/ezp/matrix/status`);
        expect(res.status).toBe(200);
        const status = (await res.json()) as VirtualMatrixStatus;
        const mine = status.readers.find((r) => r.output === 'vm-it');
        expect(mine, JSON.stringify(status.readers)).toBeTruthy();
        expect(mine).toMatchObject({ model: 'Line1', address: 'local' });
        expect(mine!.idleMs).toBeLessThan(2000);
        // What was sent is what this reader counted, and it cannot exceed what was made.
        expect(mine!.servedFps).toBeLessThanOrEqual(mine!.sourceFps + 1);
        expect(mine!.paintedFps).toBeDefined();
        expect(Math.abs(mine!.paintedFps! - mine!.servedFps)).toBeLessThan(3);
        expect(Array.isArray(status.lanUrls)).toBe(true);
    });
});
