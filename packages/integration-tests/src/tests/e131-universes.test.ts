/** E1.31 universes as xLights lays them out: a mix of sizes, with gaps in the
 *  numbering (universe per string does both). Each universe must carry its own
 *  size of channels, from the right place in the channel space. Checked at the
 *  wire with a raw listener; the mock controller only speaks DDP. */

import dgram from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const E131_PORT = 5568;
const UNIVERSE_OFFSET = 113;
const PROPERTY_COUNT_OFFSET = 123;
const DATA_OFFSET = 126;

const UNIVERSES = [
    { universe: 1, size: 3 },
    { universe: 2, size: 3 },
    { universe: 10, size: 150 },
    { universe: 20, size: 150 },
];

/** Never 0, so a lit packet is distinguishable from an idle black one. */
const channelValue = (ch: number) => 1 + (ch % 250);

let sock: dgram.Socket;
const lit = new Map<number, number[]>();
const seen = new Set<number>();
let show: FixtureShow;
let app: EzPlayerProc;

beforeAll(async () => {
    sock = dgram.createSocket('udp4');
    sock.on('message', (msg) => {
        const universe = msg.readUInt16BE(UNIVERSE_OFFSET);
        const slots = msg.readUInt16BE(PROPERTY_COUNT_OFFSET) - 1;
        const data = Array.from(msg.subarray(DATA_OFFSET, DATA_OFFSET + slots));
        seen.add(universe);
        if (data[0] !== 0) lit.set(universe, data);
    });
    await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(E131_PORT, '127.0.0.1', resolve);
    });

    show = await createFixtureShow({ e131Universes: UNIVERSES });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
    await new Promise<void>((r) => sock.close(() => r()));
});

describe('E1.31 universes', () => {
    it('sends each universe its own size of channels, in channel order', async () => {
        const fpp = new FppClient(app.base);
        await fpp.upload(
            'sequences',
            'Universes.fseq',
            buildFseq({
                channels: show.channels,
                frames: 200, // 10s
                pattern: (_f, ch) => {
                    for (let i = 0; i < ch.length; i++) ch[i] = channelValue(i);
                },
            }),
        );
        const res = await fpp.putPlaylist('Universes', {
            name: 'Universes',
            mainPlaylist: [{ type: 'sequence', sequenceName: 'Universes.fseq' }],
        });
        expect(res.status).toBe(200);
        expect((await fpp.command('Start Playlist', 'Universes', 0, 0, 0)).status).toBe(200);
        await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'playing' });

        const deadline = Date.now() + 8000;
        while (lit.size < UNIVERSES.length && Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 100));
        }
        expect((await fpp.command('Stop Now')).status).toBe(200);

        let ch = 0;
        for (const { universe, size } of UNIVERSES) {
            expect(lit.get(universe), `universe ${universe}`).toEqual(
                Array.from({ length: size }, (_, i) => channelValue(ch + i)),
            );
            ch += size;
        }
        expect([...seen].sort((a, b) => a - b)).toEqual(UNIVERSES.map((u) => u.universe));
    });
});
