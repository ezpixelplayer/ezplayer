/** Sequences as xLights writes them by default: sparse files stop at the last
 *  model in the master view, and Effect sequences are also zlib. Packets must
 *  still cover the whole controller, and a short background must not cut off
 *  the song under it. Checked at the wire with a raw listener, because a packet
 *  that claims more than it carries is what is being looked for. */

import dgram from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const DDP_PORT = 4048;
const DDP_HEADER = 10;
const CHANNELS = 300;
const CHANNELS_PER_PACKET = 100;

let sock: dgram.Socket;
const channels = new Uint8Array(CHANNELS);
let latest = new Uint8Array(CHANNELS);
let shortPackets = 0;
const packetSizes = new Set<number>();

let show: FixtureShow;
let app: EzPlayerProc;
let fpp: FppClient;

function hms(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    return `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
}

async function waitForFrame(what: string, match: (frame: Uint8Array) => boolean, timeoutMs = 15_000) {
    const deadline = Date.now() + timeoutMs;
    while (!match(latest)) {
        if (Date.now() > deadline) {
            throw new Error(`no frame with ${what}; last was ${Array.from(latest.subarray(0, 8))}...`);
        }
        await new Promise((r) => setTimeout(r, 25));
    }
    return latest;
}

async function play(name: string) {
    expect((await fpp.command('Start Playlist', name, 0, 0, 0)).status).toBe(200);
    await fpp.waitForStatus((s) => s.status_name === 'playing', { label: `${name} playing`, timeoutMs: 20_000 });
}

async function addSequence(name: string, fseq: Buffer) {
    await fpp.upload('sequences', `${name}.fseq`, fseq);
    const res = await fpp.putPlaylist(name, {
        name,
        mainPlaylist: [{ type: 'sequence', sequenceName: `${name}.fseq` }],
    });
    expect(res.status).toBe(200);
}

beforeAll(async () => {
    sock = dgram.createSocket('udp4');
    sock.on('message', (msg) => {
        const offset = msg.readUInt32BE(4);
        const claimed = msg.readUInt16BE(8);
        const data = msg.subarray(DDP_HEADER);
        if (data.length !== claimed) ++shortPackets;
        packetSizes.add(claimed);
        channels.set(data.subarray(0, CHANNELS - Math.min(offset, CHANNELS)), offset);
        if (msg[0] & 1) latest = channels.slice();
    });
    await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(DDP_PORT, '127.0.0.1', resolve);
    });

    show = await createFixtureShow({ channels: CHANNELS, ddpChannelsPerPacket: CHANNELS_PER_PACKET });
    app = await startEzPlayer(show.dir);
    fpp = new FppClient(app.base);

    await addSequence(
        'ShortSong',
        buildFseq({ channels: CHANNELS, frames: 300, value: 77, sparse: [{ startch: 0, chcount: 30 }] }),
    );
    await addSequence(
        'FullSong',
        buildFseq({ channels: CHANNELS, frames: 300, pattern: (f, ch) => ch.fill(100 + (f % 50)) }),
    );
    await addSequence(
        'EffectBG',
        buildFseq({ channels: CHANNELS, frames: 400, value: 200, sparse: [{ startch: 0, chcount: 30 }], zlib: true }),
    );
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
    await new Promise<void>((r) => sock.close(() => r()));
});

describe('sparse sequences', () => {
    it('fills a short frame out to the end of the controller', async () => {
        shortPackets = 0;
        await play('ShortSong');
        const frame = await waitForFrame('the short song', (f) => f[0] === 77);
        expect((await fpp.command('Stop Now')).status).toBe(200);

        expect(Array.from(frame.subarray(0, 30))).toEqual(new Array(30).fill(77));
        expect(frame.subarray(30).every((v) => v === 0)).toBe(true);
        expect(shortPackets).toBe(0);
    }, 60_000);

    it('splits packets at the size set in xLights', async () => {
        packetSizes.clear();
        await play('FullSong');
        await waitForFrame('the full song', (f) => f[CHANNELS - 1] >= 100);
        expect((await fpp.command('Stop Now')).status).toBe(200);

        expect([...packetSizes]).toEqual([CHANNELS_PER_PACKET]);
    }, 60_000);

    it('plays a zlib Effect background without cutting off the song past its end', async () => {
        const now = new Date();
        const start = new Date(now.getTime() + 1000);
        const end = new Date(start.getTime() + 2 * 60_000);
        if (start.getDate() !== end.getDate()) return; // skip near midnight

        const playlists = (await fpp.currentShow()).playlists as Array<{ id: string; title: string }>;
        const bg = playlists.find((p) => p.title === 'EffectBG')!;
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        const schedule = async (body: unknown) => {
            const res = await fetch(`${app.base}/api/ezp/schedules`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([body]),
            });
            expect(res.status).toBe(200);
        };
        await schedule({
            id: 'effect-bg',
            scheduleType: 'background',
            playlistId: bg.id,
            title: 'effect-bg',
            playlistTitle: 'EffectBG',
            date: midnight.getTime(),
            fromTime: hms(start),
            toTime: hms(end),
            loop: true,
            duration: 0,
        });

        await play('FullSong');
        const mixed = (f: Uint8Array) => f[0] === 200 && f[250] >= 100;
        const first = await waitForFrame('both the background and the song', mixed);
        // The song changes every frame, so channels left over from an earlier one can't pass.
        const frame = await waitForFrame('the song still moving', (f) => mixed(f) && f[250] !== first[250]);
        expect((await fpp.command('Stop Now')).status).toBe(200);
        await schedule({ id: 'effect-bg', deleted: true });

        expect(frame[29]).toBe(200);
        expect(frame[30]).toBe(frame[250]);
        expect(frame[CHANNELS - 1]).toBe(frame[250]);
    }, 60_000);
});
