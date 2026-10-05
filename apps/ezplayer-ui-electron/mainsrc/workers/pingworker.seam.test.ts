/**
 * Runs the compiled worker as a real worker thread, which is the only way to
 * cover how it finds its native addon: @ezplayer/icmp-ping is kept external
 * when the main process is bundled so that bindings() resolves the .node
 * relative to the package's own dist/, and a bundling change can break that
 * while the addon itself still works.
 *
 * Needs a build first; with REQUIRE_ICMP=1 a missing build or an absent ICMP
 * socket fails instead of skipping.
 */

import { describe, it, expect } from 'vitest';
import { Worker } from 'node:worker_threads';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PingConfig, PingStat, RoundResultMessage } from './pingworker';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, '../../dist/workers/pingworker.js');
const REQUIRE_ICMP = process.env.REQUIRE_ICMP === '1';
const ROUND_TIMEOUT_MS = 20_000;

const CONFIG: PingConfig = {
    targets: [{ address: '127.0.0.1', icmp: true }],
    intervalS: 1,
    maxSamples: 3,
    concurrency: 4,
};

/**
 * First round result covering `host`, or why we didn't get one.  The worker
 * starts its loop before our config arrives, so the opening round or two are
 * empty; those are not the answer we're waiting for.
 */
function roundCovering(worker: Worker, host: string): Promise<RoundResultMessage | { failure: string }> {
    return new Promise((resolve) => {
        const timer = setTimeout(
            () => resolve({ failure: `no round result covering ${host} within ${ROUND_TIMEOUT_MS}ms` }),
            ROUND_TIMEOUT_MS,
        );
        const done = (v: RoundResultMessage | { failure: string }) => {
            clearTimeout(timer);
            resolve(v);
        };
        worker.on('message', (msg: { type?: string; error?: string }) => {
            if (msg.type === 'roundResult') {
                const round = msg as RoundResultMessage;
                if (round.stats[host]) done(round);
            } else if (msg.type === 'error') done({ failure: `worker reported: ${msg.error}` });
        });
        // An unloadable addon shows up here, as a module-load throw.
        worker.on('error', (err) => done({ failure: `worker threw: ${String(err)}` }));
        worker.on('exit', (code) => done({ failure: `worker exited early with code ${code}` }));
    });
}

describe('pingworker seam', () => {
    it('loads its native addon and reports a round for loopback', async () => {
        if (!existsSync(WORKER)) {
            const why = `${WORKER} not built — run pnpm build:tsc first`;
            if (REQUIRE_ICMP) expect.fail(why);
            return void console.warn(`skipped: ${why}`);
        }

        const worker = new Worker(WORKER);
        try {
            worker.postMessage({ type: 'config', config: CONFIG });
            const result = await roundCovering(worker, '127.0.0.1');

            if ('failure' in result) expect.fail(result.failure);

            const stat: PingStat = result.stats['127.0.0.1'];
            expect(stat.outOf).toBeGreaterThan(0);

            if (!REQUIRE_ICMP && stat.nReplies === 0) {
                return void console.warn(`skipped assertion: loopback did not answer (${stat.error})`);
            }
            expect(stat.nReplies, `loopback did not answer: ${stat.error ?? 'no reason given'}`).toBeGreaterThan(0);
        } finally {
            await worker.terminate();
        }
    }, 30_000);

    it('confirms a controller over its web service when ICMP is not used', async () => {
        // The shape of a controller behind an FPP proxy: no ICMP, one URL that
        // answers for it.  A plain local server stands in for the proxy.
        if (!existsSync(WORKER)) {
            const why = `${WORKER} not built — run pnpm build:tsc first`;
            if (REQUIRE_ICMP) expect.fail(why);
            return void console.warn(`skipped: ${why}`);
        }

        const server = createServer((_req, res) => {
            res.writeHead(200);
            res.end('ok');
        });
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const { port } = server.address() as AddressInfo;

        const worker = new Worker(WORKER);
        try {
            worker.postMessage({
                type: 'config',
                config: {
                    targets: [{ address: '127.0.0.1', icmp: false, webUrl: `http://127.0.0.1:${port}/` }],
                    intervalS: 1,
                    maxSamples: 3,
                    concurrency: 1,
                },
            });
            const result = await roundCovering(worker, '127.0.0.1');
            if ('failure' in result) expect.fail(result.failure);

            const stat: PingStat = result.stats['127.0.0.1'];
            expect(stat.nReplies, `web check did not answer: ${stat.error ?? 'no reason given'}`).toBeGreaterThan(0);
            expect(stat.via).toBe('web');
        } finally {
            await worker.terminate();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
    }, 30_000);
});
