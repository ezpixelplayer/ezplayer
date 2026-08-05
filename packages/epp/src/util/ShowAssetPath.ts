import * as path from 'path';

/**
 * Cross-platform absolute-path detection for layout asset references.
 *
 * xLights writes machine-local absolute paths into xlights_rgbeffects.xml
 * (ObjFile, Image, backgroundImage, ...). When a show folder authored on
 * Windows is copied to a Linux player (or vice versa), the reference keeps
 * the foreign platform's shape: `path.isAbsolute` on POSIX does not
 * recognize `C:\...` / `C:/...` / `\\server\share`, so a naive check treats
 * the foreign absolute path as relative and passes it through — the server
 * then rejects it and the asset silently fails to display.
 */
export function isAssetPathAbsolute(p: string): boolean {
    return path.isAbsolute(p) || /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

/**
 * Resolve a layout asset reference to a show-folder-relative path
 * (forward slashes), platform-independently.
 *
 *  - Relative refs pass through with slashes normalized.
 *  - Absolute refs (native OR foreign-platform) inside the show folder are
 *    relativized (case-insensitive prefix match, like xLights on Windows).
 *  - Absolute refs outside the show folder fall back to a basename lookup
 *    in `fileIndex` (lowercase basename → show-folder-relative path).
 *
 * Returns `undefined` when the ref is absolute, outside the show folder,
 * and no same-named file exists in the index.
 *
 * @param resolvedShowFolder Host-native absolute show folder path
 *                           (already through `path.resolve`).
 */
export function resolveShowAssetPath(
    filePath: string,
    resolvedShowFolder: string,
    fileIndex: Map<string, string>,
): string | undefined {
    if (!isAssetPathAbsolute(filePath)) {
        return filePath.replace(/\\/g, '/');
    }

    // Clean '.'/'..' segments textually (posix segment math works for
    // drive-letter paths too) — host path.resolve would mangle a
    // foreign-platform path against the local cwd/drive.
    const norm = path.posix.normalize(filePath.replace(/\\/g, '/'));
    const showNorm = resolvedShowFolder.replace(/\\/g, '/').replace(/\/+$/, '');

    const normLower = norm.toLowerCase();
    const showLower = showNorm.toLowerCase();
    if (normLower === showLower) return '';
    if (normLower.startsWith(showLower + '/')) {
        return norm.slice(showNorm.length + 1);
    }

    // Outside the show folder (or a foreign-platform path): find a same-named
    // file inside the show folder. Split on '/' after normalization so a
    // Windows path gets its real basename even on a POSIX host, where
    // path.basename does not treat '\' as a separator.
    const basename = norm.split('/').pop() ?? '';
    return basename ? fileIndex.get(basename.toLowerCase()) : undefined;
}
