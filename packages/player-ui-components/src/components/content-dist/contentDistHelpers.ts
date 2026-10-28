/**
 * Shared reading of the broadcast content-distribution state: the one-line
 * summary the Show Status card shows, and the per-item pivot the details
 * dialog draws.
 */

import type {
    ContentDistItem,
    ContentDistReport,
    ContentDistRun,
    ContentDistState,
    ControllerContentStatus,
    DiscoveredController,
} from '@ezplayer/ezplayer-core';
import { contentTargetFailed, needsContentDelivery } from '@ezplayer/ezplayer-core';

export function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let n = bytes;
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
        n /= 1024;
        i++;
    }
    return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

export function formatDuration(ms: number): string {
    if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.round((ms % 60_000) / 1000);
    return `${m}m ${s}s`;
}

/** Devices that hold their own copy of the show — the rows a run covers. */
export function contentTargets(devices: Record<string, DiscoveredController>): DiscoveredController[] {
    return Object.values(devices)
        .filter((d) => d.driverType === 'FPP')
        .sort((a, b) => (a.hostname ?? a.ip).localeCompare(b.hostname ?? b.ip));
}

/**
 * Whether the Show Status screen should carry the distribution card: a device
 * that holds content is known, or the feature has been set up or used. Shows
 * with no such player never see it.
 */
export function hasContentDistribution(
    devices: Record<string, DiscoveredController>,
    mode: string | undefined,
    contentDist: ContentDistState | undefined,
): boolean {
    return contentTargets(devices).length > 0 || (!!mode && mode !== 'off') || !!contentDist?.lastReport;
}

export interface ContentDistSummary {
    /** The headline, always a complete sentence fragment. */
    text: string;
    severity: 'ok' | 'attention' | 'busy' | 'idle';
    /** 0..1 while a run is in flight. */
    fraction?: number;
    /** Devices a run would send something to. */
    behind: number;
    /** Devices that hold the show as it is now. */
    current: number;
    /** Devices we have never checked. */
    unknown: number;
}

/**
 * What to say about distribution right now. A run in flight wins; otherwise the
 * devices' own last-known state does, since that is what a user acts on.
 */
export function contentDistSummary(
    contentDist: ContentDistState | undefined,
    targets: DiscoveredController[],
): ContentDistSummary {
    const run = contentDist?.run;
    if (run) {
        const done = run.targets.filter((t) => t.phase === 'done' || t.phase === 'failed').length;
        return {
            text: `${run.checkOnly ? 'Checking' : 'Sending'} — ${done} of ${run.targets.length} device${
                run.targets.length === 1 ? '' : 's'
            }${run.bytesTotal > 0 ? `, ${formatBytes(run.bytesSent)} of ${formatBytes(run.bytesTotal)}` : ''}`,
            severity: 'busy',
            fraction: run.fraction,
            behind: 0,
            current: 0,
            unknown: 0,
        };
    }

    let behind = 0;
    let current = 0;
    let unknown = 0;
    for (const dev of targets) {
        if (!dev.contentStatus) unknown++;
        else if (needsContentDelivery(dev.contentStatus)) behind++;
        else current++;
    }

    const queued = contentDist?.queued?.length ?? 0;
    if (!targets.length) {
        return { text: 'No FPP devices found yet', severity: 'idle', behind, current, unknown };
    }
    if (behind > 0) {
        const bytes = targets.reduce((n, d) => n + (d.contentStatus?.missingBytes ?? 0), 0);
        return {
            text: `${behind} device${behind === 1 ? '' : 's'} need${behind === 1 ? 's' : ''} content${
                bytes > 0 ? ` — ${formatBytes(bytes)}` : ''
            }`,
            severity: 'attention',
            behind,
            current,
            unknown,
        };
    }
    if (queued > 0) {
        return {
            text: `${queued} new sequence${queued === 1 ? '' : 's'} waiting to be sent`,
            severity: 'attention',
            behind,
            current,
            unknown,
        };
    }
    if (unknown === targets.length) {
        return {
            text: `${targets.length} device${targets.length === 1 ? '' : 's'} not checked yet`,
            severity: 'idle',
            behind,
            current,
            unknown,
        };
    }
    return {
        text: `${current} device${current === 1 ? '' : 's'} up to date${unknown > 0 ? `, ${unknown} not checked` : ''}`,
        severity: 'ok',
        behind,
        current,
        unknown,
    };
}

/** Why automatic distribution is quiet, in words, or undefined when it is on. */
export function autoHoldText(contentDist: ContentDistState | undefined): string | undefined {
    switch (contentDist?.autoHold) {
        case 'off':
            return 'Automatic distribution is off';
        case 'outside-window':
            return 'Outside the distribution window';
        default:
            return undefined;
    }
}

/** One row of the details dialog: a file, and what happened to it per device. */
export interface ContentItemRow {
    name: string;
    kind: ContentDistItem['kind'];
    /** Per-device outcome, keyed by device id; absent where the run skipped it. */
    byTarget: Map<string, ContentDistItem>;
}

/**
 * Pivot a report into one row per file. Sequences first, then the media they
 * name, then the inventory playlist — reading order rather than alphabetical,
 * since a sequence and its audio belong together.
 */
export function itemRows(report: ContentDistReport | undefined): ContentItemRow[] {
    if (!report) return [];
    const rows = new Map<string, ContentItemRow>();
    const order: ContentDistItem['kind'][] = ['sequence', 'media', 'playlist'];
    for (const target of report.targets) {
        for (const item of target.items) {
            const key = `${item.kind}\u0000${item.name}`;
            let row = rows.get(key);
            if (!row) {
                row = { name: item.name, kind: item.kind, byTarget: new Map() };
                rows.set(key, row);
            }
            row.byTarget.set(target.id, item);
        }
    }
    return [...rows.values()].sort(
        (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.name.localeCompare(b.name),
    );
}

/** Devices that came out of the run behind the show. */
export function failedTargets(report: ContentDistReport | undefined): string[] {
    return (report?.targets ?? []).filter(contentTargetFailed).map((t) => t.label);
}

/** The detail lines for one device's row in the controllers grid. */
export function contentStatusLines(status: ControllerContentStatus): string[] {
    const lines: string[] = [];
    if (status.error) lines.push(status.error);
    lines.push(`${status.current} item${status.current === 1 ? '' : 's'} current`);
    if (status.missing > 0) lines.push(`${status.missing} to send (${formatBytes(status.missingBytes)})`);
    if (status.failed > 0) lines.push(`${status.failed} failed`);
    if (status.uploadMethod) {
        lines.push(status.uploadMethod === 'patch' ? 'chunked upload (FPP 7+)' : 'upload and move (FPP 6)');
    }
    return lines;
}

/** Progress of one device in the live run, if it is in one. */
export function targetProgress(run: ContentDistRun | undefined, id: string) {
    return run?.targets.find((t) => t.id === id);
}
