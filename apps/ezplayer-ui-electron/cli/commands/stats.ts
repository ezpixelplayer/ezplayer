/**
 * `stats` — print the running player's playback statistics (the same numbers
 * as the Status screen's stats dialog), once or repeatedly. Pure HTTP.
 */

import { getPlaybackStats, postPlayerCommand, resolveHost, unreachableHint } from '../ezp-client.js';
import { formatStatsSnapshot, formatTraceLine, type StatsSample } from '../playback-stats.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function run(args: string[]): Promise<number> {
    let hostFlag: string | undefined;
    let json = false;
    let reset = false;
    let watchS: number | undefined;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--host') hostFlag = args[++i];
        else if (a === '--json') json = true;
        else if (a === '--reset') reset = true;
        else if (a === '--watch' || a === '-w') {
            const next = args[i + 1];
            const v = next && !next.startsWith('-') ? Number(args[++i]) : 1;
            if (!Number.isFinite(v) || v <= 0) {
                console.error('stats: --watch needs a positive number of seconds');
                return 2;
            }
            watchS = v;
        } else {
            console.error(`stats: unrecognized argument '${a}'`);
            return 2;
        }
    }
    const host = resolveHost(hostFlag);

    try {
        if (reset) await postPlayerCommand(host, { command: 'resetstats' });
    } catch {
        console.error(`stats: ${unreachableHint(host)}`);
        return 1;
    }

    const t0 = Date.now();
    let prev: StatsSample | undefined;
    for (;;) {
        let r: Awaited<ReturnType<typeof getPlaybackStats>>;
        try {
            r = await getPlaybackStats(host);
        } catch {
            console.error(`stats: ${unreachableHint(host)}`);
            return 1;
        }
        if (!r) {
            if (watchS === undefined) {
                console.error('stats: the player has not reported playback statistics yet');
                return 1;
            }
            process.stderr.write('(no playback statistics yet)\n');
        } else if (json) {
            process.stdout.write(JSON.stringify(r) + '\n');
        } else if (watchS !== undefined) {
            const sample: StatsSample = { t: Date.now() - t0, stats: r.stats };
            console.log(formatTraceLine(sample, prev));
            prev = sample;
        } else {
            const status = r.pStatus?.status ?? 'unknown';
            const np = r.pStatus?.now_playing?.title;
            console.log(`Player ${status}${np ? `: ${np}` : ''}`);
            for (const line of formatStatsSnapshot(r.stats)) console.log(line);
        }
        if (watchS === undefined) return 0;
        await sleep(watchS * 1000);
    }
}
