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
 * Utility function to get the best image URL for display.
 * - In Electron: converts local paths to file:// URLs
 * - In Web: converts relative paths and localhost URLs to absolute URLs using current origin
 *
 * @param id - Sequence ID for API-based
 * @param remoteImageUrl - The artwork URL from work.artwork (may be relative or absolute)
 * @param localImagePath - The local file path or resolved thumb path
 */
export function getImageUrl(id?: string, remoteImageUrl?: string, localImagePath?: string): string | undefined {
    // In Electron renderer, prefer local file path
    if (isElectronRenderer()) {
        if (localImagePath && !localImagePath.startsWith('http')) {
            return toFileUrl(localImagePath);
        }
        return remoteImageUrl;
    }

    // In web browser, could be artwork URL, or could ask our server to get it if a local file exists
    if (remoteImageUrl) return remoteImageUrl;

    // There IS a local path ... but we should ask the server to handle it by ID.
    if (localImagePath) {
        return `/api/getimage/${id}`;
    }

    return undefined;
}
