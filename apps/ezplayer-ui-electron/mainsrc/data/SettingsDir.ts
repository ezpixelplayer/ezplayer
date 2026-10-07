import fs from 'fs/promises';
import path from 'path';

export const SUBDIR_NAME = '.ezplayer';

/**
 * Ensure the show folder has a `.ezplayer/` subdirectory.
 * Returns the absolute path to the subdirectory.
 */
export async function ensureEzplayerSubdir(showFolder: string): Promise<string> {
    const subdir = path.join(showFolder, SUBDIR_NAME);
    await fs.mkdir(subdir, { recursive: true });
    return subdir;
}

/** Path to a settings JSON inside `.ezplayer/`. Run `ensureEzplayerSubdir` first. */
export function settingsPath(showFolder: string, filename: string): string {
    return path.join(showFolder, SUBDIR_NAME, filename);
}
