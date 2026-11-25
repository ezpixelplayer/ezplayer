/** Temporary benchmark: does frame traffic from 500 leases starve other requests to the player? */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import dgram from 'node:dgram';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';

const N = 500;
const INTERVAL = 50; // 20 fps
let show: FixtureShow;
let app: EzPlayerProc;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Lease = { id: number; token: number; frameBytes: number };

beforeAll(async () => {
    const subs = Array.from(
        { length: N },
        (_, i) => `<subModel name="S${String(i + 1).padStart(3, '0')}" layout="horizontal" type="ranges" line0="${i + 1}"/>`,
    ).join('');
    show = await createFixtureShow({ channels: N * 3, subModelsXml: subs });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
});

async function waitTargets(): Promise<{ target: string }[]> {
    for (let i = 0; i < 120; i++) {
        const r = await fetch(`${app.base}/api/ezp/overlays/targets?model=Line1&detail=submodels`).catch(() => null);
        if (r?.ok) {
            const b = (await r.json()) as { targets?: { target?: string; subModel?: string }[] };
            const subs = (b.targets ?? []).filter((t) => t.subModel) as { target: string }[];
            if (subs.length >= N) return subs;
        }
        await sleep(500);
    }
    throw new Error('targets never appeared');
}

async function openAll(targets: { target: string }[]): Promise<{ leases: Lease[]; udpPort: number; ms: number }> {
    const leases: Lease[] = [];
    let udpPort = 0;
    let k = 0;
    const t0 = performance.now();
    await Promise.all(
        Array.from({ length: 8 }, async () => {
            while (k < targets.length) {
                const t = targets[k++];
                const r = await fetch(`${app.base}/api/ezp/overlays`, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ model: t.target, format: 'nodes', mode: 'layer', name: 'bench', blend: 'replace', ttlMs: 15000 }),
                });
                const b = (await r.json()) as { ok: boolean; error?: string; lease: Lease; udpPort: number };
                if (!b.ok) throw new Error(b.error);
                udpPort = b.udpPort;
                leases.push(b.lease);
            }
        }),
    );
    return { leases, udpPort, ms: performance.now() - t0 };
}

async function probeLoop(path: string, stop: () => boolean) {
    const p = { n: 0, sum: 0, max: 0, fail: 0 };
    while (!stop()) {
        const t = performance.now();
        const r = await fetch(`${app.base}${path}`).catch(() => null);
        if (!r?.ok) p.fail++;
        else await r.text();
        const d = performance.now() - t;
        p.n++;
        p.sum += d;
        p.max = Math.max(p.max, d);
        await sleep(250);
    }
    return { avgMs: p.n ? Math.round(p.sum / p.n) : 0, maxMs: Math.round(p.max), n: p.n, fail: p.fail };
}

async function run(label: string, send: (l: Lease, seq: number) => Promise<void>, leases: Lease[], seconds = 6) {
    let stop = false;
    const probes = [probeLoop('/api/ezp/time', () => stop), probeLoop('/api/ezp/overlays', () => stop)];
    const t0 = performance.now();
    let due = t0;
    let frames = 0;
    let late = 0;
    let seq = 0;
    let frameMs = 0;
    let maxMs = 0;
    while (performance.now() - t0 < seconds * 1000) {
        const now = performance.now();
        if (due - now > 1) {
            await sleep(due - now);
            continue;
        }
        const start = performance.now();
        if (start - due > INTERVAL) {
            late++;
            due = start;
        }
        seq++;
        await Promise.all(leases.map((l) => send(l, seq)));
        const d = performance.now() - start;
        frameMs += d;
        maxMs = Math.max(maxMs, d);
        frames++;
        due += INTERVAL;
    }
    stop = true;
    const [time, list] = await Promise.all(probes);
    return {
        label,
        fps: Math.round((frames / seconds) * 10) / 10,
        frameMsAvg: Math.round(frameMs / frames),
        frameMsMax: Math.round(maxMs),
        late,
        timeProbe: time,
        listProbe: list,
    };
}

describe('overlay frame load', () => {
    it('measures frame rate and side-request latency with 500 leases', async () => {
        const targets = await waitTargets();
        const { leases, udpPort, ms } = await openAll(targets.slice(0, N));
        console.log(`opened ${leases.length} leases in ${Math.round(ms)} ms`);

        const payload = Buffer.alloc(3, 128);
        const sendHttp = async (l: Lease, seq: number) => {
            await fetch(`${app.base}/api/ezp/overlays/${l.id}/frame?token=${l.token}&seq=${seq}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/octet-stream' },
                body: payload,
            })
                .then((r) => r.arrayBuffer())
                .catch(() => undefined);
        };
        // At most `limit` PUTs in flight per frame.
        const pooled = (limit: number) => {
            let active = 0;
            const q: (() => void)[] = [];
            return async (l: Lease, seq: number) => {
                if (active >= limit) await new Promise<void>((r) => q.push(r));
                active++;
                try {
                    await sendHttp(l, seq);
                } finally {
                    active--;
                    q.shift()?.();
                }
            };
        };
        const sock = dgram.createSocket('udp4');
        const sendUdp = (l: Lease, seq: number) =>
            new Promise<void>((r) => {
                const p = Buffer.alloc(24 + 3);
                p.writeUInt32BE(0x455a4f31, 0);
                p.writeUInt32BE(l.id, 4);
                p.writeUInt32BE(l.token, 8);
                p.writeUInt32BE(seq, 12);
                p.writeUInt8(1, 16);
                p.writeUInt32BE(0, 17);
                p.writeUInt16BE(3, 21);
                p.set(payload, 24);
                sock.send(p, udpPort, '127.0.0.1', () => r());
            });

        const results = [];
        results.push(await run('idle (no frames)', async () => undefined, []));
        results.push(await run('http, all in flight', sendHttp, leases));
        results.push(await run('http, 16 in flight', pooled(16), leases));
        results.push(await run('udp', sendUdp, leases));
        sock.close();
        console.log(JSON.stringify(results, null, 1));
        await Promise.allSettled(leases.map((l) => fetch(`${app.base}/api/ezp/overlays/${l.id}?token=${l.token}`, { method: 'DELETE' })));
        expect(results.length).toBe(4);
    }, 180_000);
});
