/**
 * `distribute` — send the show's content to the devices that hold their own
 * copy of it, or check what they are missing. Runs THROUGH the running app,
 * which owns the show, the controller records and the report.
 */

import type { ContentDistReport, ContentDistTargetReport, ContentItemAction } from '@ezplayer/ezplayer-core';
import { contentTargetFailed } from '@ezplayer/ezplayer-core';
import { getOpsState, isIpv4, postCommand, resolveHost, unreachableHint } from '../ezp-client.js';

export interface DistributeArgs {
    /** Known controller names or IPv4 addresses; empty means every device that should hold content. */
    targets: string[];
    /** Sequence file names; empty means the whole show. */
    sequences: string[];
    check: boolean;
    force: boolean;
    json: boolean;
    host?: string;
}

export function parseArgs(args: string[]): DistributeArgs | { error: string } {
    const out: DistributeArgs = { targets: [], sequences: [], check: false, force: false, json: false };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--host') out.host = args[++i];
        else if (a === '--check') out.check = true;
        else if (a === '--force') out.force = true;
        else if (a === '--json') out.json = true;
        else if (a === '--sequence') {
            const v = args[++i];
            if (!v) return { error: '--sequence needs a sequence file name' };
            out.sequences.push(v);
        } else if (!a.startsWith('-')) out.targets.push(a);
        else return { error: `unrecognized argument '${a}'` };
    }
    if (out.check && out.force) return { error: '--check and --force cannot be combined' };
    return out;
}

/** The part of the app's state that naming a target needs. */
export interface TargetLookup {
    known?: { name: string; address?: string }[];
    devices: Record<string, { id: string; ip: string; hostname?: string }>;
}

/**
 * Turn names and addresses into the device ids the dispatcher wants. A
 * controller that was never scanned has no device entry; the app then knows it
 * by its record address, so that id is used.
 */
export function resolveTargetIds(state: TargetLookup, targets: string[]): { ids: string[]; errors: string[] } {
    const ids: string[] = [];
    const errors: string[] = [];
    const devices = Object.values(state.devices);
    for (const t of targets) {
        const lower = t.toLowerCase();
        const address = isIpv4(t) ? t : (state.known ?? []).find((k) => k.name.toLowerCase() === lower)?.address;
        if (!address) {
            errors.push(`no known controller named '${t}'`);
            continue;
        }
        const dev = devices.find(
            (d) => d.ip.toLowerCase() === address.toLowerCase() || d.hostname?.toLowerCase() === address.toLowerCase(),
        );
        ids.push(dev?.id ?? `${address}|record`);
    }
    return { ids, errors };
}

const ACTION_LABEL: Record<ContentItemAction, string> = {
    uploaded: 'sent',
    skipped: 'current',
    planned: 'to send',
    failed: 'FAILED',
};

function bytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function seconds(fromIso: string, toIso: string): string {
    const ms = Date.parse(toIso) - Date.parse(fromIso);
    return Number.isFinite(ms) ? `${(ms / 1000).toFixed(1)} s` : '';
}

function formatTarget(t: ContentDistTargetReport): string[] {
    const version = [t.platform, t.version].filter(Boolean).join(' ');
    const lines = [`${t.label}${version ? `  ${version}` : ''}`];
    if (!t.supported) lines.push(`  unsupported${t.note ? `: ${t.note}` : ''}`);
    else if (t.note) lines.push(`  ${t.note}`);
    for (const i of t.items) {
        const detail = [i.reason, i.action === 'uploaded' ? `${bytes(i.bytes)}, ${(i.ms / 1000).toFixed(1)} s` : '']
            .filter(Boolean)
            .join('; ');
        lines.push(
            `  ${ACTION_LABEL[i.action].padEnd(8)} ${i.kind.padEnd(9)} ${i.name}${detail ? `  (${detail})` : ''}`,
        );
    }
    return lines;
}

/** The report as text, one block per device. */
export function formatReport(r: ContentDistReport): string {
    const kind = r.checkOnly ? 'Check (nothing sent)' : r.cancelled ? 'Distribution (cancelled)' : 'Distribution';
    const lines = [`${kind} — ${new Date(r.startedAt).toLocaleString()}, ${seconds(r.startedAt, r.finishedAt)}`];
    if (r.note) lines.push(r.note);
    const t = r.totals;
    const counts = [
        r.checkOnly ? `${t.planned} to send` : `${t.uploaded} sent`,
        `${t.skipped} current`,
        t.failed ? `${t.failed} failed` : '',
        t.bytes ? bytes(t.bytes) : '',
    ].filter(Boolean);
    if (t.targets) {
        lines.push(
            `${t.targets} device${t.targets === 1 ? '' : 's'}${t.targetsFailed ? ` (${t.targetsFailed} behind)` : ''}: ${counts.join(', ')}`,
        );
    }
    for (const target of r.targets) {
        lines.push('');
        lines.push(...formatTarget(target));
    }
    return lines.join('\n');
}

export async function run(args: string[]): Promise<number> {
    const parsed = parseArgs(args);
    if ('error' in parsed) {
        console.error(`distribute: ${parsed.error}`);
        return 2;
    }
    const host = resolveHost(parsed.host);

    let before;
    try {
        before = await getOpsState(host);
    } catch (e) {
        console.error(`distribute: ${(e as Error).message}`);
        console.error(unreachableHint(host));
        return 1;
    }
    if (before.contentDist?.run) {
        console.error('distribute: a distribution is already running; wait for it to finish');
        return 1;
    }
    const { ids, errors } = resolveTargetIds(before, parsed.targets);
    if (errors.length) {
        for (const e of errors) console.error(`distribute: ${e}`);
        const names = (before.known ?? []).map((k) => k.name);
        if (names.length) console.error(`known controllers: ${names.join(', ')}`);
        return 1;
    }

    const what = parsed.sequences.length ? `${parsed.sequences.length} sequence(s)` : 'the show';
    const where = ids.length ? `${ids.length} device(s)` : 'every device that holds content';
    process.stderr.write(
        `${parsed.check ? 'Checking' : parsed.force ? 'Sending all of' : 'Distributing'} ${what} to ${where}…\n`,
    );
    try {
        // A transfer runs until it ends: the show's files can be gigabytes.
        await postCommand(
            host,
            {
                cmd: 'distribute',
                ...(ids.length ? { ids } : {}),
                ...(parsed.sequences.length ? { sequences: parsed.sequences } : {}),
                ...(parsed.check ? { checkOnly: true } : {}),
                ...(parsed.force ? { force: true } : {}),
            },
            { timeoutMs: 0 },
        );
    } catch (e) {
        console.error(`distribute: ${(e as Error).message}`);
        return 1;
    }

    let report: ContentDistReport | undefined;
    try {
        const after = await getOpsState(host);
        report = after.contentDist?.lastReport;
        if (report && report.startedAt === before.contentDist?.lastReport?.startedAt) report = undefined;
    } catch (e) {
        console.error(`distribute: the run finished but its report could not be read: ${(e as Error).message}`);
        return 1;
    }
    if (!report) {
        console.error('distribute: the run finished but left no report');
        return 1;
    }
    if (parsed.json) console.log(JSON.stringify(report, null, 2));
    else console.log(formatReport(report));
    return report.targets.some(contentTargetFailed) ? 1 : 0;
}
