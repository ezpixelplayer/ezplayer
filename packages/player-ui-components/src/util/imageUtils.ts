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
 * Convert a relative path or localhost URL to an absolute URL using the current page origin.
 * This ensures images work when the React app is served from Koa on a different host/port.
 */
function makeAbsoluteUrl(url: string): string {
    if (typeof window === 'undefined') {
        return url;
    }

    // Already an absolute URL with a non-localhost host - use as-is
    if (/^https?:\/\//i.test(url)) {
        try {
            const parsed = new URL(url);
            // If it's localhost, rewrite to current origin
            if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
                return `${window.location.origin}${parsed.pathname}${parsed.search}${parsed.hash}`;
            }
            return url;
        } catch {
            return url;
        }
    }

    // Relative path starting with / - prepend current origin
    if (url.startsWith('/')) {
        return `${window.location.origin}${url}`;
    }

    return url;
}

/**
 * Check if a path looks like a Windows or Unix absolute file path (not a URL)
 */
function looksLikeLocalFilePath(p: string): boolean {
    // Windows path like C:\Users\... or D:/path/...
    if (/^[a-zA-Z]:[\\/]/.test(p)) {
        return true;
    }
    // Unix absolute path that's not a URL path
    // URL paths start with / but don't have backslashes and typically have known prefixes
    if (
        p.startsWith('/') &&
        !p.startsWith('/user-images/') &&
        !p.startsWith('/show-assets/') &&
        !p.startsWith('/api/')
    ) {
        // Could be a Unix file path like /home/user/...
        // But we can't easily distinguish, so we'll treat paths with common URL prefixes as URLs
        return false;
    }
    return false;
}

/**
 * Try to extract a usable web URL from a local file path that contains user_data/images
 */
function inferWebUrlFromLocalPath(localPath: string): string | undefined {
    if (typeof window === 'undefined' || !localPath) {
        return undefined;
    }

    // Normalize path separators
    const normalized = localPath.replace(/\\/g, '/');
    const lower = normalized.toLowerCase();

    // Look for user_data/images pattern
    const markers = ['/user_data/images/', '\\user_data\\images\\'];
    for (const marker of markers) {
        const idx = lower.indexOf(marker.toLowerCase());
        if (idx !== -1) {
            const markerLen = marker.length;
            const relative = normalized.slice(idx + markerLen);
            if (relative) {
                return `${window.location.origin}/user-images/${relative}`;
            }
        }
    }

    return undefined;
}

/**
 * Utility function to get the best image URL for display.
 * - In Electron: converts local paths to file:// URLs
 * - In Web: converts relative paths and localhost URLs to absolute URLs using current origin
 *
 * @param artwork - The artwork URL from work.artwork (may be relative or absolute)
 * @param localImagePath - The local file path or resolved thumb path
 */
export function getImageUrl(artwork?: string, localImagePath?: string): string | undefined {
    // In Electron renderer, prefer local file path
    if (isElectronRenderer()) {
        if (localImagePath && !localImagePath.startsWith('http')) {
            return toFileUrl(localImagePath);
        }
        // Fall back to artwork if it's a valid URL
        if (artwork) {
            if (/^https?:\/\//i.test(artwork) || /^file:\/\//i.test(artwork)) {
                return artwork;
            }
            if (artwork.startsWith('/')) {
                return artwork; // Electron can handle relative paths
            }
        }
        return localImagePath ? toFileUrl(localImagePath) : undefined;
    }

    // In web browser - need to make URLs absolute

    // First, try localImagePath if it looks like a web URL
    if (localImagePath) {
        // If it's already an http(s) URL or starts with /, make it absolute
        if (/^https?:\/\//i.test(localImagePath) || localImagePath.startsWith('/')) {
            return makeAbsoluteUrl(localImagePath);
        }

        // Try to infer a web URL from a local file path
        const inferred = inferWebUrlFromLocalPath(localImagePath);
        if (inferred) {
            return inferred;
        }
    }

    // Try artwork URL
    if (artwork) {
        if (/^https?:\/\//i.test(artwork) || artwork.startsWith('/')) {
            return makeAbsoluteUrl(artwork);
        }

        // Try to infer from artwork if it looks like a local path
        const inferred = inferWebUrlFromLocalPath(artwork);
        if (inferred) {
            return inferred;
        }
    }

    // Last resort - return whatever we have
    if (localImagePath) {
        return makeAbsoluteUrl(localImagePath);
    }
    if (artwork) {
        return makeAbsoluteUrl(artwork);
    }

    return undefined;
}
