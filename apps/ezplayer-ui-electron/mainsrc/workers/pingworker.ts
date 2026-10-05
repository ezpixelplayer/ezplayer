import { ping, shutdown } from '@ezplayer/icmp-ping';
import { parentPort } from 'node:worker_threads';

if (!parentPort) {
    throw new Error('ping-worker must be run as a worker thread');
}

/**
 * One controller to watch.  `icmp` is off for a controller reached through an
 * FPP proxy: the proxy forwards HTTP, so the controller itself can never answer
 * a ping.  `webUrl`, when set, confirms the controller over HTTP — directly, or
 * through the proxy — and is tried only when ICMP does not answer.
 */
export type PingTarget = {
    address: string;
    icmp: boolean;
    webUrl?: string;
};

export type PingConfig = {
    targets: PingTarget[];
    intervalS: number;
    maxSamples: number;
    concurrency: number;
    /** Min seconds between web checks of one controller.  Default 15. */
    webIntervalS?: number;
};

export type ParentMessage = { type: 'config'; config: PingConfig } | { type: 'stop' };

export interface PingStat {
    host: string;
    nReplies: number;
    outOf: number;
    avgResponseTime?: number;
    lastTime?: number;
    error?: string;
    /** How the last reply was obtained; absent when nothing answered. */
    via?: 'ping' | 'web';
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

const cfg: PingConfig = {
    targets: [],
    intervalS: 5,
    maxSamples: 10,
    concurrency: 64,
};

/** Last web check per controller, so a slower HTTP check can span rounds. */
type WebState = { at: number; alive: boolean; elapsed: number; error?: string };
const webStates = new Map<string, WebState>();

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
    const hostSet = new Set(cfg.targets.map((t) => t.address));
    for (const h of windows.keys()) {
        if (!hostSet.has(h)) {
            windows.delete(h);
        }
    }
    for (const h of webStates.keys()) {
        if (!hostSet.has(h)) {
            webStates.delete(h);
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
        const { targets, intervalS: intervalMs, maxSamples, concurrency, webIntervalS } = msg.config;

        if (typeof intervalMs === 'number') cfg.intervalS = intervalMs;
        if (typeof maxSamples === 'number') cfg.maxSamples = maxSamples;
        if (typeof concurrency === 'number') cfg.concurrency = concurrency;
        if (typeof webIntervalS === 'number') cfg.webIntervalS = webIntervalS;

        if (Array.isArray(targets)) {
            cfg.targets = targets.slice();
            pruneWindowsForCurrentHosts();
        }
    }
});

/**
 * Per-ping reply budget; LAN-like timing.
 */
const PING_TIMEOUT_MS = 300;

/** Per-web-check budget; an HTTP round trip through a proxy is not LAN-fast. */
const WEB_TIMEOUT_MS = 2000;
const DEFAULT_WEB_INTERVAL_S = 15;

/**
 * GET the controller's web service.  Any HTTP answer counts, including 401 or
 * 404 — the controller replied, which is the question being asked.
 */
async function webProbe(url: string): Promise<{ alive: boolean; elapsed: number; error?: string }> {
    const started = Date.now();
    try {
        await fetch(url, { signal: AbortSignal.timeout(WEB_TIMEOUT_MS), redirect: 'manual' });
        return { alive: true, elapsed: Date.now() - started };
    } catch (e) {
        return { alive: false, elapsed: Date.now() - started, error: `web: ${(e as Error).message}` };
    }
}

/** Cached web state for a target, refreshed no more often than webIntervalS. */
async function webState(target: PingTarget): Promise<WebState | undefined> {
    if (!target.webUrl) return undefined;
    const ttl = (cfg.webIntervalS ?? DEFAULT_WEB_INTERVAL_S) * 1000;
    const prev = webStates.get(target.address);
    const now = Date.now();
    if (prev && now - prev.at < ttl) return prev;
    const probed = await webProbe(target.webUrl);
    const state: WebState = { at: now, ...probed };
    webStates.set(target.address, state);
    return state;
}

/**
 * One reachability sample for one controller: ICMP when it applies, otherwise
 * (or on no reply) the web check.  Exactly one sample is added per round, so a
 * controller confirmed only by web does not flap between rounds that check it
 * and rounds that reuse the cached result.
 */
async function checkTarget(target: PingTarget): Promise<PingStat> {
    const window = ensureWindow(target.address);

    let alive = false;
    let elapsed = 0;
    let via: 'ping' | 'web' | undefined;
    let error: string | undefined;

    if (target.icmp) {
        const res = await ping(target.address, PING_TIMEOUT_MS);
        if (res.alive) {
            alive = true;
            elapsed = res.elapsed;
            via = 'ping';
        } else {
            error = res.error;
        }
    }

    if (!alive) {
        const web = await webState(target);
        if (web?.alive) {
            alive = true;
            elapsed = web.elapsed;
            via = 'web';
            error = undefined;
        } else if (web?.error && !target.icmp) {
            error = web.error;
        }
    }

    window.add(alive ? elapsed : undefined);
    const report = window.getReport(target.address);
    if (via) report.via = via;
    // Carry the reason up; the reply counts alone don't say why.
    if (!alive && error) report.error = error;
    return report;
}

async function pingRoundOnce(): Promise<{ [address: string]: PingStat }> {
    const snapshot = cfg.targets.slice();
    const reports: { [address: string]: PingStat } = {};

    if (snapshot.length === 0) {
        return reports;
    }

    const limit = Math.max(1, cfg.concurrency);

    for (let i = 0; i < snapshot.length; i += limit) {
        const chunk = snapshot.slice(i, i + limit);
        const chunkReports = await Promise.all(chunk.map((t) => checkTarget(t)));
        for (let j = 0; j < chunk.length; ++j) {
            reports[chunk[j].address] = chunkReports[j];
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
