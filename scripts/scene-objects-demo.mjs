#!/usr/bin/env node
/*
 * Scene objects demo: injects a few display-only objects into a running
 * EZPlayer's Show View and animates them until interrupted.
 *
 *   node scripts/scene-objects-demo.mjs [http://localhost:3000] [centerX centerY size]
 *
 * The objects sit around (centerX, centerY) and span about `size` world units.
 * Stop the script and they disappear when their leases run out.
 */

const base = (process.argv[2] ?? 'http://localhost:3000').replace(/\/+$/, '');
const cx = Number(process.argv[3] ?? 0);
const cy = Number(process.argv[4] ?? 0);
const size = Number(process.argv[5] ?? 400);
const TTL_MS = 3000;

async function send(method, key, body) {
    const res = await fetch(`${base}/api/ezp/objects/${key}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${key}: ${res.status} ${await res.text()}`);
    return res.status;
}

/** What each object is; sent at start and again whenever a lease was lost. */
function definitions() {
    const positions = [];
    const colors = [];
    for (let i = 0; i < 400; i++) {
        positions.push((Math.random() - 0.5) * size, (Math.random() - 0.5) * size * 0.3, (Math.random() - 0.5) * 40);
        colors.push(180 + Math.random() * 75, 180 + Math.random() * 75, 120 + Math.random() * 135);
    }
    return {
        'demo-wand': {
            content: { type: 'beam', length: size * 1.2, angle: 4 },
            placement: { position: [cx, cy + size * 0.1, size] },
            appearance: { color: '#00d0ff' },
        },
        'demo-sparkle': {
            content: { type: 'points', positions, colors, size: size / 80, smooth: true },
            placement: { position: [cx, cy + size * 0.6, 0] },
        },
        'demo-orbiter': {
            content: {
                type: 'group',
                children: [
                    { content: { type: 'shape', shape: 'sphere', size: size / 10 } },
                    {
                        placement: { position: [size / 8, 0, 0] },
                        appearance: { color: '#ffffff' },
                        content: { type: 'shape', shape: 'box', size: size / 30 },
                    },
                ],
            },
            appearance: { color: '#ff8000' },
        },
    };
}

/** Where each object is at time t (seconds). */
function motion(t) {
    return {
        'demo-wand': {
            placement: { direction: [Math.sin(t * 0.9) * 0.5, 0.25 + Math.sin(t * 0.6) * 0.15, -1] },
            appearance: { color: Math.sin(t * 0.3) > 0 ? '#00d0ff' : '#ffb020' },
        },
        'demo-sparkle': { appearance: { opacity: 0.6 + 0.4 * Math.sin(t * 2) } },
        'demo-orbiter': {
            placement: {
                position: [cx + Math.cos(t) * size * 0.4, cy + size * 0.3 + Math.sin(t) * size * 0.15, 0],
                rotation: [0, 0, (t * 90) % 360],
            },
        },
    };
}

const defs = definitions();
for (const [key, def] of Object.entries(defs)) await send('PUT', key, { ttlMs: TTL_MS, ...def });
console.log(`Injected ${Object.keys(defs).length} objects into ${base}. Ctrl+C to stop.`);

const start = Date.now();
for (;;) {
    const t = (Date.now() - start) / 1000;
    for (const [key, patch] of Object.entries(motion(t))) {
        // A 404 means the lease ran out (say the player restarted): define it again.
        if ((await send('PATCH', key, patch)) === 404)
            await send('PUT', key, { ttlMs: TTL_MS, ...defs[key], ...patch });
    }
    await new Promise((r) => setTimeout(r, 50));
}
