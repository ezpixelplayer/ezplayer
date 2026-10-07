/**
 * Does a controller powered on mid-show start receiving data from the running
 * player?  Someone has to work the power switch, so it runs only when COLDBOOT
 * names the controller to watch:
 *
 *   COLDBOOT=192.168.101.60 pnpm vitest run src/tests/coldboot-manual.test.ts
 *
 * Playback runs through the whole send path — scheduler, frame sender, DDP
 * sender — and the controller's own input stats decide the result, so a skip
 * anywhere in that path shows up as the controller taking no data.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startEzPlayer, type EzPlayerProc } from '../harness/ezplayer-proc.js';
import { FppClient } from '../harness/fpp-client.js';

const TARGET = process.env.COLDBOOT;
const SHOW = process.env.COLDBOOT_SHOW ?? 'C:/Users/Chuck/Documents/xlightsShows/TestLab';
const SEQUENCE = process.env.COLDBOOT_SEQ ?? 'Spirals.fseq';
const WATCH_MS = Number(process.env.COLDBOOT_WATCH_MS ?? 300_000);

let app: EzPlayerProc | undefined;
let fpp: FppClient;

/** What the controller says it is receiving, or why it cannot be asked. */
async function received(): Promise<{ up: boolean; packets: number; detail: string }> {
    try {
        const r = await fetch(`http://${TARGET}/api/channel/input/stats`, { signal: AbortSignal.timeout(2500) });
        const j = (await r.json()) as {
            universes?: { id?: string; packetsReceived?: string; startChannel?: string }[];
        };
        const rows = j.universes ?? [];
        const packets = rows.reduce((n, u) => n + Number(u.packetsReceived ?? 0), 0);
        const detail = rows.map((u) => `${u.id}:${u.packetsReceived}@${u.startChannel}`).join(' ') || '(no inputs)';
        return { up: true, packets, detail };
    } catch (e) {
        return { up: false, packets: 0, detail: (e as Error).name };
    }
}

beforeAll(async () => {
    if (!TARGET) return;
    app = await startEzPlayer(SHOW);
    fpp = new FppClient(app.base);
    const res = await fpp.putPlaylist('ColdBoot', {
        name: 'ColdBoot',
        mainPlaylist: [{ type: 'sequence', sequenceName: SEQUENCE }],
    });
    expect(res.status).toBe(200);
}, 120_000);

afterAll(async () => {
    if (app) {
        await fpp.command('Stop Now').catch(() => undefined);
        console.log(`EZPlayer log: ${app.logFile}`);
        await app.stop();
    }
});

describe('a controller powered on mid-show', () => {
    it(
        'starts receiving data without the schedule being reloaded',
        async () => {
            if (!TARGET) return void console.warn('skipped: set COLDBOOT=<controller ip>');

            const before = await received();
            console.log(`target ${TARGET} before play: up=${before.up} ${before.detail}`);

            await fpp.command('Start Playlist', 'ColdBoot', 0, 0, 1); // repeat, so it outlasts the boot
            await fpp.waitForStatus((s) => s.status_name === 'playing', { label: 'cold boot play', timeoutMs: 30_000 });
            console.log('playing — power the controller on now\n');

            let firstUpAt: number | undefined;
            let packetsWhenUp = 0;
            let latest = before;
            const started = Date.now();

            while (Date.now() - started < WATCH_MS) {
                await new Promise((r) => setTimeout(r, 5000));
                latest = await received();
                const el = Math.round((Date.now() - started) / 1000);
                console.log(
                    `  t+${String(el).padStart(3)}s up=${latest.up ? 'yes' : 'no '} packets=${latest.packets} ${latest.detail}`,
                );

                if (latest.up && firstUpAt === undefined) {
                    firstUpAt = Date.now();
                    packetsWhenUp = latest.packets;
                    console.log(`  (controller answered at t+${el}s with ${packetsWhenUp} packets so far)`);
                }
                // Once it has been up a while, a climbing counter settles it.
                if (firstUpAt && Date.now() - firstUpAt > 30_000 && latest.packets > packetsWhenUp + 50) break;
            }

            expect(firstUpAt, 'the controller never came up — power it on while the test runs').toBeDefined();
            expect(latest.packets, `controller is up but took no data (${latest.detail})`).toBeGreaterThan(
                packetsWhenUp,
            );
        },
        WATCH_MS + 120_000,
    );
});
