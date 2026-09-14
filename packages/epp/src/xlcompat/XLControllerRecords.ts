/**
 * Read-only access to EZPlayer's per-controller records — the JSON files the
 * Controllers screen writes under `<showFolder>/.ezplayer/controllers/` (one
 * per controller, keyed by name). The data plane only needs the frame-rate
 * override from them; everything else stays with the controller-ops module
 * that owns the records.
 */

import * as fsp from 'fs/promises';
import * as path from 'path';

/**
 * Per-controller max-FPS overrides by controller name. A missing directory,
 * unreadable file, or record without `fpsOverride` simply contributes nothing.
 */
export async function readControllerFpsOverrides(showFolder: string): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
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
            const { name, fpsOverride, deleted } = rec as { name?: unknown; fpsOverride?: unknown; deleted?: unknown };
            if (typeof name !== 'string' || !name || deleted === true) continue;
            if (typeof fpsOverride === 'number' && Number.isFinite(fpsOverride) && fpsOverride > 0) {
                out[name] = fpsOverride;
            }
        } catch {
            // malformed record — the Controllers screen reports those
        }
    }
    return out;
}
