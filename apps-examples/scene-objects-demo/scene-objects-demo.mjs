// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Scene objects demo, as an EZPlayer app.
 *
 * Puts three display-only objects into the Show View and animates them: a
 * beam that sweeps and changes color, a cloud of sparkles that breathes, and
 * an orbiting sphere with a small box riding on it. Phones (or show inputs)
 * start and stop it; the objects sit on short leases and disappear when it
 * stops.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings come from the instance's private data key "settings":
 *   centerX, centerY  where the objects sit, in world units; blank fits the layout
 *   size              how far they spread, in world units; blank fits the layout
 *   autoStart         start as soon as the app starts
 */

const base = (process.env.EZP_API_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const instance = process.env.EZP_APP_INSTANCE;
const token = process.env.EZP_APP_TOKEN;
if (!instance || !token) {
    console.error('EZP_APP_INSTANCE and EZP_APP_TOKEN must be set (this program is started by the player)');
    process.exit(1);
}

const authHeaders = { 'x-ezp-app-token': token };
const jsonHeaders = { ...authHeaders, 'content-type': 'application/json' };
const appUrl = (path) => `${base}/api/ezp/apps/${encodeURIComponent(instance)}${path}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Object keys carry the instance name so two instances do not fight over the same objects.
const KEY_PREFIX = instance.replace(/[^A-Za-z0-9._~-]/g, '-').slice(0, 40);
const TTL_MS = 3000;
const TICK_MS = 50;

async function send(method, key, body) {
    const res = await fetch(`${base}/api/ezp/objects/${key}`, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok && res.status !== 404) throw new Error(`${method} ${key}: ${res.status} ${await res.text()}`);
    return res.status;
}

// ---------------------------------------------------------------------------
// Where the objects go
// ---------------------------------------------------------------------------

/** Extent of the node positions ({wX, wY}) found in a JSON value, leaving out the outermost few percent. */
function boundsOf(value) {
    const xs = [];
    const ys = [];
    const walk = (v) => {
        if (!v || typeof v !== 'object') return;
        if (typeof v.wX === 'number' && typeof v.wY === 'number') {
            xs.push(v.wX);
            ys.push(v.wY);
        }
        for (const child of Array.isArray(v) ? v : Object.values(v)) walk(child);
    };
    walk(value);
    if (!xs.length) return undefined;
    xs.sort((p, q) => p - q);
    ys.sort((p, q) => p - q);
    const at = (a, f) => a[Math.min(a.length - 1, Math.floor(a.length * f))];
    return { minX: at(xs, 0.03), maxX: at(xs, 0.97), minY: at(ys, 0.03) };
}

/** Center and size from the settings, with blanks fitted to the layout (or 0, 0, 400 without one). */
async function fitScene(settings) {
    let fit;
    if (!(settings.centerX !== undefined && settings.centerY !== undefined && settings.size)) {
        try {
            const res = await fetch(`${base}/api/ezp/model-coordinates`);
            fit = res.ok ? boundsOf(await res.json()) : undefined;
        } catch {
            fit = undefined;
        }
    }
    return {
        cx: settings.centerX ?? (fit ? (fit.minX + fit.maxX) / 2 : 0),
        cy: settings.centerY ?? (fit ? fit.minY : 0),
        size: settings.size ?? (fit ? Math.max(fit.maxX - fit.minX, 100) : 400),
    };
}

// ---------------------------------------------------------------------------
// The objects
// ---------------------------------------------------------------------------

function createScene({ cx, cy, size }) {
    const key = (name) => `${KEY_PREFIX}-${name}`;
    const WAND = key('wand');
    const SPARKLE = key('sparkle');
    const ORBITER = key('orbiter');

    /** What each object is; sent at start and again whenever a lease was lost. */
    function definitions() {
        const positions = [];
        const colors = [];
        for (let i = 0; i < 400; i++) {
            positions.push(
                (Math.random() - 0.5) * size,
                (Math.random() - 0.5) * size * 0.3,
                (Math.random() - 0.5) * 40,
            );
            colors.push(180 + Math.random() * 75, 180 + Math.random() * 75, 120 + Math.random() * 135);
        }
        return {
            [WAND]: {
                content: { type: 'beam', length: size * 1.2, angle: 4 },
                placement: { position: [cx, cy + size * 0.1, size] },
                appearance: { color: '#00d0ff' },
            },
            [SPARKLE]: {
                content: { type: 'points', positions, colors, size: size / 80, smooth: true },
                placement: { position: [cx, cy + size * 0.6, 0] },
            },
            [ORBITER]: {
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
            [WAND]: {
                placement: { direction: [Math.sin(t * 0.9) * 0.5, 0.25 + Math.sin(t * 0.6) * 0.15, -1] },
                appearance: { color: Math.sin(t * 0.3) > 0 ? '#00d0ff' : '#ffb020' },
            },
            [SPARKLE]: { appearance: { opacity: 0.6 + 0.4 * Math.sin(t * 2) } },
            [ORBITER]: {
                placement: {
                    position: [cx + Math.cos(t) * size * 0.4, cy + size * 0.3 + Math.sin(t) * size * 0.15, 0],
                    rotation: [0, 0, (t * 90) % 360],
                },
            },
        };
    }

    /** What the phone page shows about each object right now. */
    function snapshot(t) {
        const m = motion(t);
        return [
            { name: 'Wand', kind: 'beam', detail: `color ${m[WAND].appearance.color}` },
            { name: 'Sparkle', kind: '400 points', detail: `opacity ${m[SPARKLE].appearance.opacity.toFixed(2)}` },
            { name: 'Orbiter', kind: 'group', detail: `angle ${Math.round(m[ORBITER].placement.rotation[2])} deg` },
        ];
    }

    const defs = definitions();
    return { defs, motion, snapshot, keys: Object.keys(defs) };
}

// ---------------------------------------------------------------------------
// Player API: settings, events, status
// ---------------------------------------------------------------------------

const finite = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

async function loadSettings() {
    const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
    if (res.status === 404) return { autoStart: false };
    if (!res.ok) throw new Error(`settings: HTTP ${res.status}`);
    const s = (await res.json()) ?? {};
    const size = finite(Number(s.size));
    return {
        centerX: finite(Number(s.centerX)),
        centerY: finite(Number(s.centerY)),
        size: size && size > 0 ? size : undefined,
        autoStart: s.autoStart === true,
    };
}

async function publishStatus(status) {
    await fetch(appUrl('/status'), { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(status) }).catch(
        () => undefined,
    );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    let quit = false;
    const poll = new AbortController();
    const stop = () => {
        quit = true;
        poll.abort();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);

    let settings = null;
    let settingsError = '';
    let lastSettingsAt = -Infinity;
    let autoStarted = false;
    let phase = 'idle'; // idle | playing
    let message = 'Starting up';
    let scene = null;
    let place = null;
    let pending = null; // 'start' | 'stop' asked for by an event
    let startedAt = 0;
    let patches = 0;
    let relaunches = 0;
    const processStart = Date.now();

    const release = async () => {
        const s = scene;
        scene = null;
        place = null;
        if (s) await Promise.allSettled(s.keys.map((key) => send('DELETE', key)));
    };

    const start = async () => {
        await release();
        place = await fitScene(settings);
        scene = createScene(place);
        for (const [key, def] of Object.entries(scene.defs)) await send('PUT', key, { ttlMs: TTL_MS, ...def });
        startedAt = Date.now();
        patches = 0;
        relaunches = 0;
        phase = 'playing';
        message = 'Running';
        console.log(
            `Injected ${scene.keys.length} objects around (${Math.round(place.cx)}, ${Math.round(place.cy)}), size ${Math.round(place.size)}`,
        );
    };

    const handleEvent = (ev) => {
        const d = ev?.data;
        const type = d?.type === 'input' ? d.input : d?.type;
        if (type === 'start' || type === 'stop') pending = type;
    };

    const pollEvents = async () => {
        let since = 0;
        while (!quit) {
            try {
                const res = await fetch(appUrl(`/events?since=${since}&wait=30`), {
                    headers: authHeaders,
                    signal: poll.signal,
                });
                if (!res.ok) throw new Error(`events: HTTP ${res.status}`);
                const { events = [] } = await res.json();
                for (const ev of events) {
                    since = Math.max(since, ev.id);
                    // Taps queued before this process started are stale.
                    if (ev.ts >= processStart - 2000) handleEvent(ev);
                }
            } catch (e) {
                if (quit) return;
                console.log(`events: ${e.message}`);
                await sleep(2000);
            }
        }
    };
    void pollEvents();

    let lastStatusJson = '';
    let lastStatusAt = 0;

    while (!quit) {
        const now = Date.now();

        // Settings are re-read while idle so the owner can move the objects without a restart.
        if (phase !== 'playing' && now - lastSettingsAt > 5000) {
            lastSettingsAt = now;
            try {
                settings = await loadSettings();
                settingsError = '';
                if (settings.autoStart && !autoStarted && !pending) pending = 'start';
                autoStarted = true;
            } catch (e) {
                settings = null;
                settingsError = `Player not reachable: ${e.message}`;
            }
        }

        if (pending) {
            const type = pending;
            pending = null;
            if (type === 'start' && phase !== 'playing' && settings) {
                try {
                    await start();
                } catch (e) {
                    message = `Could not start: ${e.message}`;
                    console.log(message);
                    await release();
                    phase = 'idle';
                }
            } else if (type === 'stop' && phase === 'playing') {
                await release();
                phase = 'idle';
                message = 'Stopped';
            }
        }

        let t = 0;
        if (phase === 'playing') {
            t = (now - startedAt) / 1000;
            try {
                for (const [key, patch] of Object.entries(scene.motion(t))) {
                    patches++;
                    // A 404 means the lease ran out (say the player restarted): define it again.
                    if ((await send('PATCH', key, patch)) === 404) {
                        relaunches++;
                        await send('PUT', key, { ttlMs: TTL_MS, ...scene.defs[key], ...patch });
                    }
                }
                message = 'Running';
            } catch (e) {
                message = `Player not reachable: ${e.message}`;
            }
        }

        const status = {
            phase,
            message: settingsError || message,
            runningMs: phase === 'playing' ? now - startedAt : 0,
            center: place ? [Math.round(place.cx), Math.round(place.cy)] : null,
            size: place ? Math.round(place.size) : null,
            patches,
            relaunches,
            objects: scene ? scene.snapshot(t) : [],
        };
        const json = JSON.stringify(status);
        // Only changes, at most twice a second, plus a heartbeat.
        if ((json !== lastStatusJson && now - lastStatusAt >= 500) || now - lastStatusAt > 2000) {
            lastStatusJson = json;
            lastStatusAt = now;
            void publishStatus(status);
        }
        await sleep(phase === 'playing' ? TICK_MS : 250);
    }

    await release();
    await publishStatus({
        phase: 'idle',
        message: 'App stopped',
        runningMs: 0,
        center: null,
        size: null,
        patches,
        relaunches,
        objects: [],
    });
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
