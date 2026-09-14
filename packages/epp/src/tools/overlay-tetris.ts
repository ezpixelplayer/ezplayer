// This code is copyrighted.  The copyright holder is determined as documented in the Github repository history.
// This code is licensed under the Affero General Public License, version 3.0 or later.  Other licenses may be available from the copyright holders.

/**
 * Tetris on a matrix, through an overlay lease.
 *
 * Opens a lease on a grid model over the player's HTTP API, then paints each
 * game frame into it over UDP (the same protocol any external producer uses).
 * A nod to xSchedule, and a live check that the overlay path works end to end.
 *
 * Usage:
 *   tsx src/tools/overlay-tetris.ts --player http://127.0.0.1:8080 [--model Matrix]
 *                                   [--fps 20] [--blend replace] [--http]
 *
 * Keys: left/right or a/d move, up or w rotates, down or s soft drops,
 * space hard drops, p pauses, q quits.
 */

import dgram from 'node:dgram';
import readline from 'node:readline';
import { packetizeOverlayFrame } from '../pipeline/Overlays';

interface Args {
    player: string;
    model?: string;
    fps: number;
    blend: string;
    http: boolean;
}

function parseArgs(argv: string[]): Args {
    const a: Args = { player: 'http://127.0.0.1:8080', fps: 20, blend: 'replace', http: false };
    for (let i = 0; i < argv.length; ++i) {
        const k = argv[i];
        const v = argv[i + 1];
        if (k === '--player') {
            a.player = v;
            ++i;
        } else if (k === '--model') {
            a.model = v;
            ++i;
        } else if (k === '--fps') {
            a.fps = Number(v);
            ++i;
        } else if (k === '--blend') {
            a.blend = v;
            ++i;
        } else if (k === '--http') {
            a.http = true;
        }
    }
    return a;
}

interface Lease {
    id: number;
    token: number;
    width: number;
    height: number;
    frameBytes: number;
    model?: string;
}

// Tetrominoes as rotation lists of [x, y] cells, y down.
const PIECES: { cells: number[][][]; color: [number, number, number] }[] = [
    { cells: [[[0, 1], [1, 1], [2, 1], [3, 1]], [[2, 0], [2, 1], [2, 2], [2, 3]]], color: [0, 255, 255] }, // I
    { cells: [[[1, 0], [2, 0], [1, 1], [2, 1]]], color: [255, 255, 0] }, // O
    {
        cells: [
            [[1, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [1, 1], [2, 1], [1, 2]],
            [[0, 1], [1, 1], [2, 1], [1, 2]],
            [[1, 0], [0, 1], [1, 1], [1, 2]],
        ],
        color: [180, 0, 255],
    }, // T
    { cells: [[[1, 0], [2, 0], [0, 1], [1, 1]], [[1, 0], [1, 1], [2, 1], [2, 2]]], color: [0, 255, 0] }, // S
    { cells: [[[0, 0], [1, 0], [1, 1], [2, 1]], [[2, 0], [1, 1], [2, 1], [1, 2]]], color: [255, 0, 0] }, // Z
    {
        cells: [
            [[0, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [2, 0], [1, 1], [1, 2]],
            [[0, 1], [1, 1], [2, 1], [2, 2]],
            [[1, 0], [1, 1], [0, 2], [1, 2]],
        ],
        color: [0, 0, 255],
    }, // J
    {
        cells: [
            [[2, 0], [0, 1], [1, 1], [2, 1]],
            [[1, 0], [1, 1], [1, 2], [2, 2]],
            [[0, 1], [1, 1], [2, 1], [0, 2]],
            [[0, 0], [1, 0], [1, 1], [1, 2]],
        ],
        color: [255, 128, 0],
    }, // L
];

class Tetris {
    w: number;
    h: number;
    board: Int8Array; // -1 empty, else piece index
    piece = 0;
    rot = 0;
    px = 0;
    py = 0;
    score = 0;
    lines = 0;
    over = false;
    paused = false;
    dropMs = 600;
    private acc = 0;

    constructor(w: number, h: number) {
        this.w = w;
        this.h = h;
        this.board = new Int8Array(w * h).fill(-1);
        this.spawn();
    }

    private cells(piece = this.piece, rot = this.rot, px = this.px, py = this.py): [number, number][] {
        const shape = PIECES[piece].cells[rot % PIECES[piece].cells.length];
        return shape.map(([x, y]) => [px + x, py + y]);
    }

    private fits(piece: number, rot: number, px: number, py: number): boolean {
        for (const [x, y] of this.cells(piece, rot, px, py)) {
            if (x < 0 || x >= this.w || y >= this.h) return false;
            if (y >= 0 && this.board[y * this.w + x] >= 0) return false;
        }
        return true;
    }

    spawn() {
        this.piece = Math.floor(Math.random() * PIECES.length);
        this.rot = 0;
        this.px = Math.floor(this.w / 2) - 2;
        this.py = -1;
        if (!this.fits(this.piece, this.rot, this.px, this.py)) this.over = true;
    }

    move(dx: number) {
        if (this.over || this.paused) return;
        if (this.fits(this.piece, this.rot, this.px + dx, this.py)) this.px += dx;
    }

    rotate() {
        if (this.over || this.paused) return;
        const r = this.rot + 1;
        for (const kick of [0, -1, 1, -2, 2]) {
            if (this.fits(this.piece, r, this.px + kick, this.py)) {
                this.rot = r;
                this.px += kick;
                return;
            }
        }
    }

    /** One step down; locks the piece when it cannot fall. */
    step(): boolean {
        if (this.over || this.paused) return false;
        if (this.fits(this.piece, this.rot, this.px, this.py + 1)) {
            this.py++;
            return true;
        }
        for (const [x, y] of this.cells()) {
            if (y >= 0) this.board[y * this.w + x] = this.piece;
        }
        this.clearLines();
        this.spawn();
        return false;
    }

    hardDrop() {
        if (this.over || this.paused) return;
        while (this.step()) {
            /* fall */
        }
    }

    private clearLines() {
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
            this.score += [0, 100, 300, 500, 800][cleared] ?? 800;
            this.dropMs = Math.max(120, 600 - this.lines * 15);
        }
    }

    tick(dtMs: number) {
        if (this.over || this.paused) return;
        this.acc += dtMs;
        while (this.acc >= this.dropMs) {
            this.acc -= this.dropMs;
            this.step();
        }
    }

    /** Paint the board (top row first) into an RGB payload. */
    render(out: Uint8Array, tMs: number) {
        out.fill(0);
        const put = (x: number, y: number, c: [number, number, number], k = 1) => {
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
            // Ghost: where the piece would land.
            let gy = this.py;
            while (this.fits(this.piece, this.rot, this.px, gy + 1)) gy++;
            for (const [x, y] of this.cells(this.piece, this.rot, this.px, gy)) put(x, y, PIECES[this.piece].color, 0.15);
            for (const [x, y] of this.cells()) put(x, y, PIECES[this.piece].color, 1);
        } else {
            // Game over: a slow red pulse over the top rows.
            const k = 0.3 + 0.3 * (0.5 + 0.5 * Math.sin(tMs / 300));
            for (let x = 0; x < this.w; ++x) put(x, 0, [255, 0, 0], k);
        }
    }
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const base = args.player.replace(/\/$/, '');

    const targetsRes = await fetch(`${base}/api/ezp/overlays/targets`);
    if (!targetsRes.ok) throw new Error(`targets: HTTP ${targetsRes.status}`);
    const targets = (await targetsRes.json()) as { ok: boolean; targets: { model: string; width?: number; height?: number }[] };
    const grids = targets.targets.filter((t) => t.width && t.height && t.width >= 4 && t.height >= 6);
    const pick = args.model ? targets.targets.find((t) => t.model === args.model) : grids[0];
    if (!pick) {
        console.error('No grid model to play on. Targets:', targets.targets.map((t) => `${t.model} ${t.width ?? '?'}x${t.height ?? '?'}`).join(', '));
        process.exit(1);
    }
    // Tall boards play better; use up to 10 wide by 20 high from the model's grid.
    const width = Math.min(pick.width ?? 10, 10);
    const height = Math.min(pick.height ?? 20, 20);

    const openRes = await fetch(`${base}/api/ezp/overlays`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: pick.model, format: 'grid', width, height, blend: args.blend, ttlMs: 10_000, name: 'tetris' }),
    });
    const opened = (await openRes.json()) as { ok: boolean; lease?: Lease; udpPort?: number; error?: string };
    if (!opened.ok || !opened.lease) throw new Error(`open lease: ${opened.error}`);
    const lease = opened.lease;
    const udpPort = opened.udpPort ?? 4049;
    const host = new URL(base).hostname;
    console.log(`Lease ${lease.id} on ${lease.model} ${lease.width}x${lease.height}; ${args.http ? 'HTTP frames' : `UDP ${host}:${udpPort}`}`);
    console.log('left/right move, up rotate, down soft drop, space hard drop, p pause, q quit');

    const game = new Tetris(width, height);
    const payload = new Uint8Array(lease.frameBytes);
    const sock = dgram.createSocket('udp4');
    let seq = 1;

    const sendFrame = async () => {
        game.render(payload, performance.now());
        if (args.http) {
            await fetch(`${base}/api/ezp/overlays/${lease.id}/frame?token=${lease.token}&seq=${seq++}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/octet-stream' },
                body: payload,
            });
        } else {
            for (const p of packetizeOverlayFrame(lease.id, lease.token, seq++, payload)) sock.send(p, udpPort, host);
        }
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    let quit = false;
    process.stdin.on('keypress', (_str, key: { name?: string; ctrl?: boolean }) => {
        if (!key) return;
        if (key.name === 'q' || (key.ctrl && key.name === 'c')) quit = true;
        else if (key.name === 'left' || key.name === 'a') game.move(-1);
        else if (key.name === 'right' || key.name === 'd') game.move(1);
        else if (key.name === 'up' || key.name === 'w') game.rotate();
        else if (key.name === 'down' || key.name === 's') game.step();
        else if (key.name === 'space') game.hardDrop();
        else if (key.name === 'p') game.paused = !game.paused;
        else if (key.name === 'r' && game.over) Object.assign(game, new Tetris(width, height));
    });

    const frameMs = 1000 / Math.max(1, args.fps);
    let last = performance.now();
    let lastStatus = '';
    while (!quit) {
        const now = performance.now();
        game.tick(now - last);
        last = now;
        await sendFrame();
        const status = `score ${game.score}  lines ${game.lines}${game.paused ? '  [paused]' : ''}${game.over ? '  GAME OVER (r restarts)' : ''}`;
        if (status !== lastStatus) {
            process.stdout.write(`\r${status.padEnd(60)}`);
            lastStatus = status;
        }
        await new Promise((r) => setTimeout(r, frameMs));
    }
    process.stdout.write('\n');
    await fetch(`${base}/api/ezp/overlays/${lease.id}?token=${lease.token}`, { method: 'DELETE' }).catch(() => undefined);
    sock.close();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
