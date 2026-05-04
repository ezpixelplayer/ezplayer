import fs from 'fs/promises';
import path from 'path';

/**
 * Filenames that historically lived at the show-folder root. On first run after the
 * `.ezplayer/` subdirectory feature shipped, they're moved into `.ezplayer/`.
 *
 * TODO: Remove this migration after 2026-07-04 (tracked in GitHub issue).
 */
const LEGACY_FILES = [
    'sequences.json',
    'playlists.json',
    'schedule.json',
    'show.json',
    'user.json',
    'playbackSettings.json',
    'cloud-config.json',
] as const;

const SUBDIR_NAME = '.ezplayer';

/**
 * Ensure the show folder has a `.ezplayer/` subdirectory. If it didn't exist before,
 * also move any of our known root-level JSON files into it (one-shot migration).
 * Returns the absolute path to the subdirectory.
 */
export async function ensureEzplayerSubdir(showFolder: string): Promise<string> {
    const subdir = path.join(showFolder, SUBDIR_NAME);
    try {
        const stat = await fs.stat(subdir);
        if (stat.isDirectory()) return subdir;
    } catch (e) {
        const err = e as { code?: string };
        if (err?.code !== 'ENOENT') throw err;
    }

    await fs.mkdir(subdir, { recursive: true });

    for (const filename of LEGACY_FILES) {
        const oldPath = path.join(showFolder, filename);
        const newPath = path.join(subdir, filename);
        try {
            await fs.rename(oldPath, newPath);
            console.log(`[settings-migration] moved ${oldPath} -> ${newPath}`);
        } catch (e) {
            const err = e as { code?: string };
            if (err?.code !== 'ENOENT') {
                console.warn(`[settings-migration] failed to move ${oldPath}:`, err);
            }
        }
    }

    return subdir;
}

/** Path to a settings JSON inside `.ezplayer/`. Run `ensureEzplayerSubdir` first. */
export function settingsPath(showFolder: string, filename: string): string {
    return path.join(showFolder, SUBDIR_NAME, filename);
}
