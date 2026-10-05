/**
 * `pingtest` — check that ICMP works *in this install*.
 *
 * The unit tests prove the addon against a plain Node build. They cannot prove
 * the copy inside an installed app, where the binary has to match Electron's
 * ABI and architecture and be reachable in app.asar.unpacked. Running this verb
 * on the installed binary tests exactly that, with no window and no show folder.
 *
 * Two stages, because they fail for different reasons:
 *   addon  — load @ezplayer/icmp-ping here and ping. Catches ABI/arch/asar.
 *   worker — run the real pingworker thread, as the player does. Catches the
 *            worker's own resolution of the addon.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { PingConfig, PingStat, RoundResultMessage } from '../../mainsrc/workers/pingworker.js';

const DEFAULT_HOST = '127.0.0.1';
const PING_TIMEOUT_MS = 1000;
const ROUND_TIMEOUT_MS = 20_000;

/**
 * The compiled worker sits next to the bundle that imports it, but which bundle
 * that is depends on the build layout, so try the plausible spots and say which
 * one answered.
 */
function findWorker(): string | undefined {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(here, 'workers/pingworker.js'),
        path.resolve(here, 'pingworker.js'),
        path.resolve(here, '../workers/pingworker.js'),
        path.resolve(here, '../dist/workers/pingworker.js'),
    ];
    return candidates.find((c) => existsSync(c));
}

async function stageAddon(hosts: string[]): Promise<boolean> {
    let ping: (host: string, timeoutMs: number) => Promise<{ alive: boolean; elapsed: number; error?: string }>;
    try {
        ({ ping } = await import('@ezplayer/icmp-ping'));
    } catch (err) {
        console.error(`addon   FAIL  cannot load @ezplayer/icmp-ping: ${String(err)}`);
        return false;
    }

    let ok = true;
    for (const host of hosts) {
        const r = await ping(host, PING_TIMEOUT_MS);
        if (r.alive) {
            console.log(`addon   ok    ${host} replied in ${r.elapsed.toFixed(1)}ms`);
        } else {
            console.error(`addon   FAIL  ${host}: ${r.error ?? 'no reply'}`);
            ok = false;
        }
    }
    return ok;
}

async function stageWorker(hosts: string[]): Promise<boolean> {
    const workerPath = findWorker();
    if (!workerPath) {
        console.error('worker  FAIL  pingworker.js not found next to this bundle');
        return false;
    }

    const worker = new Worker(workerPath);
    const config: PingConfig = { hosts, intervalS: 1, maxSamples: 3, concurrency: hosts.length || 1 };

    try {
        const outcome = await new Promise<RoundResultMessage | string>((resolve) => {
            const timer = setTimeout(() => resolve(`no round result within ${ROUND_TIMEOUT_MS}ms`), ROUND_TIMEOUT_MS);
            const done = (v: RoundResultMessage | string) => {
                clearTimeout(timer);
                resolve(v);
            };
            worker.on('message', (msg: { type?: string; error?: string }) => {
                // The loop starts before our config lands, so early rounds are empty.
                if (msg.type === 'roundResult') {
                    const round = msg as RoundResultMessage;
                    if (hosts.every((h) => round.stats[h])) done(round);
                } else if (msg.type === 'error') done(`worker reported: ${msg.error}`);
            });
            worker.on('error', (err) => done(`worker threw: ${String(err)}`));
            worker.on('exit', (code) => done(`worker exited early with code ${code}`));
            worker.postMessage({ type: 'config', config });
        });

        if (typeof outcome === 'string') {
            console.error(`worker  FAIL  ${outcome}`);
            console.error(`              (${workerPath})`);
            return false;
        }

        let ok = true;
        for (const host of hosts) {
            const stat: PingStat = outcome.stats[host];
            if (stat.nReplies > 0) {
                console.log(`worker  ok    ${host} ${stat.nReplies}/${stat.outOf} replies`);
            } else {
                console.error(`worker  FAIL  ${host} 0/${stat.outOf} replies: ${stat.error ?? 'no reason given'}`);
                ok = false;
            }
        }
        return ok;
    } finally {
        await worker.terminate();
    }
}

export async function run(args: string[]): Promise<number> {
    const hosts = args.filter((a) => !a.startsWith('-'));
    const targets = hosts.length ? hosts : [DEFAULT_HOST];

    console.log(`EZPlayer ping self-test — ${process.platform}/${process.arch}, node ${process.versions.node}`);
    console.log(`targets: ${targets.join(', ')}\n`);

    const addonOk = await stageAddon(targets);
    const workerOk = await stageWorker(targets);

    console.log(
        `\n${addonOk && workerOk ? 'PASS' : 'FAIL'}: addon ${addonOk ? 'ok' : 'failed'}, worker ${workerOk ? 'ok' : 'failed'}`,
    );
    return addonOk && workerOk ? 0 : 1;
}
