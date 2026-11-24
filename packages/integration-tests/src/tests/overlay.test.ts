/** Overlay leases end to end: open a lease on the fixture model over HTTP,
 *  push a payload by PUT and by UDP, and see those pixels at the mock
 *  controller while the player is idle. Closing the lease returns the wire
 *  to black. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { packetizeOverlayFrame } from '@ezplayer/epp';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

const CHANNELS = 150;
let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;

interface Lease {
    id: number;
    token: number;
    frameBytes: number;
    nodeCount: number;
    format: string;
}

async function waitForWire(pred: (bytes: Uint8Array) => boolean, label: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const bytes = mock.ddp.channelRange(0, CHANNELS);
        if (pred(bytes)) return bytes;
        if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}; wire=${Array.from(bytes.subarray(0, 9))}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

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

// A lease a failed attempt left behind would refuse the retry's exclusive open.
beforeEach(async () => {
    const { leases = [] } = (await (await fetch(`${app.base}/api/ezp/overlays`)).json()) as { leases?: Lease[] };
    for (const l of leases) await fetch(`${app.base}/api/ezp/overlays/${l.id}?token=${l.token}`, { method: 'DELETE' });
});

describe('overlay leases', () => {
    it('lists the fixture model as a target', async () => {
        const res = await fetch(`${app.base}/api/ezp/overlays/targets`);
        const text = await res.text();
        expect(res.status, text).toBe(200);
        const body = JSON.parse(text) as { ok: boolean; targets: { model: string; nodeCount: number }[] };
        expect(body.ok).toBe(true);
        expect(body.targets).toEqual([{ model: 'Line1', nodeCount: 50 }]);
    });

    it('paints the model by PUT, then by UDP, then goes dark when closed', async () => {
        const open = await fetch(`${app.base}/api/ezp/overlays`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'Line1', format: 'nodes', mode: 'exclusive', name: 'it-overlay' }),
        });
        expect(open.status).toBe(200);
        const opened = (await open.json()) as { ok: boolean; lease: Lease; udpPort: number };
        expect(opened.ok).toBe(true);
        const lease = opened.lease;
        expect(lease.frameBytes).toBe(CHANNELS);
        expect(opened.udpPort).toBe(4049);

        // PUT: node i = (i, 255-i, 7)
        const payload = new Uint8Array(CHANNELS);
        for (let n = 0; n < 50; ++n) {
            payload[n * 3] = n;
            payload[n * 3 + 1] = 255 - n;
            payload[n * 3 + 2] = 7;
        }
        const put = await fetch(`${app.base}/api/ezp/overlays/${lease.id}/frame?token=${lease.token}&seq=1`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body: payload,
        });
        expect(put.status).toBe(200);
        const wire = await waitForWire((b) => b[1] === 255 && b[2] === 7 && b[3] === 1, 'PUT overlay on the wire');
        expect(Array.from(wire)).toEqual(Array.from(payload));

        // UDP: all nodes (9, 8, 200)
        const payload2 = new Uint8Array(CHANNELS);
        for (let n = 0; n < 50; ++n) payload2.set([9, 8, 200], n * 3);
        const sock = dgram.createSocket('udp4');
        for (const p of packetizeOverlayFrame(lease.id, lease.token, 2, payload2)) {
            await new Promise<void>((resolve, reject) => sock.send(p, opened.udpPort, '127.0.0.1', (e) => (e ? reject(e) : resolve())));
        }
        sock.close();
        const wire2 = await waitForWire((b) => b[0] === 9 && b[2] === 200, 'UDP overlay on the wire');
        expect(Array.from(wire2)).toEqual(Array.from(payload2));

        // A wrong token is refused.
        const bad = await fetch(`${app.base}/api/ezp/overlays/${lease.id}/keepalive?token=${lease.token ^ 1}`, { method: 'POST' });
        expect(bad.status).toBe(400);

        const list = (await (await fetch(`${app.base}/api/ezp/overlays`)).json()) as { leases: { id: number; frames: number }[] };
        expect(list.leases.find((l) => l.id === lease.id)?.frames).toBe(2);

        const close = await fetch(`${app.base}/api/ezp/overlays/${lease.id}?token=${lease.token}`, { method: 'DELETE' });
        expect(close.status).toBe(200);
        await waitForWire((b) => b.every((v) => v === 0), 'black after close');
    });

    it('refuses a second exclusive lease on the model with 409 and names the holder; a layer gets through', async () => {
        const open = (body: object) =>
            fetch(`${app.base}/api/ezp/overlays`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        const close = (l: Lease) => fetch(`${app.base}/api/ezp/overlays/${l.id}?token=${l.token}`, { method: 'DELETE' });

        const first = await open({ model: 'Line1', format: 'nodes', mode: 'exclusive', name: 'first game' });
        expect(first.status).toBe(200);
        const held = ((await first.json()) as { lease: Lease }).lease;

        const second = await open({ model: 'Line1', format: 'nodes', mode: 'exclusive', name: 'second game' });
        expect(second.status).toBe(409);
        const refused = (await second.json()) as { ok: boolean; error: string; code?: string; heldBy?: { id: number; name: string } };
        expect(refused.ok).toBe(false);
        expect(refused.code).toBe('conflict');
        expect(refused.error).toBe('Line1 is in use by first game');
        expect(refused.heldBy?.id).toBe(held.id);
        expect(refused.heldBy?.name).toBe('first game');

        // A whole-display lease covers the model too.
        const whole = await open({ format: 'nodes', mode: 'exclusive', name: 'everything' });
        expect(whole.status).toBe(409);

        const layer = await open({ model: 'Line1', format: 'nodes', mode: 'layer', name: 'glow' });
        expect(layer.status).toBe(200);
        const glow = ((await layer.json()) as { lease: Lease }).lease;

        // Both fields are required.
        const noMode = await open({ model: 'Line1', format: 'nodes', name: 'nameless mode' });
        expect(noMode.status).toBe(400);
        expect(await noMode.text()).toContain('mode');
        const noName = await open({ model: 'Line1', format: 'nodes', mode: 'exclusive' });
        expect(noName.status).toBe(400);
        expect(await noName.text()).toContain('name');

        // Closing the holder frees the model.
        expect((await close(held)).status).toBe(200);
        const again = await open({ model: 'Line1', format: 'nodes', mode: 'exclusive', name: 'second game' });
        expect(again.status).toBe(200);
        await close(((await again.json()) as { lease: Lease }).lease);
        await close(glow);
    });
});
