/**
 * Reconcile known controllers (xLights ∪ our records) against live scan
 * results, joined by address. Pure and dependency-free so it can run
 * client-side and re-derive as devices stream in.
 */

import type {
    KnownController,
    ControllerGridRow,
    DiscoveredController,
    ControllerPortIntent,
    ControllerPort,
    PortReconcile,
    ControllerHealth,
    EzpControllerRecord,
} from '../types/ControllerOps';
import type { ControllerStatus } from '../types/DataTypes';

/**
 * Merge persisted records/overrides onto the xLights-derived known set, by name:
 * a matching record overrides address/active/identity (source → 'both'), a
 * `deleted` record hides the entry, and an unmatched record is added as
 * 'ezp'-sourced.
 */
export function applyOverrides(
    xlights: KnownController[],
    records: EzpControllerRecord[],
): KnownController[] {
    const byName = new Map(records.map((r) => [r.name, r]));
    const seen = new Set<string>();
    const out: KnownController[] = [];

    for (const k of xlights) {
        seen.add(k.name);
        const r = byName.get(k.name);
        if (r?.deleted) continue;
        if (!r) {
            out.push(k);
            continue;
        }
        out.push({
            ...k,
            address: r.address ?? k.address,
            active: r.active ?? k.active,
            // A record's enable/disable override collapses the three-way state.
            enableState: r.active !== undefined ? (r.active ? 'enabled' : 'disabled') : k.enableState,
            vendor: r.vendor ?? k.vendor,
            model: r.model ?? k.model,
            variant: r.variant ?? k.variant,
            source: 'both',
        });
    }

    // Records with no xLights backing (own records / promoted ghosts).
    for (const r of records) {
        if (seen.has(r.name) || r.deleted) continue;
        out.push({
            name: r.name,
            address: r.address,
            active: r.active ?? true,
            enableState: r.active === false ? 'disabled' : 'enabled',
            vendor: r.vendor,
            model: r.model,
            variant: r.variant,
            source: 'ezp',
        });
    }

    return out;
}

/** Stable identity for a scanned device (its shared-state key, else its IP). */
function deviceKey(d: DiscoveredController): string {
    return d.id || d.ip;
}

export function reconcileControllers(
    known: KnownController[],
    devices: DiscoveredController[],
): ControllerGridRow[] {
    // Index by IP and lowercased hostname; first-seen wins so a device reached
    // both directly and via a proxy (two rows, same IP) doesn't double-claim.
    const byIp = new Map<string, DiscoveredController>();
    const byHost = new Map<string, DiscoveredController>();
    for (const d of devices) {
        if (!byIp.has(d.ip)) byIp.set(d.ip, d);
        if (d.hostname) {
            const h = d.hostname.toLowerCase();
            if (!byHost.has(h)) byHost.set(h, d);
        }
    }

    // Claim by IP, not device row, so matching one row absorbs same-IP duplicates.
    const claimedIps = new Set<string>();
    const rows: ControllerGridRow[] = [];

    // Known records → present (address matched a scan) or absent.
    for (const k of known) {
        const addr = k.address?.trim();
        const device = addr ? byIp.get(addr) ?? byHost.get(addr.toLowerCase()) : undefined;
        if (device) claimedIps.add(device.ip);
        rows.push({
            key: k.name,
            state: device ? 'present' : 'absent',
            name: k.name,
            address: k.address,
            device,
            vendor: k.vendor,
            model: k.model,
            active: k.active,
            enableState: k.enableState,
            source: k.source,
            intent: k.ports,
            modelIntents: k.modelIntents,
        });
    }

    // Scanned devices no record claimed → unregistered "ghosts".
    for (const d of devices) {
        if (claimedIps.has(d.ip)) continue;
        rows.push({
            key: `ghost:${deviceKey(d)}`,
            state: 'unregistered',
            device: d,
            vendor: d.vendor,
            model: d.model,
        });
    }

    return rows;
}

/**
 * Reconcile per-port intent against the device's actual config, over the union
 * of both port sets — the non-`ok` rows are the "reconfiguration needed" list.
 * Model names compare as sets (case-insensitive match, case-preserving output)
 * and inform display only; pixel counts decide the drift kind.
 */
/** Canonical form for model-set comparison: multi-string models upload as
 *  "<model>-str-<n>" (xLights naming), so strip that suffix before matching
 *  against the intent's bare model names. */
const modelCompareKey = (name: string): string => name.toLowerCase().replace(/-str-\d+$/, '');

export function reconcilePorts(
    intent: ControllerPortIntent[],
    actual: ControllerPort[],
): PortReconcile[] {
    const byPort = new Map<number, PortReconcile>();

    for (const i of intent) {
        if (!i.models.length && !i.pixels) continue; // nothing intended here
        byPort.set(i.port, {
            port: i.port,
            intendedModels: i.models,
            intendedModelLabels: i.modelLabels,
            intendedPixels: i.pixels,
            drift: 'missing', // no actual seen yet
        });
    }

    for (const a of actual) {
        const active = (a.pixels ?? 0) > 0;
        // Prefer the typed per-model list; fall back to the joined string.
        const actualModels = a.models ?? (a.model ? [a.model] : undefined);
        const actualModel = a.model ?? actualModels?.join(' + ');
        const row = byPort.get(a.port);
        if (row) {
            row.actualModel = actualModel;
            row.actualModels = actualModels;
            if (actualModels) {
                const actualSet = new Set(actualModels.map(modelCompareKey));
                const intendedSet = new Set(row.intendedModels.map(modelCompareKey));
                row.missingModels = row.intendedModels.filter((m) => !actualSet.has(modelCompareKey(m)));
                row.extraModels = actualModels.filter((m) => !intendedSet.has(modelCompareKey(m)));
            }
            row.actualPixels = a.pixels;
            if (!active) row.drift = 'missing';
            else if (row.intendedPixels !== undefined && a.pixels !== undefined && row.intendedPixels !== a.pixels)
                row.drift = 'count';
            else row.drift = 'ok';
        } else if (active) {
            byPort.set(a.port, {
                port: a.port,
                intendedModels: [],
                actualModel,
                actualModels,
                extraModels: actualModels, // nothing intended ⇒ every model is extra
                actualPixels: a.pixels,
                drift: 'unexpected',
            });
        }
    }

    return [...byPort.values()].sort((x, y) => x.port - y.port);
}

/** True when any port is out of sync — the row-level "needs attention" flag. */
export function hasPortDrift(rows: PortReconcile[]): boolean {
    return rows.some((r) => r.drift !== 'ok');
}

/**
 * Overlay live per-controller health onto grid rows, joined by address then
 * name. Pure; rows with no matching status are returned unchanged.
 */
export function overlayHealth(rows: ControllerGridRow[], statuses: ControllerStatus[]): ControllerGridRow[] {
    if (!statuses.length) return rows;
    const byAddr = new Map<string, ControllerStatus>();
    const byName = new Map<string, ControllerStatus>();
    for (const s of statuses) {
        if (s.address) byAddr.set(s.address.toLowerCase(), s);
        if (s.name) byName.set(s.name.toLowerCase(), s);
    }
    return rows.map((r) => {
        const addr = (r.device?.ip ?? r.address)?.toLowerCase();
        const match = (addr ? byAddr.get(addr) : undefined) ?? (r.name ? byName.get(r.name.toLowerCase()) : undefined);
        if (!match) return r;
        // A live "Up" ping proves the device is on-network even if the scan
        // missed it — flip absent → present; ghosts and Down/Pending untouched.
        const state = r.state === 'absent' && match.connectivity === 'Up' ? 'present' : r.state;
        return {
            ...r,
            state,
            health: {
                connectivity: match.connectivity,
                pingSummary: match.pingSummary,
                status: match.status,
                errors: match.errors,
                notices: match.notices,
            },
        };
    });
}

/** True when live health warrants attention — ping Down or a controller error. */
export function healthNeedsAttention(health: ControllerHealth | undefined): boolean {
    if (!health) return false;
    return health.connectivity === 'Down' || health.status === 'error' || !!health.errors?.length;
}
