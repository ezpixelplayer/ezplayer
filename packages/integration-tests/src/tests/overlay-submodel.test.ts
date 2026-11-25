/** Overlay leases on a submodel end to end: the inventory lists it only when
 *  asked, a lease on it paints just its nodes through its own buffer, and a
 *  node its lines name twice takes the cell the lease's rule picks. */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startMockController, type MockController } from '@ezplayer/epp-mock-controller';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

const CHANNELS = 150;
let mock: MockController;
let show: FixtureShow;
let app: EzPlayerProc;

interface Target {
    model: string;
    subModel?: string;
    target?: string;
    nodeCount: number;
    subModels?: number;
    kind?: string;
    strands?: number[];
    buffer?: { width: number; height: number };
    overlaps?: number;
    nodes?: { world?: number[]; cells?: number[] };
}

interface Lease {
    id: number;
    token: number;
    frameBytes: number;
    width: number;
    height: number;
    format: string;
    overlap?: string;
}

async function targets(query = ''): Promise<Target[]> {
    const res = await fetch(`${app.base}/api/ezp/overlays/targets${query}`);
    const text = await res.text();
    expect(res.status, text).toBe(200);
    return (JSON.parse(text) as { targets: Target[] }).targets;
}

async function open(body: object): Promise<Lease> {
    const res = await fetch(`${app.base}/api/ezp/overlays`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: 'exclusive', name: 'it-submodel', ...body }),
    });
    const text = await res.text();
    expect(res.status, text).toBe(200);
    return (JSON.parse(text) as { lease: Lease }).lease;
}

async function put(lease: Lease, payload: Uint8Array) {
    const res = await fetch(`${app.base}/api/ezp/overlays/${lease.id}/frame?token=${lease.token}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/octet-stream' },
        body: payload,
    });
    expect(res.status, await res.text()).toBe(200);
}

const close = (lease: Lease) =>
    fetch(`${app.base}/api/ezp/overlays/${lease.id}?token=${lease.token}`, { method: 'DELETE' });

async function waitForWire(pred: (node: (n: number) => number[]) => boolean, label: string, timeoutMs = 5000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const bytes = mock.ddp.channelRange(0, CHANNELS);
        const node = (n: number) => Array.from(bytes.subarray(n * 3, n * 3 + 3));
        if (pred(node)) return node;
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${label}; wire=${Array.from(bytes.subarray(0, 12))}`);
        await new Promise((r) => setTimeout(r, 100));
    }
}

beforeAll(async () => {
    mock = await startMockController({ channels: CHANNELS, ddpPort: 4048 });
    // Two rows: nodes 1-3, then nodes 48-50 followed by node 1 again.
    show = await createFixtureShow({
        channels: CHANNELS,
        subModelsXml: '<subModel name="Ends" layout="horizontal" type="ranges" line0="1-3" line1="48-50,1"/>',
    });
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

describe('overlay leases on a submodel', () => {
    it('lists submodels only when asked', async () => {
        expect(await targets()).toEqual([{ model: 'Line1', nodeCount: 50, subModels: 1 }]);
        const all = await targets('?detail=submodels');
        expect(all.map((t) => t.target)).toEqual(['Line1', 'Line1/Ends']);
        expect(all[1]).toMatchObject({
            subModel: 'Ends',
            nodeCount: 6,
            kind: 'multi',
            strands: [3, 4],
            buffer: { width: 4, height: 2 },
            overlaps: 1,
        });
        expect(all[1].nodes).toBeUndefined();
        const one = await targets('?model=Line1/Ends&detail=nodes');
        expect(one.length).toBe(1);
        expect(one[0].nodes!.cells!.length).toBe(7 * 3);
        expect(one[0].nodes!.world!.length).toBe(6 * 3);
    });

    it('paints only the submodel, and settles the node named twice', async () => {
        // Top row is line1 (48, 49, 50, 1); bottom row is line0 (1, 2, 3, nothing).
        const payload = Uint8Array.from([
            ...[48, 0, 0, 49, 0, 0, 50, 0, 0, 100, 0, 9],
            ...[1, 200, 0, 2, 0, 0, 3, 0, 0, 77, 77, 77],
        ]);
        const lease = await open({ model: 'Line1/Ends', name: 'it-submodel' });
        expect(lease).toMatchObject({ format: 'buffer', width: 4, height: 2, frameBytes: 24, overlap: 'last' });
        await put(lease, payload);
        const node = await waitForWire((n) => n(47)[0] === 48 && n(0)[0] === 100, 'submodel overlay on the wire');
        expect(node(0)).toEqual([100, 0, 9]);
        expect(node(1)).toEqual([2, 0, 0]);
        expect(node(2)).toEqual([3, 0, 0]);
        expect(node(48)).toEqual([49, 0, 0]);
        expect(node(49)).toEqual([50, 0, 0]);
        // The rest of the model is untouched.
        expect(node(3)).toEqual([0, 0, 0]);
        expect(node(46)).toEqual([0, 0, 0]);
        await close(lease);
        await waitForWire((n) => n(0)[0] === 0 && n(47)[0] === 0, 'black after close');

        const first = await open({ model: 'Line1', subModel: 'Ends', overlap: 'first' });
        await put(first, payload);
        expect((await waitForWire((n) => n(0)[0] === 1, 'first cell wins'))(0)).toEqual([1, 200, 0]);
        await close(first);

        const max = await open({ model: 'Line1/Ends', overlap: 'max' });
        await put(max, payload);
        expect((await waitForWire((n) => n(0)[0] === 100 && n(0)[1] === 200, 'brightest wins'))(0)).toEqual([
            100, 200, 9,
        ]);
        await close(max);
    });

    it('refuses a submodel that does not exist', async () => {
        const res = await fetch(`${app.base}/api/ezp/overlays`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ model: 'Line1/Middle', mode: 'exclusive', name: 'it-submodel' }),
        });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('Line1/Middle');
    });
});
