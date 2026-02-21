import { ping, shutdown } from '../icmp-ping/icmpping';
import { parentPort } from 'node:worker_threads';

if (!parentPort) {
    throw new Error('ping-worker must be run as a worker thread');
}

export type PingConfig = {
    hosts: string[];
    intervalS: number;
    maxSamples: number;
    concurrency: number;
};

export type ParentMessage = { type: 'config'; config: PingConfig } | { type: 'stop' };

export interface PingStat {
    host: string;
    nReplies: number;
    outOf: number;
    avgResponseTime?: number;
    lastTime?: number;
    error?: string;
}

export type RoundResultMessage = {
    type: 'roundResult';
    startedAt: number;
    finishedAt: number;
    stats: { [address: string]: PingStat };
};

export type StoppedMessage = {
    type: 'stopped';
};

export class RollingSuccessWindow {
    private readonly responseTimeBuffer: (number | undefined)[];
    private readonly maxSamples: number;

    private nextIndex = 0; // where the next sample will go
    private size = 0; // how many samples we actually have (<= maxSamples)
    private nSuccesses = 0; // sum of successes in the window
    private totalTime = 0;
    private lastTime?: number = undefined;

    constructor(maxSamples = 10) {
        if (maxSamples <= 0) {
            throw new Error('maxSamples must be > 0');
        }
        this.maxSamples = maxSamples;
        this.responseTimeBuffer = new Array(maxSamples).fill(0);
    }

    /**
     * Add a sample: number = success (response time), undefined = failure.
     * Evicts the oldest when we exceed maxSamples.
     */
    add(result: number | undefined): void {
        if (this.size < this.maxSamples) {
            this.size++;
        } else {
            // Buffer is full: evict the oldest (at nextIndex) and insert new
            const evicted = this.responseTimeBuffer[this.nextIndex];
            this.nSuccesses -= evicted !== undefined ? 1 : 0;
            this.totalTime -= evicted ?? 0;
        }
        this.nSuccesses += result !== undefined ? 1 : 0;
        this.totalTime += result ?? 0;
        this.responseTimeBuffer[this.nextIndex] = result;
        this.nextIndex = (this.nextIndex + 1) % this.maxSamples;
        this.lastTime = Date.now();
    }

    /**
     * Get aggregate info about the current window.
     */
    getReport(host: string): PingStat {
        const sampleCount = this.size;
        const successCount = this.nSuccesses;
        const avgResponseTime = successCount > 0 ? this.totalTime / successCount : undefined;

        return {
            host,
            nReplies: successCount,
            outOf: sampleCount,
            avgResponseTime,
            lastTime: this.lastTime,
        };
    }

    /**
     * Reset everything.
     */
    clear(): void {
        this.responseTimeBuffer.fill(0);
        this.nextIndex = 0;
        this.size = 0;
        this.nSuccesses = 0;
    }
}

const windows = new Map<string, RollingSuccessWindow>();

let cfg: PingConfig = {
    hosts: [],
    intervalS: 5,
    maxSamples: 10,
    concurrency: 10,
};

let running = true;

function ensureWindow(host: string): RollingSuccessWindow {
    let w = windows.get(host);
    if (!w) {
        w = new RollingSuccessWindow(cfg.maxSamples);
        windows.set(host, w);
    }
    return w;
}

function pruneWindowsForCurrentHosts() {
    const hostSet = new Set(cfg.hosts);
    for (const h of windows.keys()) {
        if (!hostSet.has(h)) {
            windows.delete(h);
        }
    }
}

parentPort.on('message', (msg: ParentMessage) => {
    if (msg.type === 'stop') {
        running = false;
        shutdown(); // Abort native TSFN — prevents callbacks from in-flight pings
        const stopped: StoppedMessage = { type: 'stopped' };
        parentPort!.postMessage(stopped);
        return;
    }

    if (msg.type === 'config') {
        //console.log(`Configuring ping: ${os.platform}/${process.env.SystemRoot}`)
        const { hosts, intervalS: intervalMs, maxSamples, concurrency } = msg.config;

        if (typeof intervalMs === 'number') cfg.intervalS = intervalMs;
        if (typeof maxSamples === 'number') cfg.maxSamples = maxSamples;
        if (typeof concurrency === 'number') cfg.concurrency = concurrency;

        if (Array.isArray(hosts)) {
            cfg.hosts = hosts.slice();
            pruneWindowsForCurrentHosts();
        }
    }
});

async function pingHost(host: string): Promise<PingStat> {
    const window = ensureWindow(host);
    const res = await ping(host, 1000);
    window.add(res.alive ? res.elapsed : undefined);
    return window.getReport(host);
}

async function pingRoundOnce(): Promise<{ [address: string]: PingStat }> {
    const hostsSnapshot = cfg.hosts.slice();
    const reports: { [address: string]: PingStat } = {};

    if (hostsSnapshot.length === 0) {
        return reports;
    }

    const limit = Math.max(1, cfg.concurrency);

    for (let i = 0; i < hostsSnapshot.length; i += limit) {
        const chunk = hostsSnapshot.slice(i, i + limit);
        const chunkReports = await Promise.all(chunk.map((h) => pingHost(h)));
        for (let j = 0; j < chunk.length; ++j) {
            reports[chunk[j]] = chunkReports[j];
        }
    }

    return reports;
}

(async function mainLoop() {
    while (running) {
        const startedAt = Date.now();

        const reports = await pingRoundOnce();

        const finishedAt = Date.now();
        const msg: RoundResultMessage = {
            type: 'roundResult',
            startedAt,
            finishedAt,
            stats: reports,
        };
        if (!running) break;
        parentPort!.postMessage(msg);

        const elapsed = finishedAt - startedAt;
        const delayMS = Math.max(0, cfg.intervalS * 1000 - elapsed);
        if (!running) break;
        if (delayMS > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMS));
        }
    }
})().catch((err) => {
    parentPort!.postMessage({
        type: 'error',
        error: String(err),
    });
});
