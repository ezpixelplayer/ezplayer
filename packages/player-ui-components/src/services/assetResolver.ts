/**
 * Asset URL resolution for the 3D / 2D previewers.
 *
 * The previewer leaves (HouseMesh, ImagePlane, Viewer2D's background) need to turn a layout
 * asset path — `objFile`, `imageFile`, MTL-referenced texture, etc. — into a fetchable URL.
 * Where those bytes live depends on hosting:
 *
 *  - Local Koa (Electron / local browser): bytes come from disk, served via `/api/show-file?path=…`.
 *  - Cloud-hosted EZP / FSEQ-only browser preview: there is no local Koa, so bytes come from
 *    the layout zip the caller has already downloaded and unpacked into blob URLs.
 *
 * `AssetResolver` is the single seam each leaf calls. Callers compose the right resolver(s)
 * for their environment via `combineResolvers` — typically zip-blob first, show-file second,
 * so that any asset present in the zip wins and anything else falls through to disk.
 */

/**
 * Map a layout asset path to a fetchable URL, or `null` when this resolver can't supply it.
 * Returning null lets a chained resolver try next.
 */
export type AssetResolver = (path: string) => string | null;

/**
 * Resolver that builds `frameServerUrl/api/show-file?path=…` URLs. Used in local-Koa hosting
 * (Electron / local browser) where the show folder is served by the host. Returns a no-op
 * resolver when `frameServerUrl` is missing, so callers can pass through their optional
 * frameServerUrl prop without guarding.
 */
export function createShowFileResolver(frameServerUrl: string | undefined): AssetResolver {
    if (!frameServerUrl) return () => null;
    return (path) => {
        if (!path) return null;
        try {
            const url = new URL('/api/show-file', frameServerUrl);
            url.searchParams.set('path', path);
            return url.toString();
        } catch {
            return null;
        }
    };
}

/** Normalize a path the way zip keys are stored: backslashes → slashes, lowercase. */
function normalizeAssetKey(path: string): string {
    return path.replace(/\\/g, '/').toLowerCase();
}

/**
 * Resolver backed by an in-memory map of layout assets — typically the unpacked layzip
 * surfaced by `useBrowserPlayback`. Looks up by the verbatim normalized key first, then by
 * basename so a request for an absolute disk path (`C:/show/houses/foo.png`) still finds
 * `houses/foo.png` packed inside the zip.
 *
 * Basename collisions across different folders resolve to the first one encountered, which is
 * acceptable for xLights layouts where filenames are typically unique within a show folder.
 */
export function createZipAssetResolver(
    assets: Map<string, string> | undefined,
): AssetResolver {
    // Creation log is always-on so a developer can immediately confirm whether the resolver
    // was even constructed and with how many assets — without having to flip any flag.
    if (!assets || assets.size === 0) {
        console.info('[assetResolver] zip resolver created with 0 assets (no-op)');
        return () => null;
    }

    const byBasename = new Map<string, string>();
    for (const [key, value] of assets) {
        const base = key.split('/').pop();
        if (base && !byBasename.has(base)) byBasename.set(base, value);
    }

    console.info(
        `[assetResolver] zip resolver created with ${assets.size} asset(s); ` +
            `${byBasename.size} unique basename(s)`,
    );

    // Lookup tracing: log the first MAX_TRACE calls verbatim, then a single suppression notice
    // and silence. Bounded so a long-running session doesn't spam the console, but unconditional
    // so a developer doesn't need to flip a flag before opening the preview.
    let traceLeft = MAX_LOOKUP_TRACE;

    return (path) => {
        if (!path) return null;
        const norm = normalizeAssetKey(path);
        const direct = assets.get(norm);
        if (direct) {
            traceLookup(`hit direct: ${path} -> ${norm}`, () => traceLeft--, () => traceLeft);
            return direct;
        }
        const base = norm.split('/').pop();
        if (base) {
            const viaBasename = byBasename.get(base);
            if (viaBasename) {
                traceLookup(`hit basename: ${path} -> ${base}`, () => traceLeft--, () => traceLeft);
                return viaBasename;
            }
        }
        // Stack trace on misses identifies the caller (HouseMesh loading manager,
        // ImagePlane, Viewer2D background plane, etc.) so we can tell whether the asking
        // path came from `objFile` / `imageFile` / `layoutSettings.backgroundImage` /
        // an MTL-internal texture reference. Bounded by the same suppression as the lookup log.
        const stillTracing = traceLeft > 0;
        traceLookup(`miss: ${path} (norm=${norm}, base=${base ?? ''})`, () => traceLeft--, () => traceLeft);
        if (stillTracing) console.trace('[assetResolver] miss origin');
        return null;
    };
}

const MAX_LOOKUP_TRACE = 50;
function traceLookup(msg: string, decrement: () => void, peek: () => number): void {
    const remaining = peek();
    if (remaining > 0) {
        console.info(`[assetResolver] ${msg}`);
        decrement();
        if (peek() === 0) {
            console.info(`[assetResolver] (further lookup logs suppressed)`);
        }
    }
}

/**
 * Try each resolver in order; return the first non-null result. Callers typically chain
 * zip-blob → show-file so the in-memory zip wins when both could supply the asset.
 */
export function combineResolvers(
    ...resolvers: Array<AssetResolver | null | undefined>
): AssetResolver {
    return (path) => {
        for (const r of resolvers) {
            if (!r) continue;
            const result = r(path);
            if (result) return result;
        }
        return null;
    };
}
