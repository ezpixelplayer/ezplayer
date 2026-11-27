// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Audio injection demo, as an EZPlayer app.
 *
 * Makes a few game-style sounds, uploads them as clips to a lease on one of
 * the player's audio buses, and plays them when phones (or show inputs) ask:
 * one sound per tap, a bar of drums scheduled on the player's clock, or a
 * short tune streamed as timed PCM packets over UDP into another bus. The
 * reply timings go to the status so the page can show how soon a sound starts.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings come from the instance's private data key "settings":
 *   bus      bus for the sound effects, default "immediate"
 *   volume   loudness of everything, 0-1, default 0.5
 *   tuneBus  bus the streamed tune goes to, default "main"; blank disables the tune
 */

import dgram from 'node:dgram';

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
const RATE = 48000;
const LEASE_TTL_MS = 30000;

// ---------------------------------------------------------------------------
// Audio API
// ---------------------------------------------------------------------------

/** Player clock minus this computer's clock, from the reply with the shortest round trip. */
let clockOffset = 0;
let bestTrip = Infinity;
const playerNow = () => Date.now() + clockOffset;

async function api(method, path, body) {
    const raw = body instanceof Uint8Array;
    const sent = Date.now();
    const res = await fetch(`${base}/api/ezp/audio${path}`, {
        method,
        headers: body ? { 'content-type': raw ? 'application/octet-stream' : 'application/json' } : undefined,
        body: raw ? body : body ? JSON.stringify(body) : undefined,
    });
    const reply = await res.json().catch(() => ({}));
    const trip = Date.now() - sent;
    if (!res.ok) {
        const err = new Error(`${method} ${path}: ${res.status} ${reply.error ?? ''}`.trim());
        err.status = res.status;
        throw err;
    }
    if (trip <= bestTrip && typeof reply.now === 'number') {
        bestTrip = trip;
        clockOffset = reply.now - (sent + trip / 2);
    }
    return reply;
}

// ---------------------------------------------------------------------------
// Sounds: mono floats at 48 kHz, sent as raw PCM
// ---------------------------------------------------------------------------

function sound(sec, fn) {
    const out = new Float32Array(Math.round(sec * RATE));
    for (let i = 0; i < out.length; i++) out[i] = fn(i / RATE, i / out.length);
    return new Uint8Array(out.buffer);
}
const TAU = Math.PI * 2;
let seed = 1;
const noise = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff - 1;

const clips = {
    // A sine that drops in pitch.
    kick: sound(0.25, (t, p) => Math.sin(TAU * (45 * t + (110 * (1 - Math.exp(-t * 30))) / 30)) * (1 - p) ** 2),
    // Noise with a fast decay.
    snare: sound(0.18, (t, p) => (noise() * 0.7 + Math.sin(TAU * 190 * t) * 0.3) * (1 - p) ** 3),
    hat: sound(0.05, (_t, p) => noise() * 0.4 * (1 - p) ** 4),
    // A sweep down, like a laser.
    zap: sound(0.3, (t, p) => Math.sin(TAU * (1800 * t - 2400 * t * t)) * (1 - p)),
    // Two rising tones.
    coin: sound(0.35, (t, p) => Math.sign(Math.sin(TAU * (t < 0.08 ? 988 : 1319) * t)) * 0.35 * (1 - p)),
};

// One bar of drums: eight steps of half a beat.
const BEAT_MS = 500;
const PATTERN = [
    ['kick', 'hat'],
    ['hat'],
    ['snare', 'hat'],
    ['hat'],
    ['kick', 'hat'],
    ['kick', 'hat'],
    ['snare', 'hat'],
    ['hat', 'coin'],
];

// ---------------------------------------------------------------------------
// The effects lease
// ---------------------------------------------------------------------------

/** { id, token, bus, leadMs } while open, plus the settings it was opened with. */
let fx = null;

async function openEffects(settings) {
    await closeEffects();
    const { lease } = await api('POST', '/leases', {
        bus: settings.bus,
        name: `audio-demo ${instance}`,
        sampleRate: RATE,
        channels: 1,
        encoding: 'f32le',
        gain: settings.volume,
        ttlMs: LEASE_TTL_MS,
    });
    for (const [name, pcm] of Object.entries(clips))
        await api('PUT', `/leases/${lease.id}/clips/${name}?token=${lease.token}`, pcm);
    fx = { ...lease, settings };
    console.log(`effects on ${lease.bus} (${lease.leadMs} ms lead): ${Object.keys(clips).join(', ')}`);
}

async function closeEffects() {
    const l = fx;
    fx = null;
    if (l) await api('DELETE', `/leases/${l.id}?token=${l.token}`).catch(() => undefined);
}

const call = (path, body) =>
    api(body instanceof Uint8Array ? 'PUT' : 'POST', `/leases/${fx.id}${path}?token=${fx.token}`, body);

// ---------------------------------------------------------------------------
// The tune: 20 ms packets with their play time, kept 1.5 s ahead of the clock
// ---------------------------------------------------------------------------

const NOTES = [262, 330, 392, 523, 392, 330, 294, 349, 440, 587, 440, 349];
const FRAMES = 960;
const TUNE_PASSES = 2;
const TUNE_PACKETS = (TUNE_PASSES * NOTES.length * (RATE / 4)) / FRAMES;

/** { lease, sock, timer, endsAt } while streaming. */
let tune = null;

async function startTune(settings) {
    if (tune) return;
    if (!settings.tuneBus) throw new Error('no tune bus set in the app settings');
    const opened = await api('POST', '/leases', {
        bus: settings.tuneBus,
        name: `audio-demo tune ${instance}`,
        sampleRate: RATE,
        channels: 1,
        encoding: 's16le',
        gain: settings.volume,
        ttlMs: LEASE_TTL_MS,
    });
    const sock = dgram.createSocket('udp4');
    const host = new URL(base).hostname;
    const t0 = playerNow() + 1500;
    let k = 0;
    let phase = 0;
    const timer = setInterval(() => {
        while (k < TUNE_PACKETS && t0 + k * 20 < playerNow() + 1500) {
            const p = Buffer.alloc(24 + FRAMES * 2);
            p.writeUInt32BE(0x455a4131, 0);
            p.writeUInt32BE(opened.lease.id, 4);
            p.writeUInt32BE(opened.lease.token, 8);
            p.writeUInt32BE(k + 1, 12);
            p.writeDoubleBE(t0 + k * 20, 16);
            for (let i = 0; i < FRAMES; i++) {
                const frame = k * FRAMES + i;
                const beat = frame / (RATE / 4);
                const hz = NOTES[Math.floor(beat) % NOTES.length];
                phase += (TAU * hz) / RATE;
                // Each note eases in and out so neighbors do not click.
                const env = Math.min(1, Math.sin(Math.PI * (beat % 1)) ** 2 * 3);
                p.writeInt16LE(Math.round(Math.sin(phase) * env * 12000), 24 + i * 2);
            }
            sock.send(p, opened.udpPort, host);
            k++;
        }
        // Everything is sent and has played: let the lease go.
        if (k >= TUNE_PACKETS && playerNow() > t0 + TUNE_PACKETS * 20 + 500) void stopTune();
    }, 20);
    tune = { lease: opened.lease, sock, timer, endsAt: t0 + TUNE_PACKETS * 20 };
    console.log(`tune streaming to ${opened.lease.bus} over UDP ${opened.udpPort}`);
}

async function stopTune() {
    const t = tune;
    if (!t) return;
    tune = null;
    clearInterval(t.timer);
    t.sock.close();
    await api('DELETE', `/leases/${t.lease.id}?token=${t.lease.token}`).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Player API: settings, events, status
// ---------------------------------------------------------------------------

async function loadSettings() {
    const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
    const s = res.status === 404 ? {} : res.ok ? ((await res.json()) ?? {}) : null;
    if (!s) throw new Error(`settings: HTTP ${res.status}`);
    return {
        bus: (typeof s.bus === 'string' && s.bus.trim()) || 'immediate',
        volume: Math.min(1, Math.max(0, Number(s.volume ?? 0.5))),
        tuneBus: typeof s.tuneBus === 'string' ? s.tuneBus.trim() : 'main',
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
    let message = 'Starting up';
    let lastSettingsAt = -Infinity;
    let lastKeepaliveAt = 0;
    let buses = [];
    let plays = 0;
    let bars = 0;
    let lastPlay = null;
    let lastBar = null;
    const queue = [];
    const processStart = Date.now();

    const handleEvent = (ev) => {
        const d = ev?.data;
        const type = d?.type === 'input' ? d.input : d?.type;
        if (typeof type === 'string') queue.push(type);
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

    /** One tap. Throws when the player refuses; a lost lease is reopened by the main loop. */
    const act = async (type) => {
        if (type === 'stop') {
            await stopTune();
            if (fx) await call('/stop', {});
            return;
        }
        if (type === 'tune') return startTune(settings);
        if (!fx) throw new Error('no audio lease yet');
        if (clips[type]) {
            const sent = performance.now();
            const r = await call('/play', { clip: type });
            plays++;
            lastPlay = {
                clip: type,
                startsAfterMs: Math.round(r.play.startsAt - r.now),
                roundTripMs: Math.round(performance.now() - sent),
                lateMs: r.play.lateMs ?? 0,
                at: Date.now(),
            };
            return;
        }
        if (type === 'bar') {
            // The bar starts a little ahead of the player's clock so every step has time to arrive.
            const bar = playerNow() + 300;
            let late = 0;
            for (const [step, names] of PATTERN.entries())
                for (const clip of names) {
                    const r = await call('/play', {
                        clip,
                        at: bar + (step * BEAT_MS) / 2,
                        gain: clip === 'hat' ? 0.5 : 1,
                    });
                    if (r.play.lateMs) late++;
                    plays++;
                }
            bars++;
            lastBar = { late, at: Date.now() };
        }
    };

    let lastStatusJson = '';
    let lastStatusAt = 0;

    while (!quit) {
        const now = Date.now();

        // Settings are re-read every few seconds; a new bus reopens the lease, a new volume just sets the gain.
        if (now - lastSettingsAt > 5000) {
            lastSettingsAt = now;
            try {
                settings = await loadSettings();
                if (!fx || fx.settings.bus !== settings.bus) {
                    await openEffects(settings);
                    buses = ((await api('GET', '/buses')).buses ?? []).map((b) => ({ name: b.name, leadMs: b.leadMs }));
                } else if (fx.settings.volume !== settings.volume) {
                    await call('/gain', { gain: settings.volume });
                    fx.settings = settings;
                }
                message = `Ready on bus ${fx.bus} (${fx.leadMs} ms lead)`;
            } catch (e) {
                message = e.status === 404 ? 'This player has no audio API' : `Player not reachable: ${e.message}`;
                console.log(message);
            }
        }

        if (fx && now - lastKeepaliveAt > 10000) {
            lastKeepaliveAt = now;
            try {
                await call('/keepalive');
            } catch (e) {
                // 404: the lease ran out (say the player restarted); the next settings read makes it again.
                if (e.status === 404) fx = null;
                lastSettingsAt = -Infinity;
            }
        }

        while (queue.length && !quit) {
            const type = queue.shift();
            try {
                await act(type);
            } catch (e) {
                message = `${type}: ${e.message}`;
                console.log(message);
                if (e.status === 404) {
                    fx = null;
                    lastSettingsAt = -Infinity;
                }
            }
        }

        const status = {
            phase: fx ? 'ready' : 'unavailable',
            message,
            bus: fx?.bus ?? settings?.bus ?? null,
            leadMs: fx?.leadMs ?? null,
            volume: settings?.volume ?? null,
            clips: Object.keys(clips),
            plays,
            bars,
            lastPlay,
            lastBar,
            tune: {
                available: Boolean(settings?.tuneBus),
                bus: settings?.tuneBus || null,
                streaming: Boolean(tune),
                endsAt: tune?.endsAt ?? null,
            },
            buses,
        };
        const json = JSON.stringify(status);
        if (json !== lastStatusJson || now - lastStatusAt > 2000) {
            lastStatusJson = json;
            lastStatusAt = now;
            void publishStatus(status);
        }
        await sleep(100);
    }

    await Promise.allSettled([stopTune(), closeEffects()]);
    await publishStatus({
        phase: 'unavailable',
        message: 'App stopped',
        bus: null,
        leadMs: null,
        volume: null,
        clips: [],
        plays,
        bars,
        lastPlay,
        lastBar,
        tune: { available: false, bus: null, streaming: false, endsAt: null },
        buses: [],
    });
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
