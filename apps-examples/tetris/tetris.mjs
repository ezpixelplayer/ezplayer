// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Tetris on a matrix, as an EZPlayer app.
 *
 * Phones tap buttons on the app's page; the taps arrive here as app events.
 * While a game runs the board is painted into an overlay lease on the chosen
 * model and the sound effects go to an audio bus. Between games both leases
 * are released so the show owns the matrix again.
 *
 * Environment (set by the player): EZP_API_URL, EZP_APP_INSTANCE, EZP_APP_TOKEN.
 * Settings come from the instance's private data key "settings".
 */

const base = (process.env.EZP_API_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
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

// Sound effects: mono floats at 48 kHz, uploaded once as clips and played by name.
const RATE = 48000;
const TAU = Math.PI * 2;

/** `sec` of sound from fn(time, 0..1 through it), eased in and out so it cannot click. */
function sound(sec, fn) {
    const out = new Float32Array(Math.round(sec * RATE));
    for (let i = 0; i < out.length; i++) {
        const t = i / RATE;
        out[i] = fn(t, i / out.length) * Math.min(1, t / 0.002, (sec - t) / 0.004);
    }
    return new Uint8Array(out.buffer);
}

/** Notes one after another, each `sec` long. */
function notes(hz, sec) {
    return sound(hz.length * sec, (t) => {
        const k = Math.min(hz.length - 1, Math.floor(t / sec));
        const u = t - k * sec;
        const wave = Math.sin(TAU * hz[k] * u) + 0.3 * Math.sin(TAU * hz[k] * 2 * u);
        return wave * 0.6 * Math.min(1, u / 0.003) * (1 - u / sec) ** 0.7;
    });
}

let noiseSeed = 1;
const noise = () => (noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff) / 0x3fffffff - 1;

const CLIPS = {
    move: sound(0.03, (t, p) => Math.sin(TAU * 880 * t) * 0.35 * (1 - p)),
    rotate: sound(0.07, (t, p) => Math.sin(TAU * (600 * t + 2500 * t * t)) * 0.4 * (1 - p)),
    lock: sound(0.09, (t, p) => (Math.sin(TAU * 110 * t) * 0.8 + noise() * 0.15) * (1 - p) ** 2),
    drop: sound(
        0.16,
        (t, p) => (Math.sin(TAU * (90 * t - 150 * t * t)) + noise() * 0.3 * (1 - p) ** 6) * 0.8 * (1 - p) ** 2,
    ),
    line1: notes([523, 784], 0.07),
    line2: notes([523, 659, 784], 0.07),
    line3: notes([523, 659, 784, 1047], 0.07),
    line4: notes([523, 659, 784, 1047, 784, 1047, 1319], 0.08),
    pause: notes([660, 440], 0.08),
    over: notes([392, 330, 262, 196, 131], 0.16),
};

/** The game's sound effects on one of the player's audio buses. */
class Sounds {
    constructor(id, token) {
        this.id = id;
        this.token = token;
    }

    static async open(bus, volume) {
        try {
            const res = await fetch(`${base}/api/ezp/audio/leases`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    bus,
                    name: 'tetris',
                    sampleRate: RATE,
                    channels: 1,
                    encoding: 'f32le',
                    gain: volume,
                    ttlMs: 10_000,
                }),
            });
            const opened = await res.json();
            if (!opened.ok || !opened.lease) throw new Error(opened.error ?? `HTTP ${res.status}`);
            const s = new Sounds(opened.lease.id, opened.lease.token);
            for (const [name, pcm] of Object.entries(CLIPS)) {
                const put = await fetch(s.url(`/clips/${name}`), {
                    method: 'PUT',
                    headers: { 'content-type': 'application/octet-stream' },
                    body: pcm,
                });
                if (!put.ok) throw new Error(`clip ${name}: HTTP ${put.status}`);
            }
            console.log(`Sound on audio bus ${opened.lease.bus} (${opened.lease.leadMs} ms lead)`);
            return s;
        } catch (e) {
            console.log(`No sound: ${e.message}`);
            return undefined;
        }
    }

    url(path) {
        return `${base}/api/ezp/audio/leases/${this.id}${path}?token=${this.token}`;
    }

    post(path, body) {
        void fetch(this.url(path), {
            method: 'POST',
            headers: body ? { 'content-type': 'application/json' } : undefined,
            body: body ? JSON.stringify(body) : undefined,
        }).catch(() => undefined);
    }

    play(clip) {
        this.post('/play', { clip });
    }

    keepalive() {
        this.post('/keepalive');
    }

    async close() {
        await fetch(this.url(''), { method: 'DELETE' }).catch(() => undefined);
    }
}

// Tetrominoes as rotation lists of [x, y] cells, y down. Rotation 0 fits in 4x2.
const PIECES = [
    {
        cells: [
            [
                [0, 1],
                [1, 1],
                [2, 1],
                [3, 1],
            ],
            [
                [2, 0],
                [2, 1],
                [2, 2],
                [2, 3],
            ],
        ],
        color: [0, 255, 255],
        letter: 'C',
    }, // I
    {
        cells: [
            [
                [1, 0],
                [2, 0],
                [1, 1],
                [2, 1],
            ],
        ],
        color: [255, 255, 0],
        letter: 'Y',
    }, // O
    {
        cells: [
            [
                [1, 0],
                [0, 1],
                [1, 1],
                [2, 1],
            ],
            [
                [1, 0],
                [1, 1],
                [2, 1],
                [1, 2],
            ],
            [
                [0, 1],
                [1, 1],
                [2, 1],
                [1, 2],
            ],
            [
                [1, 0],
                [0, 1],
                [1, 1],
                [1, 2],
            ],
        ],
        color: [180, 0, 255],
        letter: 'P',
    }, // T
    {
        cells: [
            [
                [1, 0],
                [2, 0],
                [0, 1],
                [1, 1],
            ],
            [
                [1, 0],
                [1, 1],
                [2, 1],
                [2, 2],
            ],
        ],
        color: [0, 255, 0],
        letter: 'G',
    }, // S
    {
        cells: [
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [2, 1],
            ],
            [
                [2, 0],
                [1, 1],
                [2, 1],
                [1, 2],
            ],
        ],
        color: [255, 0, 0],
        letter: 'R',
    }, // Z
    {
        cells: [
            [
                [0, 0],
                [0, 1],
                [1, 1],
                [2, 1],
            ],
            [
                [1, 0],
                [2, 0],
                [1, 1],
                [1, 2],
            ],
            [
                [0, 1],
                [1, 1],
                [2, 1],
                [2, 2],
            ],
            [
                [1, 0],
                [1, 1],
                [0, 2],
                [1, 2],
            ],
        ],
        color: [0, 0, 255],
        letter: 'B',
    }, // J
    {
        cells: [
            [
                [2, 0],
                [0, 1],
                [1, 1],
                [2, 1],
            ],
            [
                [1, 0],
                [1, 1],
                [1, 2],
                [2, 2],
            ],
            [
                [0, 1],
                [1, 1],
                [2, 1],
                [0, 2],
            ],
            [
                [0, 0],
                [1, 0],
                [1, 1],
                [1, 2],
            ],
        ],
        color: [255, 128, 0],
        letter: 'O',
    }, // L
];

class Tetris {
    constructor(w, h) {
        this.w = w;
        this.h = h;
        this.board = new Int8Array(w * h).fill(-1); // -1 empty, else piece index
        this.next = Math.floor(Math.random() * PIECES.length);
        this.rot = 0;
        this.px = 0;
        this.py = 0;
        this.score = 0;
        this.lines = 0;
        this.over = false;
        this.paused = false;
        this.dropMs = 600;
        /** Names of the sounds for what has happened since the caller last emptied it. */
        this.events = [];
        this.acc = 0;
        this.spawn();
    }

    get level() {
        return 1 + Math.floor(this.lines / 10);
    }

    cells(piece = this.piece, rot = this.rot, px = this.px, py = this.py) {
        const shape = PIECES[piece].cells[rot % PIECES[piece].cells.length];
        return shape.map(([x, y]) => [px + x, py + y]);
    }

    fits(piece, rot, px, py) {
        for (const [x, y] of this.cells(piece, rot, px, py)) {
            if (x < 0 || x >= this.w || y >= this.h) return false;
            if (y >= 0 && this.board[y * this.w + x] >= 0) return false;
        }
        return true;
    }

    spawn() {
        this.piece = this.next;
        this.next = Math.floor(Math.random() * PIECES.length);
        this.rot = 0;
        this.px = Math.floor(this.w / 2) - 2;
        this.py = -1;
        if (!this.fits(this.piece, this.rot, this.px, this.py)) {
            this.over = true;
            this.events.push('over');
        }
    }

    move(dx) {
        if (this.over || this.paused) return;
        if (!this.fits(this.piece, this.rot, this.px + dx, this.py)) return;
        this.px += dx;
        this.events.push('move');
    }

    rotate() {
        if (this.over || this.paused) return;
        const r = this.rot + 1;
        for (const kick of [0, -1, 1, -2, 2]) {
            if (this.fits(this.piece, r, this.px + kick, this.py)) {
                this.rot = r;
                this.px += kick;
                this.events.push('rotate');
                return;
            }
        }
    }

    /** One step down; locks the piece when it cannot fall. */
    step() {
        if (this.over || this.paused) return false;
        if (this.fits(this.piece, this.rot, this.px, this.py + 1)) {
            this.py++;
            return true;
        }
        for (const [x, y] of this.cells()) {
            if (y >= 0) this.board[y * this.w + x] = this.piece;
        }
        this.events.push('lock');
        this.clearLines();
        this.spawn();
        return false;
    }

    hardDrop() {
        if (this.over || this.paused) return;
        const before = this.events.length;
        while (this.step()) {
            /* fall */
        }
        // The landing of a dropped piece sounds heavier.
        if (this.events[before] === 'lock') this.events[before] = 'drop';
    }

    clearLines() {
        let cleared = 0;
        for (let y = this.h - 1; y >= 0; --y) {
            let full = true;
            for (let x = 0; x < this.w; ++x) if (this.board[y * this.w + x] < 0) full = false;
            if (!full) continue;
            this.board.copyWithin(this.w, 0, y * this.w);
            this.board.fill(-1, 0, this.w);
            ++cleared;
            ++y; // re-check the row that dropped into this position
        }
        if (cleared) {
            this.lines += cleared;
            this.events.push(`line${Math.min(cleared, 4)}`);
            this.score += [0, 100, 300, 500, 800][cleared] ?? 800;
            this.dropMs = Math.max(120, 600 - this.lines * 15);
        }
    }

    tick(dtMs) {
        if (this.over || this.paused) return;
        this.acc += dtMs;
        while (this.acc >= this.dropMs) {
            this.acc -= this.dropMs;
            this.step();
        }
    }

    /** Where the current piece would land. */
    ghostY() {
        let gy = this.py;
        while (this.fits(this.piece, this.rot, this.px, gy + 1)) gy++;
        return gy;
    }

    /** Paint the board (top row first) into an RGB payload. */
    render(out, tMs) {
        out.fill(0);
        const put = (x, y, c, k = 1) => {
            if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
            const i = (y * this.w + x) * 3;
            out[i] = c[0] * k;
            out[i + 1] = c[1] * k;
            out[i + 2] = c[2] * k;
        };
        for (let y = 0; y < this.h; ++y) {
            for (let x = 0; x < this.w; ++x) {
                const p = this.board[y * this.w + x];
                if (p >= 0) put(x, y, PIECES[p].color, this.over ? 0.3 : 0.8);
            }
        }
        if (!this.over) {
            for (const [x, y] of this.cells(this.piece, this.rot, this.px, this.ghostY()))
                put(x, y, PIECES[this.piece].color, 0.15);
            for (const [x, y] of this.cells()) put(x, y, PIECES[this.piece].color, 1);
        } else {
            // Game over: a slow red pulse over the top row.
            const k = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(tMs / 300));
            for (let x = 0; x < this.w; ++x) put(x, 0, [255, 0, 0], k);
        }
    }

    /** The board as text rows for the phone page: "." empty, a color letter, lowercase for the ghost. */
    rows() {
        const grid = [];
        for (let y = 0; y < this.h; ++y) {
            const row = [];
            for (let x = 0; x < this.w; ++x) {
                const p = this.board[y * this.w + x];
                row.push(p >= 0 ? PIECES[p].letter : '.');
            }
            grid.push(row);
        }
        const set = (x, y, ch) => {
            if (x >= 0 && x < this.w && y >= 0 && y < this.h) grid[y][x] = ch;
        };
        if (!this.over) {
            const letter = PIECES[this.piece].letter;
            for (const [x, y] of this.cells(this.piece, this.rot, this.px, this.ghostY()))
                set(x, y, letter.toLowerCase());
            for (const [x, y] of this.cells()) set(x, y, letter);
        }
        return grid.map((r) => r.join(''));
    }

    nextRows() {
        const grid = [
            ['.', '.', '.', '.'],
            ['.', '.', '.', '.'],
        ];
        for (const [x, y] of PIECES[this.next].cells[0]) grid[y][x] = PIECES[this.next].letter;
        return grid.map((r) => r.join(''));
    }
}

// ---- Player API: settings, status, high score ----

/** Reads the instance settings and resolves the model; returns { settings, target } or { error }. */
async function loadConfig() {
    const res = await fetch(appUrl('/data/private/settings'), { headers: authHeaders });
    if (res.status === 404) return { error: 'Not configured: open the app settings and pick a model.' };
    if (!res.ok) throw new Error(`settings: HTTP ${res.status}`);
    const s = (await res.json()) ?? {};
    if (!s.model) return { error: 'Not configured: no model chosen in the app settings.' };

    const targetsRes = await fetch(`${base}/api/ezp/overlays/targets`);
    if (!targetsRes.ok) throw new Error(`targets: HTTP ${targetsRes.status}`);
    const { targets = [] } = await targetsRes.json();
    const target = targets.find((t) => t.model === s.model);
    if (!target) return { error: `Model "${s.model}" is not an overlay target; check the app settings.` };
    if (!target.width || !target.height || target.width < 4 || target.height < 6) {
        return { error: `Model "${s.model}" is not a grid big enough for Tetris (needs at least 4x6).` };
    }

    const fps = Math.min(60, Math.max(1, Number(s.fps) || 20));
    const volume = Math.min(1, Math.max(0, Number(s.volume ?? 0.6)));
    const bus = typeof s.bus === 'string' ? s.bus.trim() : 'immediate';
    return { settings: { model: s.model, fps, bus, volume, audio: bus !== '' && s.audio !== false }, target };
}

async function loadHighscore() {
    try {
        const res = await fetch(appUrl('/data/public/highscore'), { headers: authHeaders });
        if (!res.ok) return null;
        const h = await res.json();
        return typeof h?.score === 'number' ? h : null;
    } catch {
        return null;
    }
}

async function saveHighscore(score) {
    const body = { score, at: new Date().toISOString() };
    await fetch(appUrl('/data/public/highscore'), {
        method: 'PUT',
        headers: jsonHeaders,
        body: JSON.stringify(body),
    }).catch(() => undefined);
    return body;
}

async function publishStatus(status) {
    await fetch(appUrl('/status'), { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(status) }).catch(
        () => undefined,
    );
}

// ---- Main ----

async function main() {
    let quit = false;
    const poll = new AbortController();
    const stop = () => {
        quit = true;
        poll.abort();
    };
    process.on('SIGTERM', stop);
    process.on('SIGINT', stop);

    let config = null; // { settings, target } once valid
    let configError = 'Starting up';
    let lastConfigCheck = -Infinity;
    let highscore = await loadHighscore();

    let phase = 'idle'; // idle | playing | over ("unconfigured" is reported, not stored)
    let game = null;
    let player = null;
    let pendingStart = null; // client id who tapped start; the main loop opens the leases
    let lease = null;
    let sounds = null;
    let payload = null;
    let seq = 1;
    let overAt = 0;
    let lastInput = 0;
    const startedAt = Date.now();

    const releaseLeases = async () => {
        const l = lease;
        const s = sounds;
        lease = null;
        sounds = null;
        if (l)
            await fetch(`${base}/api/ezp/overlays/${l.id}?token=${l.token}`, { method: 'DELETE' }).catch(
                () => undefined,
            );
        if (s) await s.close();
    };

    const startGame = async (client) => {
        await releaseLeases();
        const { settings, target } = config;
        // Tall boards play better; use up to 10 wide by 20 high from the model's grid.
        const width = Math.min(target.width, 10);
        const height = Math.min(target.height, 20);
        const openRes = await fetch(`${base}/api/ezp/overlays`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                model: target.model,
                format: 'grid',
                width,
                height,
                blend: 'replace',
                ttlMs: 10_000,
                name: 'tetris',
            }),
        });
        const opened = await openRes.json().catch(() => ({}));
        if (!opened.ok || !opened.lease) throw new Error(opened.error ?? `HTTP ${openRes.status}`);
        lease = opened.lease;
        payload = new Uint8Array(lease.frameBytes);
        seq = 1;
        console.log(`Lease ${lease.id} on ${lease.model} ${lease.width}x${lease.height} for ${client}`);
        sounds = settings.audio ? await Sounds.open(settings.bus, settings.volume) : undefined;
        game = new Tetris(width, height);
        player = client;
        phase = 'playing';
        lastInput = performance.now();
    };

    const sendFrame = async () => {
        game.render(payload, performance.now());
        await fetch(`${base}/api/ezp/overlays/${lease.id}/frame?token=${lease.token}&seq=${seq++}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/octet-stream' },
            body: payload,
        }).catch(() => undefined);
    };

    const handleEvent = (ev) => {
        const type = ev?.data?.type;
        if (!type || typeof ev.client !== 'string') return;
        if (phase !== 'playing') {
            if (type === 'start' && config && !pendingStart) pendingStart = ev.client;
            return;
        }
        if (ev.client !== player) return;
        lastInput = performance.now();
        if (type === 'left') game.move(-1);
        else if (type === 'right') game.move(1);
        else if (type === 'rotate') game.rotate();
        else if (type === 'down') game.step();
        else if (type === 'drop') game.hardDrop();
        else if (type === 'pause') {
            game.paused = !game.paused;
            game.events.push('pause');
        }
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
                    if (ev.ts >= startedAt - 2000) handleEvent(ev);
                }
            } catch (e) {
                if (quit) return;
                console.log(`events: ${e.message}`);
                await sleep(2000);
            }
        }
    };
    void pollEvents();

    let last = performance.now();
    let lastKeepalive = last;
    let lastStatusJson = '';
    let lastStatusAt = 0;
    let message = '';

    while (!quit) {
        const now = performance.now();
        const frameMs = 1000 / (config?.settings.fps ?? 4);

        // Settings are re-read between games so the owner can change the model without a restart.
        if (phase !== 'playing' && now - lastConfigCheck > 5000) {
            lastConfigCheck = now;
            try {
                const c = await loadConfig();
                config = c.settings ? c : null;
                configError = c.error ?? '';
            } catch (e) {
                config = null;
                configError = `Player not reachable: ${e.message}`;
            }
        }

        if (pendingStart) {
            const client = pendingStart;
            pendingStart = null;
            try {
                await startGame(client);
                message = '';
            } catch (e) {
                message = `Could not start: ${e.message}`;
                console.log(message);
                lastConfigCheck = -Infinity;
            }
        }

        if (phase === 'playing') {
            game.tick(now - last);
            // A paused game left alone would hold the matrix forever.
            if (game.paused && now - lastInput > 120_000) game.over = true;
            if (game.over) {
                phase = 'over';
                overAt = now;
                if (game.score > (highscore?.score ?? 0)) {
                    highscore = await saveHighscore(game.score);
                    message = `Game over: ${game.score} is a new high score!`;
                } else {
                    message = `Game over: ${game.score} points.`;
                }
            }
            // The sound is asked for before the frame is sent: it takes longer to arrive.
            for (const name of game.events.splice(0)) sounds?.play(name);
            if (now - lastKeepalive > 3000) {
                lastKeepalive = now;
                sounds?.keepalive();
            }
            await sendFrame();
        } else if (phase === 'over' && lease) {
            // Keep the game-over pulse on the matrix for a few seconds, then give it back to the show.
            if (now - overAt > 6000) await releaseLeases();
            else await sendFrame();
        }
        last = now;

        const status = {
            phase: config ? phase : 'unconfigured',
            board: game ? game.rows() : [],
            next: game ? game.nextRows() : [],
            score: game?.score ?? 0,
            lines: game?.lines ?? 0,
            level: game?.level ?? 1,
            player: phase === 'playing' ? player : null,
            highscore: highscore?.score ?? 0,
            message: !config
                ? configError
                : phase === 'playing'
                  ? game.paused
                      ? 'Paused'
                      : 'Playing'
                  : phase === 'idle'
                    ? message || 'Tap Start to play'
                    : message,
        };
        const json = JSON.stringify(status);
        if (json !== lastStatusJson || now - lastStatusAt > 2000) {
            lastStatusJson = json;
            lastStatusAt = now;
            await publishStatus(status);
        }
        await sleep(frameMs);
    }

    await releaseLeases();
    await publishStatus({
        phase: 'idle',
        board: [],
        next: [],
        score: 0,
        lines: 0,
        level: 1,
        player: null,
        highscore: highscore?.score ?? 0,
        message: 'App stopped',
    });
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
