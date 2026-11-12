/**
 * Read-only access to EZPlayer's per-controller records — the JSON files the
 * Controllers screen writes under `<showFolder>/.ezplayer/controllers/` (one
 * per controller, keyed by name). The data plane needs three things from them:
 * the frame-rate override, the address to send from, and the part a record
 * gives a controller, which the layout cannot say. Everything else stays with
 * the controller-ops module that owns the records.
 */

import * as fsp from 'fs/promises';
import * as path from 'path';

/** The part a record gives a controller; mirrors ControllerActiveState in @ezplayer/ezplayer-core. */
export type ControllerRecordRole = 'enabled' | 'disabled' | 'player' | 'remote';

export interface ControllerRecordOverrides {
    /** Per-controller max-FPS overrides by name. */
    fpsOverrides: Record<string, number>;
    /** The part each record asks of its controller, by name, where it says one. */
    roles: Record<string, ControllerRecordRole>;
    /** This computer's address to send from, by name, where a record names one. */
    forceLocalIPs: Record<string, string>;
}

/** A record's `active` the way the Controllers screen writes it: a role, or a plain on/off. */
function roleOf(value: unknown): ControllerRecordRole | undefined {
    if (value === false) return 'disabled';
    return value === 'enabled' || value === 'disabled' || value === 'player' || value === 'remote' ? value : undefined;
}

/**
 * What the records add to the layout. A missing directory, an unreadable
 * file, or a record that says nothing simply contributes nothing.
 */
export async function readControllerRecordOverrides(showFolder: string): Promise<ControllerRecordOverrides> {
    const out: ControllerRecordOverrides = { fpsOverrides: {}, roles: {}, forceLocalIPs: {} };
    const dir = path.join(showFolder, '.ezplayer', 'controllers');
    let files: string[];
    try {
        files = await fsp.readdir(dir);
    } catch {
        return out;
    }
    for (const f of files) {
        if (!f.endsWith('.json')) continue;
        try {
            const rec: unknown = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf-8'));
            if (!rec || typeof rec !== 'object') continue;
            const { name, fpsOverride, forceLocalIP, active, deleted } = rec as {
                name?: unknown;
                fpsOverride?: unknown;
                forceLocalIP?: unknown;
                active?: unknown;
                deleted?: unknown;
            };
            if (typeof name !== 'string' || !name || deleted === true) continue;
            if (typeof fpsOverride === 'number' && Number.isFinite(fpsOverride) && fpsOverride > 0) {
                out.fpsOverrides[name] = fpsOverride;
            }
            if (typeof forceLocalIP === 'string' && forceLocalIP.trim()) out.forceLocalIPs[name] = forceLocalIP.trim();
            const role = roleOf(active);
            if (role) out.roles[name] = role;
        } catch {
            // malformed record — the Controllers screen reports those
        }
    }
    return out;
}
