#!/usr/bin/env node
/*
 * Audio injection demo: a client that sends sound to a running EZPlayer.
 *
 *   node scripts/audio-inject-demo.mjs [http://localhost:3000] [options]
 *
 *   --bus=name       Bus for the sound effects; default immediate
 *   --stream         Also stream a tune into the show audio (bus main) over UDP
 *   --seconds=n      Stop after n seconds; default 20
 *   --gain=n         Loudness of everything, 0-1; default 0.5
 *
 * It makes a few game-style sounds, uploads them as clips, and plays a drum
 * pattern scheduled on the player's clock, with a zap at random moments to
 * show how soon an unscheduled sound starts. With --stream it also sends a
 * tune as timed PCM packets, far enough ahead that listeners hear it.
 *
 * It exercises the bus list, leases, clips, timed and immediate play, stop,
 * and UDP stream packets. Ctrl+C closes the leases.
 */

import dgram from 'node:dgram';

const args = process.argv.slice(2);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = (args.find((a) => !a.startsWith('--')) ?? 'http://localhost:3000').replace(/\/+$/, '');
const busName = opt('bus') ?? 'immediate';
const seconds = Number(opt('seconds') ?? 20);
const gain = Number(opt('gain') ?? 0.5);
const RATE = 48000;

// ---------------------------------------------------------------------------
// API
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
    const reply = await res.json();
    const trip = Date.now() - sent;
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${reply.error ?? ''}`);
    if (trip <= bestTrip) {
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

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const leases = [];
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    await Promise.allSettled(leases.map((l) => api('DELETE', `/leases/${l.id}?token=${l.token}`)));
    console.log(`closed ${leases.length} leases`);
    process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

const { buses } = await api('GET', '/buses');
for (const b of buses) console.log(`bus ${b.name}: lead ${b.leadMs} ms, chunk ${b.chunkMs} ms, volume ${b.volume}`);

// Sound effects: one lease, clips uploaded once, then played by name.
const fx = (
    await api('POST', '/leases', {
        bus: busName,
        name: 'audio-inject-demo',
        sampleRate: RATE,
        channels: 1,
        encoding: 'f32le',
        gain,
    })
).lease;
leases.push(fx);
const call = (path, body) =>
    api(body instanceof Uint8Array ? 'PUT' : 'POST', `/leases/${fx.id}${path}?token=${fx.token}`, body);
for (const [name, pcm] of Object.entries(clips)) await call(`/clips/${name}`, pcm);
console.log(`effects on ${fx.bus}: ${Object.keys(clips).join(', ')}`);

// A bar of drums is scheduled one bar ahead, on the player's clock.
const BEAT_MS = 500;
const pattern = [
    ['kick', 'hat'],
    ['hat'],
    ['snare', 'hat'],
    ['hat'],
    ['kick', 'hat'],
    ['kick', 'hat'],
    ['snare', 'hat'],
    ['hat', 'coin'],
];
const started = playerNow();
let nextBar = Math.ceil((started + 1000) / (BEAT_MS * 4)) * BEAT_MS * 4;
async function scheduleBars() {
    while (!stopping && nextBar < playerNow() + BEAT_MS * 4) {
        const bar = nextBar;
        nextBar += BEAT_MS * 4;
        const late = [];
        for (const [step, names] of pattern.entries()) {
            for (const clip of names) {
                const r = await call('/play', { clip, at: bar + (step * BEAT_MS) / 2, gain: clip === 'hat' ? 0.5 : 1 });
                if (r.play.lateMs) late.push(r.play.lateMs);
            }
        }
        console.log(
            `bar at +${((bar - started) / 1000).toFixed(1)} s scheduled${late.length ? `, ${late.length} sounds late` : ''}`,
        );
    }
}

// A zap with no time: it plays as soon as the bus allows.
async function zap() {
    const sent = performance.now();
    const r = await call('/play', { clip: 'zap' });
    console.log(
        `zap: starts ${(r.play.startsAt - r.now).toFixed(0)} ms after the player took the call, ` +
            `${(performance.now() - sent).toFixed(0)} ms round trip`,
    );
}

// A tune streamed into the show audio: 20 ms packets, each with its time, sent 1.5 s ahead.
let streamTimer;
if (args.includes('--stream')) {
    const opened = await api('POST', '/leases', {
        bus: 'main',
        name: 'audio-inject-demo tune',
        sampleRate: RATE,
        channels: 1,
        encoding: 's16le',
        gain,
    });
    leases.push(opened.lease);
    const sock = dgram.createSocket('udp4');
    const host = new URL(base).hostname;
    const notes = [262, 330, 392, 523, 392, 330, 294, 349, 440, 587, 440, 349];
    const FRAMES = 960;
    const t0 = playerNow() + 1500;
    let k = 0;
    let phase = 0;
    streamTimer = setInterval(() => {
        // Keep 1.5 s queued ahead of the clock.
        while (t0 + k * 20 < playerNow() + 1500) {
            const p = Buffer.alloc(24 + FRAMES * 2);
            p.writeUInt32BE(0x455a4131, 0);
            p.writeUInt32BE(opened.lease.id, 4);
            p.writeUInt32BE(opened.lease.token, 8);
            p.writeUInt32BE(k + 1, 12);
            p.writeDoubleBE(t0 + k * 20, 16);
            for (let i = 0; i < FRAMES; i++) {
                const frame = k * FRAMES + i;
                const beat = frame / (RATE / 4);
                const hz = notes[Math.floor(beat) % notes.length];
                phase += (TAU * hz) / RATE;
                // Each note eases in and out so neighbours do not click.
                const env = Math.min(1, Math.sin(Math.PI * (beat % 1)) ** 2 * 3);
                p.writeInt16LE(Math.round(Math.sin(phase) * env * 12000), 24 + i * 2);
            }
            sock.send(p, opened.udpPort, host);
            k++;
        }
    }, 20);
    console.log(`tune streaming to main over UDP ${opened.udpPort}`);
}

await scheduleBars();
const barTimer = setInterval(() => void scheduleBars().catch(fail), 250);
const zapTimer = setInterval(() => void zap().catch(fail), 2300);
function fail(err) {
    console.error(err.message);
    clearInterval(barTimer);
    clearInterval(zapTimer);
    clearInterval(streamTimer);
    void stop();
}
setTimeout(async () => {
    clearInterval(barTimer);
    clearInterval(zapTimer);
    clearInterval(streamTimer);
    const state = await api('GET', '/leases');
    for (const l of state.leases.filter((x) => leases.some((y) => y.id === x.id))) {
        console.log(
            `lease ${l.id} on ${l.bus}: ${l.voices} sounds playing, stream ${l.bufferedMs} ms queued, ${l.lateMs} ms late`,
        );
    }
    for (const b of (await api('GET', '/buses')).buses)
        console.log(`bus ${b.name}: ${b.chunks} chunks sent, peak ${b.peak.toFixed(2)}`);
    await stop();
}, seconds * 1000);
