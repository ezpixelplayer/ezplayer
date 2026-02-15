import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const addon = require('bindings')('icmp_ping');

export interface PingResult {
    alive: boolean;
    elapsed: number;
    error?: string;
}

export function ping(host: string, timeoutMs: number): Promise<PingResult> {
    return addon.ping(host, timeoutMs);
}
