// How much each app instance gets used, counted by the player alone: time its process was up,
// time it held a lease (so it was putting something into the show), and the web requests
// visitors made to it. Kept per show in `.ezplayer/apps-usage.json`.

import { promises as fsp } from 'node:fs';
import type { AppTraffic, AppUsage } from '@ezplayer/ezplayer-core';
import { atomicWriteFile } from '../data/atomicWrite.js';
import { settingsPath } from '../data/SettingsDir.js';

export const USAGE_FILE = 'apps-usage.json';
/** A gap longer than this between samples means the computer slept; count this much of it only. */
export const MAX_SAMPLE_MS = 15_000;

export interface RunningInstance {
    instance: string;
    appId: string;
    /** When this process started; a new value is a new run. */
    startedAt: number;
}

export function usageFilePath(showFolder: string): string {
    return settingsPath(showFolder, USAGE_FILE);
}

function validRecord(u: unknown): u is AppUsage {
    const r = u as AppUsage;
    return typeof r?.appId === 'string' && typeof r.runMs === 'number';
}

export class UsageLedger {
    records: Record<string, AppUsage> = {};
    private dirty = false;
    private lastSampleAt: number | undefined;
    private readonly seenStart = new Map<string, number>();

    constructor(private readonly file: string | undefined) {}

    static async load(file: string): Promise<UsageLedger> {
        const ledger = new UsageLedger(file);
        try {
            const raw = JSON.parse(await fsp.readFile(file, 'utf8')) as { instances?: Record<string, unknown> };
            for (const [name, rec] of Object.entries(raw.instances ?? {})) {
                if (validRecord(rec)) ledger.records[name] = { ...rec };
            }
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
                console.error('[apps] apps-usage.json unreadable, starting empty:', err);
            }
        }
        return ledger;
    }

    async save(force = false): Promise<void> {
        if (!this.file || (!this.dirty && !force)) return;
        this.dirty = false;
        await atomicWriteFile(this.file, JSON.stringify({ instances: this.records }, null, 2));
    }

    private record(instance: string, appId: string): AppUsage {
        let u = this.records[instance];
        if (!u) {
            u = { appId, runs: 0, runMs: 0, activeMs: 0, requests: 0, events: 0 };
            this.records[instance] = u;
        }
        this.dirty = true;
        return u;
    }

    /** Add the time since the last sample to every process up now, and to the lease time of those holding one. */
    sample(now: number, running: RunningInstance[], active: ReadonlySet<string>): void {
        const dt = this.lastSampleAt === undefined ? 0 : Math.min(MAX_SAMPLE_MS, Math.max(0, now - this.lastSampleAt));
        this.lastSampleAt = now;
        for (const r of running) {
            const u = this.record(r.instance, r.appId);
            if (this.seenStart.get(r.instance) !== r.startedAt) {
                this.seenStart.set(r.instance, r.startedAt);
                u.runs++;
                u.firstRunAt ??= r.startedAt;
                u.lastRunAt = r.startedAt;
            }
            u.runMs += dt;
            if (active.has(r.instance)) {
                u.activeMs += dt;
                u.lastActiveAt = now;
            }
        }
    }

    /** Visitor requests the server worker counted since it last told us. */
    addTraffic(counts: Record<string, AppTraffic>, appIdOf: (instance: string) => string | undefined): void {
        for (const [instance, t] of Object.entries(counts)) {
            const appId = this.records[instance]?.appId ?? appIdOf(instance);
            if (!appId) continue;
            const u = this.record(instance, appId);
            u.requests += t.requests;
            u.events += t.events;
        }
    }

    reset(): void {
        this.records = {};
        this.seenStart.clear();
        this.dirty = true;
    }
}
