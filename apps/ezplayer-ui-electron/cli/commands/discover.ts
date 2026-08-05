/**
 * `discover` — network controller discovery, headless. Thin adapter over the
 * epp-controllers discovery engine — no electron.
 *
 * Output adapts to the stream: an interactive terminal gets a live in-place
 * table; a pipe/redirect prints the final table once (progress to stderr).
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    discover,
    DiscoveryDepth,
    DiscoveryDevice,
    DiscoveryNode,
    DiscoveryProgress,
} from '@ezplayer/epp-controllers';
import { hostNetworks } from '../net.js';

const DEPTHS: readonly DiscoveryDepth[] = ['sweep', 'identify', 'full'];

interface ParsedArgs {
    networks: string[];
    depth: DiscoveryDepth;
    fppProxy: boolean;
    ezpProxy: boolean;
    json: boolean;
    stream: boolean;
    error?: string;
}

function parseArgs(args: string[]): ParsedArgs {
    let networks: string[] = [];
    let depth: DiscoveryDepth = 'identify';
    let fppProxy = false;
    let ezpProxy = false;
    let json = false;
    let stream = false;
    const err = (error: string): ParsedArgs => ({ networks, depth, fppProxy, ezpProxy, json, stream, error });
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--networks' || a === '-n') {
            networks = (args[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        } else if (a === '--depth' || a === '-d') {
            const v = args[++i];
            if (!v || !DEPTHS.includes(v as DiscoveryDepth)) {
                return err(`invalid --depth '${v ?? ''}' (expected ${DEPTHS.join(' | ')})`);
            }
            depth = v as DiscoveryDepth;
        } else if (a === '--fpp-proxy') {
            fppProxy = true;
        } else if (a === '--ezp-proxy') {
            ezpProxy = true;
        } else if (a === '--json') {
            json = true;
        } else if (a === '--stream') {
            stream = true;
        } else {
            return err(`unrecognized argument '${a}'`);
        }
    }
    return { networks, depth, fppProxy, ezpProxy, json, stream };
}

/** The build bundles the lib's scanner worker as dist/workers/scanner-worker.js,
 *  alongside dist/cli.js / dist/main.js — no node_modules lookup at runtime. */
function resolveScannerWorker(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), 'workers', 'scanner-worker.js');
}

/** Render a DiscoveryNode tree as an indented outline (also used by `status`). */
export function renderTree(nodes: DiscoveryNode[], indent: string): void {
    for (const n of nodes) {
        const val = n.value !== undefined && n.value !== '' ? `: ${n.value}` : '';
        process.stdout.write(`${indent}${n.label}${val}\n`);
        if (n.children?.length) renderTree(n.children, indent + '  ');
    }
}

const ipKey = (ip: string) => ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);

/** Per-device key matching the engine's dedup: a host seen both directly and
 * via a proxy is two distinct rows. */
const deviceKey = (d: DiscoveryDevice) => {
    if (d.source.via === 'fpp-proxy') return `${d.ip}|via:${d.source.proxy}`;
    if (d.source.via === 'ezp') return `${d.ip}|ezp:${d.source.host}`;
    return `${d.ip}|${d.source.via}`;
};

/** Sort by IP, then direct entries before their proxied/federated counterparts. */
const byIpThenSource = (a: DiscoveryDevice, b: DiscoveryDevice) =>
    ipKey(a.ip) - ipKey(b.ip) || (a.source.via === 'direct' ? 0 : 1) - (b.source.via === 'direct' ? 0 : 1);

/** "  ← via 192.168.1.5" when a device was reached through a proxy/EZPlayer, else "". */
function provenance(d: DiscoveryDevice): string {
    if (d.source.via === 'fpp-proxy') return `  ← via ${d.source.proxy}`;
    if (d.source.via === 'ezp') return `  ← via ezp ${d.source.host}`;
    return '';
}

function formatRow(d: DiscoveryDevice): string {
    if (d.driverType) {
        const id = `${d.driverType.padEnd(11)} ${[d.vendor, d.model, d.firmwareVersion].filter(Boolean).join(' ')}`;
        return `  ${d.ip.padEnd(15)}  ${id}${provenance(d)}`;
    }
    // sweep / unidentified: show the passive signal (ARP MAC/OUI, mDNS host, protocols)
    const bits = [
        d.mac,
        d.oui ? `(${d.oui})` : undefined,
        d.hostname,
        d.protocols?.length ? `[${d.protocols.join(',')}]` : undefined,
    ].filter(Boolean);
    return `  ${d.ip.padEnd(15)}  ${'—'.padEnd(11)} ${bits.join('  ') || 'alive'}${provenance(d)}`;
}

export async function run(args: string[]): Promise<number> {
    const parsed = parseArgs(args);
    if (parsed.error) {
        console.error(`discover: ${parsed.error}`);
        return 2;
    }
    const depth = parsed.depth;
    let networks = parsed.networks;
    // No --networks → scan every external host network (link-local excluded).
    if (networks.length === 0) {
        networks = hostNetworks().map((n) => n.network);
        if (networks.length === 0) {
            console.error('discover: no host networks found; pass --networks <cidr[,…]>');
            return 2;
        }
        process.stderr.write(`No --networks given; scanning host networks: ${networks.join(', ')}\n`);
    }

    const isTTY = !!process.stdout.isTTY;
    // Machine modes (no table): --json emits the raw DiscoveryResult; --stream
    // emits NDJSON events so a parent process can forward live progress.
    const json = parsed.json;
    const stream = parsed.stream;
    const machine = json || stream;
    // `full` emits a detail tree per device at the end, so no live table.
    const live = isTTY && depth !== 'full' && !machine;
    const devices = new Map<string, DiscoveryDevice>();
    let progress: DiscoveryProgress | undefined;
    let printedLines = 0;

    const tableText = (): string => {
        const rows = [...devices.values()].sort(byIpThenSource).map(formatRow);
        const header = progress
            ? `[${progress.phase}] ${progress.scanned}/${progress.total} scanned · ${progress.alive} alive · ${progress.identified} identified`
            : 'scanning…';
        return [header, ...rows].join('\n') + '\n';
    };

    const redraw = (): void => {
        const text = tableText();
        if (printedLines) process.stdout.write(`\x1b[${printedLines}A\x1b[0J`); // up N lines, clear down
        process.stdout.write(text);
        printedLines = text.split('\n').length - 1;
    };

    if (parsed.fppProxy && depth === 'sweep') {
        process.stderr.write('discover: --fpp-proxy needs --depth identify or full (no FPP is identified in a sweep); ignoring\n');
    }
    if (parsed.ezpProxy && depth === 'sweep') {
        process.stderr.write('discover: --ezp-proxy needs --depth identify or full (no EZPlayer is identified in a sweep); ignoring\n');
    }

    const job = discover(
        {
            networks: networks.map((cidr) => ({ cidr })),
            depth,
            recurseFppProxies: parsed.fppProxy,
            recurseEzpProxies: parsed.ezpProxy,
        },
        { workerPath: resolveScannerWorker() },
    );

    job.onProgress((p) => {
        progress = p;
        if (stream) { process.stdout.write(JSON.stringify({ ev: 'progress', progress: p }) + '\n'); return; }
        if (live) redraw();
        else if (!json) process.stderr.write(`\r[${p.phase}] ${p.scanned}/${p.total} · ${p.alive} alive · ${p.identified} id   `);
    });
    job.onDevice((d) => {
        devices.set(deviceKey(d), d);
        if (stream) { process.stdout.write(JSON.stringify({ ev: 'device', device: d }) + '\n'); return; }
        if (live) redraw();
    });

    const result = await job.result();

    if (stream) {
        // NDJSON: final line is the full result.
        process.stdout.write(JSON.stringify({ ev: 'result', result }) + '\n');
        return 0;
    }
    if (json) {
        // Pure JSON on stdout — the ONLY thing written there in this mode.
        process.stdout.write(JSON.stringify(result));
        return 0;
    }

    const sorted = [...devices.values()].sort(byIpThenSource);

    if (depth === 'full') {
        process.stderr.write('\n');
        for (const d of sorted) {
            const head = d.driverType
                ? `${d.driverType} ${[d.vendor, d.model, d.firmwareVersion].filter(Boolean).join(' ')}`.trimEnd()
                : `(unidentified)${d.oui ? ` — ${d.oui}` : ''}`;
            process.stdout.write(`\n${d.ip}  ${head}${provenance(d)}\n`);
            if (d.detail?.length) {
                renderTree(d.detail, '    ');
            } else {
                // Unidentified host (or driver with no detail) — show the passive signal.
                const bits = [
                    d.mac && `MAC: ${d.mac}`,
                    d.hostname && `Host: ${d.hostname}`,
                    d.protocols?.length && `Protocols: ${d.protocols.join(', ')}`,
                ].filter(Boolean) as string[];
                for (const b of bits) process.stdout.write(`    ${b}\n`);
            }
        }
    } else if (!live) {
        process.stderr.write('\n');
        const rows = sorted.map(formatRow);
        if (rows.length) process.stdout.write(rows.join('\n') + '\n');
    }
    console.log(`\n${result.devices.length} device(s), ${result.devices.filter((d) => d.driverType).length} identified.`);
    if (result.errors?.length) console.error(`errors: ${result.errors.join('; ')}`);
    return 0;
}
