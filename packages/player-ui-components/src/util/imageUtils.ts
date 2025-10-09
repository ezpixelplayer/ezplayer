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

/**
 * Utility function to convert local file path to file:// URL for Electron
 * Prioritizes local images over web URLs and adds cache-busting
 */
export function getImageUrl(imageUrl?: string, localImagePath?: string): string | undefined {
    if (localImagePath) return toFileUrl(localImagePath);
    return imageUrl; // http(s), data:, etc. already fine
}
