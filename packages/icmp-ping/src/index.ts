/**
 * @ezplayer/icmp-ping
 *
 * Async ICMP ping via a native addon. The C++ side runs a single
 * long-lived ping-manager thread; JS callers get a Promise per ping.
 *
 * Originally lived at apps/ezplayer-ui-electron/mainsrc/icmp-ping/,
 * extracted into this package so multiple consumers (the Electron app's
 * pingworker, @ezplayer/epp-controllers' scanner) can share one
 * implementation.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

interface NativeAddon {
    ping(host: string, timeoutMs: number): Promise<PingResult>;
    shutdown(): void;
}

const addon: NativeAddon = require('bindings')('icmp_ping');

export interface PingResult {
    alive: boolean;
    elapsed: number;
    error?: string;
}

export function ping(host: string, timeoutMs: number): Promise<PingResult> {
    return addon.ping(host, timeoutMs);
}

/**
 * Stop accepting new pings, abort the TSFN so in-flight pings won't call
 * back into JS. Safe to call multiple times.
 */
export function shutdown(): void {
    addon.shutdown();
}
