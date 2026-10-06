/**
 * Pinging 127.0.0.1 needs no network, so a failure here is either our code or
 * the platform's ICMP permissions.
 *
 * Settling matters as much as succeeding: a ping that never resolves would
 * freeze the health pinger, so every assertion races a deadline rather than
 * waiting on the promise.
 *
 * Where unprivileged ICMP is turned off (Linux `net.ipv4.ping_group_range`,
 * containers) these skip with the reason, unless REQUIRE_ICMP=1 makes an
 * absent ICMP socket a failure instead.
 */

import { describe, it, expect } from 'vitest';
import { ping, shutdown, type PingResult } from '../src/index';

const REQUIRE_ICMP = process.env.REQUIRE_ICMP === '1';

/** Resolve to the ping result, or to a marker if it outlasts `ms`. */
async function within(p: Promise<PingResult>, ms: number): Promise<PingResult | 'hung'> {
    let timer: NodeJS.Timeout;
    const deadline = new Promise<'hung'>((resolve) => {
        timer = setTimeout(() => resolve('hung'), ms);
    });
    return Promise.race([p, deadline]).finally(() => clearTimeout(timer));
}

/** True when the platform refuses us an ICMP socket at all. */
function unavailable(r: PingResult | 'hung'): string | undefined {
    if (r !== 'hung' && !r.alive && r.error?.startsWith('ICMP socket unavailable')) return r.error;
    return undefined;
}

describe('icmp-ping loopback', () => {
    it('answers for 127.0.0.1', async () => {
        const result = await within(ping('127.0.0.1', 1000), 5000);
        expect(result, 'ping did not settle — the promise would hang forever').not.toBe('hung');

        const why = unavailable(result);
        if (why && !REQUIRE_ICMP) return void console.warn(`skipped: ${why}`);
        if (why) expect.fail(`REQUIRE_ICMP is set but: ${why}`);

        const r = result as PingResult;
        expect(r.alive, `expected loopback to answer, got ${JSON.stringify(r)}`).toBe(true);
        expect(typeof r.elapsed).toBe('number');
    });

    it('settles unreachable hosts as a timeout rather than hanging', async () => {
        // TEST-NET-1 (RFC 5737) — reserved for documentation, never routed.
        const result = await within(ping('192.0.2.1', 300), 5000);
        expect(result, 'timed-out ping did not settle').not.toBe('hung');

        const r = result as PingResult;
        if (unavailable(r)) return; // covered by the test above
        expect(r.alive).toBe(false);
        expect(r.error).toBeTruthy();
    });

    it('reports a bad hostname instead of hanging', async () => {
        const result = await within(ping('no-such-host.invalid', 1000), 8000);
        expect(result, 'DNS failure did not settle').not.toBe('hung');

        const r = result as PingResult;
        expect(r.alive).toBe(false);
        expect(r.error).toBeTruthy();
    });

    it('shuts down cleanly', () => {
        expect(() => shutdown()).not.toThrow();
    });
});
