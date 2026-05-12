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

/** Resolve the best image URL for display. React components should prefer
 *  `useImageUrl` (threads `apiBase` from context). */
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
    // Id in query, not path: DBOS Cloud's edge rejects `%7C` in URL paths.
    if (localImagePath && id) return `${apiBase}/api/getimage?id=${encodeURIComponent(id)}`;
    return undefined;
}

/** Hook variant of `getImageUrl` that reads `apiBase` from context. */
export function useImageUrl(id?: string, remoteImageUrl?: string, localImagePath?: string): string | undefined {
    const apiBase = useApiBase();
    return getImageUrl(id, remoteImageUrl, localImagePath, apiBase);
}
