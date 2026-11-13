/** ArtNet universes as xLights lays them out: numbered from 0, mixed sizes,
 *  gaps in the numbering. Each ArtDmx packet must carry its own universe's
 *  channels from the right place in the channel space, with the sequence
 *  stepping once a frame. Checked at the wire with a raw listener. */

import dgram from 'node:dgram';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';
import { createFixtureShow, type FixtureShow } from '../fixtures/showfolder.js';
import { buildFseq } from '../fixtures/fseq.js';

const ARTNET_PORT = 6454;
const SEQUENCE_OFFSET = 12;
const UNIVERSE_OFFSET = 14;
const LENGTH_OFFSET = 16;
const DATA_OFFSET = 18;

const UNIVERSES = [
    { universe: 0, size: 3 },
    { universe: 1, size: 3 },
    { universe: 16, size: 150 },
    { universe: 256, size: 150 },
];

/** Never 0, so a lit packet is distinguishable from an idle black one. */
const channelValue = (ch: number) => 1 + (ch % 250);

let sock: dgram.Socket;
const lit = new Map<number, number[]>();
const seen = new Set<number>();
const sequences: number[] = [];
/** Packets whose header is not a well-formed ArtDmx; none expected. */
const malformed: string[] = [];
let show: FixtureShow;
let app: EzPlayerProc;

beforeAll(async () => {
    sock = dgram.createSocket('udp4');
    sock.on('message', (msg) => {
        const universe = msg.readUInt16LE(UNIVERSE_OFFSET);
        const length = msg.readUInt16BE(LENGTH_OFFSET);
        if (
            msg.subarray(0, 8).toString('ascii') !== 'Art-Net\0' ||
            msg.readUInt16LE(8) !== 0x5000 ||
            msg.readUInt16BE(10) !== 14 ||
            length % 2 !== 0 ||
            msg.length !== DATA_OFFSET + length
        ) {
            malformed.push(msg.subarray(0, DATA_OFFSET).toString('hex'));
        }
        const data = Array.from(msg.subarray(DATA_OFFSET, DATA_OFFSET + length));
        seen.add(universe);
        if (universe === UNIVERSES[0].universe) sequences.push(msg[SEQUENCE_OFFSET]);
        if (data[0] !== 0) lit.set(universe, data);
    });
    await new Promise<void>((resolve, reject) => {
        sock.once('error', reject);
        sock.bind(ARTNET_PORT, '127.0.0.1', resolve);
    });

    show = await createFixtureShow({ e131Universes: UNIVERSES, artNet: true });
    app = await startEzPlayer(show.dir);
});

afterAll(async () => {
    await app?.stop();
    await show?.cleanup();
    await new Promise<void>((r) => sock.close(() => r()));
});

describe('ArtNet universes', () => {
    it('sends each universe its own channels, padded to an even length, with a stepping sequence', async () => {
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
            const want = Array.from({ length: size }, (_, i) => channelValue(ch + i));
            if (size % 2) want.push(0);
            expect(lit.get(universe), `universe ${universe}`).toEqual(want);
            ch += size;
        }
        expect([...seen].sort((a, b) => a - b)).toEqual(UNIVERSES.map((u) => u.universe));
        expect(malformed).toEqual([]);

        // Consecutive frames carry consecutive sequence numbers, 1 to 255 and never 0.
        expect(sequences.length).toBeGreaterThan(10);
        expect(sequences).not.toContain(0);
        const steps = sequences.slice(1).map((s, i) => (s - sequences[i] + 255) % 255);
        expect(steps.every((d) => d === 1)).toBe(true);
    });
});
