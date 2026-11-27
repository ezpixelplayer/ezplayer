// Player apps: the controller that owns installed packages, instances and their
// processes for the open show. Routes, data and events live in the server worker
// (workers/apps-api.ts); this side tells it which instances exist, with their tokens.

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import type {
    AppInstanceRecord,
    AppInstanceStatus,
    AppsCommand,
    AppTraffic,
    AppsState,
    CloudPollScheduleEntry,
    InstalledApp,
} from '@ezplayer/ezplayer-core';
import { findMatchingScheduleEntry } from '@ezplayer/ezplayer-core';
import { logsDir } from '../applog.js';
import { playWorkerAudio, playWorkerOverlay } from '../ipcezplayer.js';
import { broadcastToWebSocket, getServerStatus, setAppsAuth, type AppsAuthEntry } from '../server-worker-manager.js';
import { examplesDir, installApps, uninstallApp } from './apps-install.js';
import { APP_NAME_RE, runsHere } from './apps-manifest.js';
import { checkPython, findPythonCandidates, resetRuntimeCache } from './apps-runtime.js';
import { appDataDir, loadAppsFile, saveAppsFile, scanInstalledApps, type AppsFile } from './apps-store.js';
import { sweepStale, writeRunning, type RunningFile } from './apps-stale.js';
import { AppProcess } from './apps-supervisor.js';
import { UsageLedger, usageFilePath, type RunningInstance } from './apps-usage.js';

const SCHEDULE_TICK_MS = 30_000;
const USAGE_TICK_MS = 5_000;
const USAGE_SAVE_MS = 60_000;

let showFolder: string | undefined;
let file: AppsFile = { instances: [], defaultSchedule: [], inputMappings: [] };
let installed: InstalledApp[] = [];
const processes = new Map<string, AppProcess>();
let lastError: string | undefined;
let pythonCandidates: { path: string; version: string }[] | undefined;
let tick: NodeJS.Timeout | undefined;
let publishTimer: NodeJS.Timeout | undefined;
let usage = new UsageLedger(undefined);
let usageTick: NodeJS.Timeout | undefined;
let lastUsageSave = 0;

/** "Front Tree" becomes `front-tree`: the URL-safe instance name for a title people typed. */
export function slugifyName(title: string): string {
    return title
        .normalize('NFKD')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40);
}

function appById(id: string): InstalledApp | undefined {
    return installed.find((a) => a.id === id);
}

/** Empty schedule means always. */
function available(rec: AppInstanceRecord, now = new Date()): boolean {
    const schedule: CloudPollScheduleEntry[] = rec.schedule ?? file.defaultSchedule;
    return schedule.length === 0 || findMatchingScheduleEntry(schedule, now) !== null;
}

function statusOf(rec: AppInstanceRecord): AppInstanceStatus {
    const p = processes.get(rec.name);
    const app = appById(rec.appId);
    let state = p?.view.state ?? 'stopped';
    if (!app?.manifest) state = 'missing';
    else if (!rec.enabled) state = 'disabled';
    else if (!p && !available(rec)) state = 'unavailable';
    return {
        ...rec,
        state,
        pid: p?.view.pid,
        restarts: p?.view.restarts ?? 0,
        report: p?.view.report ?? { logTail: [] },
    };
}

export function getAppsState(): AppsState {
    return {
        apps: installed,
        instances: file.instances.map(statusOf),
        defaultSchedule: file.defaultSchedule,
        pythonPath: file.pythonPath,
        pythonCandidates,
        inputMappings: file.inputMappings,
        usage: usage.records,
        lastError,
        hasExamples: examplesDir() !== undefined,
    };
}

/** Stop an app's instances, run `work` (an install), then start them again. */
async function withInstancesStopped(appId: string, work: () => Promise<void>): Promise<void> {
    for (const rec of file.instances) {
        const p = processes.get(rec.name);
        if (rec.appId !== appId || !p) continue;
        await p.stop();
        processes.delete(rec.name);
    }
    publish();
    try {
        await work();
    } finally {
        installed = await scanInstalledApps(showFolder!);
        await reconcile();
    }
}

/** Push state to viewers and the instance secrets to the server worker. Coalesced. */
function publish(): void {
    if (publishTimer) return;
    publishTimer = setTimeout(() => {
        publishTimer = undefined;
        publishNow();
    }, 50);
}

export function publishNow(): void {
    broadcastToWebSocket('apps', getAppsState());
    // The pids on disk let the next player kill what this one leaves behind if it dies.
    if (showFolder) {
        const running: RunningFile = {};
        for (const [name, p] of processes) {
            const rec = file.instances.find((i) => i.name === name);
            const script = appById(rec?.appId ?? '')?.manifest?.start[0];
            if (p.view.pid && script)
                running[name] = { pid: p.view.pid, script, startedAt: p.view.report.startedAt ?? 0 };
        }
        void writeRunning(showFolder, running);
    }
    const auth: Record<string, AppsAuthEntry> = {};
    for (const rec of file.instances) {
        const app = appById(rec.appId);
        const p = processes.get(rec.name);
        if (!app?.manifest || !showFolder) continue;
        auth[rec.name] = {
            appId: rec.appId,
            appDir: app.dir,
            dataDir: appDataDir(showFolder, rec.name),
            page: app.manifest.page,
            config: app.manifest.config,
            inputs: (app.manifest.inputs ?? []).map((i) => i.name),
            token: p?.view.token,
            port: p?.view.port,
            running: p?.view.state === 'running' || p?.view.state === 'starting',
            title: rec.title ?? app.manifest.name,
            icon: app.manifest.icon,
            description: rec.description ?? app.manifest.description,
            eventsPerMinute: rec.eventsPerMinute ?? app.manifest.events?.perMinute,
            clientPerSecond: app.manifest.events?.perClientPerSecond,
        };
    }
    setAppsAuth(auth);
}

function spawnFor(rec: AppInstanceRecord): AppProcess | undefined {
    const app = appById(rec.appId);
    if (!app?.manifest || !showFolder) return undefined;
    const apiPort = getServerStatus()?.port;
    if (!apiPort) return undefined;
    const proc = new AppProcess(
        {
            instance: rec.name,
            manifest: app.manifest,
            appDir: app.dir,
            dataDir: appDataDir(showFolder, rec.name),
            showFolder,
            apiPort,
            pythonPath: file.pythonPath,
            logFile: path.join(logsDir(), 'apps', `${rec.name}.log`),
        },
        () => publish(),
    );
    processes.set(rec.name, proc);
    return proc;
}

/** Start what should run and stop what should not, per enabled flags and schedules. */
async function reconcile(): Promise<void> {
    for (const rec of file.instances) {
        const app = appById(rec.appId);
        const want = !!app?.manifest && runsHere(app.manifest) && rec.enabled && available(rec);
        const have = processes.get(rec.name);
        if (want && !have) {
            const p = spawnFor(rec);
            if (p) await p.start();
        } else if (!want && have) {
            await have.stop();
            processes.delete(rec.name);
        }
    }
    // Instances that were removed while running.
    for (const [name, p] of processes) {
        if (!file.instances.some((r) => r.name === name)) {
            await p.stop();
            processes.delete(name);
        }
    }
    publish();
}

/** Count the moment for every process up now, and as active for those holding a lease. */
async function sampleUsage(): Promise<void> {
    const running: RunningInstance[] = [];
    for (const [name, p] of processes) {
        const rec = file.instances.find((i) => i.name === name);
        const startedAt = p.view.report.startedAt;
        if (rec && p.view.pid && startedAt) running.push({ instance: name, appId: rec.appId, startedAt });
    }
    const active = new Set<string>();
    if (running.length) {
        // A lease an app opened carries its instance; holding one is what counts as active.
        const [ov, au] = await Promise.all([playWorkerOverlay({ op: 'list' }), playWorkerAudio({ op: 'list' })]);
        if (ov.ok && 'leases' in ov) for (const l of ov.leases) if (l.owner) active.add(l.owner.instance);
        if (au.ok && 'leases' in au) for (const l of au.leases) if (l.owner) active.add(l.owner.instance);
    }
    const now = Date.now();
    usage.sample(now, running, active);
    if (now - lastUsageSave >= USAGE_SAVE_MS) {
        lastUsageSave = now;
        await usage.save();
    }
}

/** The server worker's count of visitor requests per instance since it last told us. */
export function appsTraffic(counts: Record<string, AppTraffic>): void {
    usage.addTraffic(counts, (instance) => file.instances.find((i) => i.name === instance)?.appId);
}

/** Called when a show folder is opened; stops whatever the previous show ran. */
export async function appsLoadShow(folder: string): Promise<void> {
    await appsStopAll();
    showFolder = folder;
    lastError = undefined;
    await sweepStale(folder);
    file = await loadAppsFile(folder);
    usage = await UsageLedger.load(usageFilePath(folder));
    lastUsageSave = Date.now();
    installed = await scanInstalledApps(folder);
    await reconcile();
    tick ??= setInterval(() => void reconcile(), SCHEDULE_TICK_MS);
    tick.unref?.();
    usageTick ??= setInterval(() => void sampleUsage().catch(() => undefined), USAGE_TICK_MS);
    usageTick.unref?.();
}

/** The server worker just came up (or back); it needs the state and the secrets again. */
export async function appsServerReady(): Promise<void> {
    // Processes started before the web port was known could not be spawned; try again.
    await reconcile();
}

export async function appsStopAll(): Promise<void> {
    if (tick) {
        clearInterval(tick);
        tick = undefined;
    }
    if (usageTick) {
        clearInterval(usageTick);
        usageTick = undefined;
    }
    // The last stretch counts too, then the ledger goes to disk before the show changes.
    await sampleUsage().catch(() => undefined);
    await Promise.all([...processes.values()].map((p) => p.stop()));
    processes.clear();
    await usage.save().catch((err) => console.error('[apps] apps-usage.json not saved:', err));
    publish();
}

/** The worker saw a status from this instance; the report notes the first one. */
export function appsSawStatus(instance: string): void {
    processes.get(instance)?.sawStatus();
}

async function save(): Promise<void> {
    if (showFolder) await saveAppsFile(showFolder, file);
}

export async function appsCommand(cmd: AppsCommand): Promise<AppsState> {
    if (!showFolder) throw new Error('no show folder is open');
    lastError = undefined;
    // Every verb is logged so a stopped or restarted instance can be traced to its cause.
    const what = 'name' in cmd ? cmd.name : 'appId' in cmd ? cmd.appId : '';
    console.log(`[apps] ${cmd.op}${what ? ` ${what}` : ''}`);
    try {
        await run(cmd);
    } catch (err) {
        lastError = (err as Error).message;
        console.error('[apps] command failed:', cmd.op, err);
    }
    publishNow();
    return getAppsState();
}

async function run(cmd: AppsCommand): Promise<void> {
    const folder = showFolder!;
    switch (cmd.op) {
        case 'rescan':
            installed = await scanInstalledApps(folder);
            await reconcile();
            return;
        case 'install': {
            const r = await installApps(folder, cmd.source);
            installed = await scanInstalledApps(folder);
            for (const name of processes.keys()) {
                // A reinstalled app gets its new code by restarting.
                const rec = file.instances.find((i) => i.name === name);
                if (rec && r.installed.includes(rec.appId)) await processes.get(name)?.restart();
            }
            await reconcile();
            if (r.skipped.length) throw new Error(`skipped: ${r.skipped.join('; ')}`);
            return;
        }
        case 'update': {
            const app = appById(cmd.appId);
            if (!app) throw new Error(`${cmd.appId} is not installed`);
            if (!app.source) throw new Error(`${cmd.appId} was not installed from a source the player can fetch again`);
            // A fetched package is replaced while its processes are down, so none runs half-old code.
            let r: { skipped: string[] } = { skipped: [] };
            await withInstancesStopped(cmd.appId, async () => {
                r = await installApps(folder, app.source!);
            });
            if (r.skipped.length) throw new Error(`skipped: ${r.skipped.join('; ')}`);
            return;
        }
        case 'findPython':
            pythonCandidates = findPythonCandidates();
            publish();
            return;
        case 'uninstall':
            for (const rec of file.instances) {
                if (rec.appId !== cmd.appId) continue;
                await processes.get(rec.name)?.stop();
                processes.delete(rec.name);
            }
            await uninstallApp(folder, cmd.appId);
            installed = await scanInstalledApps(folder);
            publish();
            return;
        case 'createInstance': {
            const title = cmd.title?.trim().slice(0, 80) || undefined;
            const name = cmd.name || slugifyName(title ?? '');
            if (!APP_NAME_RE.test(name)) throw new Error('name: lower-case letters, digits and dashes, up to 40');
            if (file.instances.some((i) => i.name === name)) throw new Error(`an instance named ${name} exists`);
            if (!appById(cmd.appId)?.manifest) throw new Error(`${cmd.appId} is not an installed app`);
            file.instances.push({ name, appId: cmd.appId, enabled: false, title });
            await save();
            publish();
            return;
        }
        case 'removeInstance': {
            await processes.get(cmd.name)?.stop();
            processes.delete(cmd.name);
            file.instances = file.instances.filter((i) => i.name !== cmd.name);
            file.inputMappings = file.inputMappings.filter((m) => m.instance !== cmd.name);
            await save();
            if (!cmd.keepData) await fsp.rm(appDataDir(folder, cmd.name), { recursive: true, force: true });
            publish();
            return;
        }
        case 'setInstance': {
            const rec = file.instances.find((i) => i.name === cmd.name);
            if (!rec) throw new Error(`no instance named ${cmd.name}`);
            const { enabled, schedule, title, description, eventsPerMinute } = cmd.patch;
            if (enabled !== undefined) rec.enabled = !!enabled;
            if (schedule !== undefined) rec.schedule = schedule ?? undefined;
            if (title !== undefined) rec.title = title.trim() ? title.trim().slice(0, 80) : undefined;
            if (description !== undefined) {
                rec.description = description.trim() ? description.trim().slice(0, 300) : undefined;
            }
            if (eventsPerMinute !== undefined) {
                rec.eventsPerMinute = Number.isFinite(eventsPerMinute) ? Math.max(1, eventsPerMinute) : undefined;
            }
            await save();
            await reconcile();
            return;
        }
        case 'start': {
            const rec = file.instances.find((i) => i.name === cmd.name);
            if (!rec) throw new Error(`no instance named ${cmd.name}`);
            if (!rec.enabled) {
                rec.enabled = true;
                await save();
            }
            const p = processes.get(cmd.name) ?? spawnFor(rec);
            if (p) await p.restart();
            publish();
            return;
        }
        case 'stop': {
            const rec = file.instances.find((i) => i.name === cmd.name);
            if (!rec) throw new Error(`no instance named ${cmd.name}`);
            rec.enabled = false;
            await save();
            await processes.get(cmd.name)?.stop();
            processes.delete(cmd.name);
            publish();
            return;
        }
        case 'restart':
            await processes.get(cmd.name)?.restart();
            publish();
            return;
        case 'setDefaultSchedule':
            file.defaultSchedule = cmd.schedule;
            await save();
            await reconcile();
            return;
        case 'setPythonPath': {
            const p = cmd.path.trim();
            if (p) {
                // Saved only when it answers as a Python 3, so a typo cannot break every Python app.
                const check = checkPython(p);
                if ('error' in check) throw new Error(check.error);
            }
            file.pythonPath = p || undefined;
            resetRuntimeCache();
            await save();
            for (const [name, p] of processes) {
                const rec = file.instances.find((i) => i.name === name);
                if (appById(rec?.appId ?? '')?.manifest?.runtime === 'python3') await p.restart();
            }
            publish();
            return;
        }
        case 'setInputMappings':
            file.inputMappings = cmd.mappings.filter(
                (m) => APP_NAME_RE.test(m.instance) && typeof m.source === 'string' && typeof m.name === 'string',
            );
            await save();
            publish();
            return;
        case 'resetUsage':
            usage.reset();
            await usage.save();
            publish();
            return;
    }
}
