import { useApiBase } from './ApiBaseProvider';

// Works in Node and compiles for browser bundles
function pathToFileURLCompat(path: string): URL {
    if (typeof process !== 'undefined' && process.versions?.node) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { pathToFileURL } = require('url');
        return pathToFileURL(path);
    }
    // Browser build fallback (won't actually be used at runtime)
    const normalized = path.replace(/\\/g, '/');
    return new URL(`file:///${normalized}`);
}

function toFileUrl(maybePath: string): string {
    if (/^file:\/\//i.test(maybePath)) return maybePath; // already a file URL
    return pathToFileURLCompat(maybePath).toString();
}

function isElectronRenderer(): boolean {
    if (typeof window === 'undefined') return false;
    return Boolean((window as any).electronAPI);
}

/**
 * Resolve the best image URL for display. Pure function so it can run outside
 * React (e.g. inside selectors); React components should prefer `useImageUrl`,
 * which threads `apiBase` from context.
 *
 * - In Electron renderer: prefers `localImagePath` as `file://...`.
 * - In any browser: prefers `remoteImageUrl`; falls back to
 *   `${apiBase}/getimage/${id}` when a local file exists on the player.
 *
 * `apiBase` defaults to `/api` (LAN/Electron same-origin); the cloud SPA
 * passes `/api/enduserspa/proxy/${player_token}` so the same relative path
 * resolves through the cloud-endpoint's HTTP-over-WS proxy.
 */
export function getImageUrl(
    id?: string,
    remoteImageUrl?: string,
    localImagePath?: string,
    apiBase: string = '',
): string | undefined {
    if (isElectronRenderer()) {
        if (localImagePath && !localImagePath.startsWith('http')) {
            return toFileUrl(localImagePath);
        }
        return remoteImageUrl;
    }

    if (remoteImageUrl) return remoteImageUrl;
    if (localImagePath && id) return `${apiBase}/api/getimage/${id}`;
    return undefined;
}

/**
 * Hook variant: same as `getImageUrl` but reads `apiBase` from context so
 * components don't have to thread it. Today this returns a same-origin URL
 * the browser fetches with `<img src=…>`; the hook shape is also the natural
 * escape hatch later for async resolution (blob URLs from WS-only delivery,
 * fingerprint-based CDN lookups, IndexedDB cache) — at which point the
 * return becomes `{ url, loading }` without changing call-site placement.
 */
export function useImageUrl(id?: string, remoteImageUrl?: string, localImagePath?: string): string | undefined {
    const apiBase = useApiBase();
    return getImageUrl(id, remoteImageUrl, localImagePath, apiBase);
}
