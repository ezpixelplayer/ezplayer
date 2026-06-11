import { dialog } from 'electron';
import Store from 'electron-store';
import lockfile from 'proper-lockfile';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { getMainWindow } from './main';

const store = new Store<{
    showFolder?: string;
    /** Welcome-screen flag: when true, the cloud-CTA card appears alongside the
     *  xLights folder picker. Defaults on (unset → cloud shown); `--reset-nocloud`
     *  pins it off for local-only first run. Toggled by the `--reset*` CLI flags. */
    welcomeShowCloud?: boolean;
}>();
let releaseLock: null | (() => Promise<void>) = null;
let currentShowFolder: string | null = null;
const REQUIRED_SHOW_FILES = ['xlights_rgbeffects.xml', 'xlights_networks.xml'] as const;

/**
 * Peek at `<folder>/.ezplayer/cloud-config.json` to figure out whether the folder is
 * cloud-managed without going through the full CloudConfigStorage module. Returns
 * `'cloud'` only when the file exists and explicitly says so; everything else
 * (missing file, absent field, parse failure) is treated as xLights-managed.
 */
async function peekLayoutSource(folder: string): Promise<'xlights' | 'cloud'> {
    try {
        const raw = await fsp.readFile(path.join(folder, '.ezplayer', 'cloud-config.json'), 'utf8');
        const parsed = JSON.parse(raw) as { layoutSource?: string };
        return parsed.layoutSource === 'cloud' ? 'cloud' : 'xlights';
    } catch {
        return 'xlights';
    }
}

async function dirExists(p?: string | null) {
    if (!p) return false;
    try {
        return (await fsp.stat(p)).isDirectory();
    } catch {
        return false;
    }
}

export interface ShowDirectoryValidationResult {
    valid: boolean;
    missingFiles: string[];
    inaccessibleFiles: string[];
    error?: string;
}

/** xLights-managed folder validation: requires both xlights_rgbeffects.xml and
 *  xlights_networks.xml to exist and be readable. */
export async function isValidXLightsShowDirectory(showFolder?: string | null): Promise<ShowDirectoryValidationResult> {
    if (!showFolder) {
        return {
            valid: false,
            missingFiles: [...REQUIRED_SHOW_FILES],
            inaccessibleFiles: [],
            error: 'No show folder selected.',
        };
    }

    if (!(await dirExists(showFolder))) {
        return {
            valid: false,
            missingFiles: [...REQUIRED_SHOW_FILES],
            inaccessibleFiles: [],
            error: 'Show folder does not exist or is not accessible.',
        };
    }

    const missingFiles: string[] = [];
    const inaccessibleFiles: string[] = [];

    for (const fileName of REQUIRED_SHOW_FILES) {
        const filePath = path.join(showFolder, fileName);
        try {
            // fs.access covers both existence and readability.
            await fsp.access(filePath, fsp.constants.R_OK);
        } catch {
            try {
                await fsp.stat(filePath);
                inaccessibleFiles.push(fileName);
            } catch {
                missingFiles.push(fileName);
            }
        }
    }

    return {
        valid: missingFiles.length === 0 && inaccessibleFiles.length === 0,
        missingFiles,
        inaccessibleFiles,
        error:
            missingFiles.length || inaccessibleFiles.length
                ? 'Show folder is missing required xLights configuration files.'
                : undefined,
    };
}

/** Cloud-managed folder validation: the folder must exist and be writable. The
 *  layout files may not have arrived yet (mid-bootstrap), so we don't require them. */
export async function isValidCloudShowDirectory(showFolder?: string | null): Promise<ShowDirectoryValidationResult> {
    if (!showFolder) {
        return {
            valid: false,
            missingFiles: [],
            inaccessibleFiles: [],
            error: 'No show folder selected.',
        };
    }
    if (!(await dirExists(showFolder))) {
        return {
            valid: false,
            missingFiles: [],
            inaccessibleFiles: [],
            error: 'Show folder does not exist or is not accessible.',
        };
    }
    try {
        await fsp.access(showFolder, fsp.constants.W_OK);
    } catch {
        return {
            valid: false,
            missingFiles: [],
            inaccessibleFiles: [],
            error: 'Show folder is not writable.',
        };
    }
    return { valid: true, missingFiles: [], inaccessibleFiles: [] };
}

/** Mode-aware validation: peeks `.ezplayer/cloud-config.json` for `layoutSource`,
 *  then dispatches to the correct check. xLights is the default for any folder
 *  that doesn't say otherwise. */
export async function isValidShowDirectory(showFolder?: string | null): Promise<ShowDirectoryValidationResult> {
    if (!showFolder) return isValidXLightsShowDirectory(showFolder);
    const mode = await peekLayoutSource(showFolder);
    return mode === 'cloud' ? isValidCloudShowDirectory(showFolder) : isValidXLightsShowDirectory(showFolder);
}

async function promptForFolder(): Promise<string | null> {
    const w = getMainWindow();
    if (w) {
        const res = await dialog.showOpenDialog(w, {
            title: 'Select your show folder',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (res.canceled || res.filePaths.length === 0) return null;
        return res.filePaths[0];
    } else {
        const res = await dialog.showOpenDialog({
            title: 'Select your show folder',
            properties: ['openDirectory', 'createDirectory'],
        });
        if (res.canceled || res.filePaths.length === 0) return null;
        return res.filePaths[0];
    }
}

// Get the show folder from the CLI
function parseCliForShowFolder(argv: string[]): string | undefined {
    const eq = argv.find((a) => a.startsWith('--show-folder=') || a.startsWith('--showFolder='));
    if (eq) return eq.split('=')[1];
    const i = argv.findIndex((a) => a === '--show-folder' || a === '--showFolder');
    if (i >= 0 && argv[i + 1]) return argv[i + 1];
    return undefined;
}

// Choose the show folder, suitable for initial run, does not lock
async function getOrPickShowFolder(forcepick: boolean): Promise<string | null> {
    if (!forcepick) {
        const cli = parseCliForShowFolder(process.argv);
        if (await dirExists(cli)) {
            store.set('showFolder', cli!);
            return cli!;
        }
        const persisted = store.get('showFolder');
        if (await dirExists(persisted)) return persisted!;
    }
    const chosen = await promptForFolder();
    if (chosen && (await dirExists(chosen))) {
        store.set('showFolder', chosen!);
        return chosen;
    }
    return null;
}

// Try to lock the folder itself; we lock a well-known file inside it.
async function tryLockShowFolder(showFolder: string) {
    const lockTarget = path.join(showFolder, '.ezplayer-folder.lock');
    // Ensure the target exists (proper-lockfile locks an existing path)
    await fsp.writeFile(lockTarget, 'ezplayer-folder-lock\n', { flag: 'a' });
    // Acquire lock; stale lock will auto-break after 30s unless renewed
    const release = await lockfile.lock(lockTarget, {
        realpath: false,
        retries: { retries: 4, factor: 2, minTimeout: 500, maxTimeout: 4_000 },
        update: 2_000,
        stale: 5_000, // consider lock stale if owner vanished for 5s
        onCompromised: (err: Error) => {
            // handle sudden process death of lock owner
            console.error('Lock compromised:', err);
        },
    });
    return release; // call to release on exit
}

export function getCurrentShowFolder() {
    return currentShowFolder;
}

export async function hasConfiguredShowFolder(): Promise<boolean> {
    const persisted = store.get('showFolder');
    return await dirExists(persisted);
}

export async function hasValidConfiguredShowFolder(): Promise<boolean> {
    const persisted = store.get('showFolder');
    if (!(await dirExists(persisted))) return false;
    const validation = await isValidShowDirectory(persisted);
    return validation.valid;
}

export async function ensureExclusiveFolder(): Promise<string | null> {
    if (currentShowFolder) return currentShowFolder;
    let forcepick = false;
    while (true) {
        const showFolder = await getOrPickShowFolder(forcepick);
        if (!showFolder) return null;

        const validation = await isValidShowDirectory(showFolder);
        if (!validation.valid) {
            // The persisted/CLI folder isn't a valid xLights show folder. Tell the
            // user why and let them pick again (or quit).
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                message: 'This folder is not a valid show folder.',
                detail:
                    (validation.error ?? 'Missing required xLights configuration files.') +
                    (validation.missingFiles.length > 0 ? `\n\nMissing: ${validation.missingFiles.join(', ')}` : ''),
                buttons: ['Pick another folder', 'Quit'],
                cancelId: 1,
                defaultId: 0,
            });
            if (response !== 0) return null;
            forcepick = true;
            continue;
        }

        try {
            const newReleaseLock = await tryLockShowFolder(showFolder);
            setNewShowFolder(newReleaseLock, showFolder);
            return currentShowFolder; // success
        } catch {
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                message: 'This show folder is already in use by another instance.',
                detail: 'Choose “Pick another folder” to select a different show folder.',
                buttons: ['Pick another folder', 'Quit'],
                cancelId: 1,
                defaultId: 0,
            });
            if (response === 0) {
                // loop to pick again
                forcepick = true;
                continue;
            } else {
                return null;
            }
        }
    }
}

export interface PickCloudShowFolderResult {
    /** Absolute path of the chosen folder, or null if user cancelled. */
    folder: string | null;
    /** True when the folder already had a `.ezplayer/cloud-config.json` — caller
     *  should treat this as opening an existing install and NOT reseed the
     *  layoutSource (or kick a fresh layout fetch). False for an empty/new
     *  folder that the user explicitly accepted as a cloud-managed seed. */
    existingInstall: boolean;
}

/** Picker for the cloud-managed bootstrap path. Prompts for any folder (does NOT
 *  require the xLights files), validates it as a cloud-eligible directory
 *  (writable), inspects existing content to decide between fresh seed vs. open-
 *  as-existing, locks it, and sets it as the active folder. Caller seeds
 *  `cloud-config.json` only when `existingInstall` is false. */
export async function pickCloudShowFolder(): Promise<PickCloudShowFolderResult> {
    while (true) {
        const chosen = await promptForFolder();
        if (!chosen) return { folder: null, existingInstall: false };
        if (!(await dirExists(chosen))) continue;

        const validation = await isValidCloudShowDirectory(chosen);
        if (!validation.valid) {
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                message: 'This folder cannot be used as a cloud show folder.',
                detail: validation.error ?? 'Folder is not writable.',
                buttons: ['Pick another folder', 'Cancel'],
                cancelId: 1,
                defaultId: 0,
            });
            if (response !== 0) return { folder: null, existingInstall: false };
            continue;
        }

        // Decide: fresh seed vs. existing install vs. non-cloud non-empty (warn).
        const cloudConfigPath = path.join(chosen, '.ezplayer', 'cloud-config.json');
        let existingInstall = false;
        try {
            await fsp.access(cloudConfigPath);
            existingInstall = true;
        } catch {
            /* no existing cloud-config */
        }

        if (!existingInstall) {
            // No prior cloud install on this folder. If there's any user-visible
            // content, warn — we'd be about to overlay cloud-managed mode and a
            // future layout fetch could overwrite their files.
            let entries: string[] = [];
            try {
                entries = await fsp.readdir(chosen);
            } catch {
                /* fall through with empty list */
            }
            const visible = entries.filter((e) => !e.startsWith('.'));
            if (visible.length > 0) {
                const { response } = await dialog.showMessageBox({
                    type: 'warning',
                    message: 'This folder is not empty.',
                    detail:
                        `"${path.basename(chosen)}" already contains files. ` +
                        'Connecting it as cloud-managed will fetch the layout from the cloud, ' +
                        'which may overwrite existing files. Continue?',
                    buttons: ['Connect Anyway', 'Pick Another Folder', 'Cancel'],
                    cancelId: 2,
                    defaultId: 1,
                });
                if (response === 2) return { folder: null, existingInstall: false };
                if (response === 1) continue;
                // response === 0: proceed
            }
        }

        try {
            const newReleaseLock = await tryLockShowFolder(chosen);
            store.set('showFolder', chosen);
            if (currentShowFolder && currentShowFolder !== chosen) {
                await closeShowFolder();
            }
            setNewShowFolder(newReleaseLock, chosen);
            return { folder: currentShowFolder, existingInstall };
        } catch {
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                message: 'This show folder is already in use by another instance.',
                detail: 'Choose “Pick another folder” to select a different show folder.',
                buttons: ['Pick another folder', 'Cancel'],
                cancelId: 1,
                defaultId: 0,
            });
            if (response !== 0) return { folder: null, existingInstall: false };
        }
    }
}

export async function pickAnotherShowFolder(): Promise<string | null> {
    while (true) {
        const chosen = await promptForFolder();
        if (!chosen) return currentShowFolder; // Gave up
        if (!(await dirExists(chosen))) continue;

        // Validate before persisting / locking. Without this, a junk pick from
        // settings would silently replace the active folder and leave the app in
        // a broken state.
        const validation = await isValidShowDirectory(chosen);
        if (!validation.valid) {
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                message: 'This folder is not a valid show folder.',
                detail:
                    (validation.error ?? 'Missing required xLights configuration files.') +
                    (validation.missingFiles.length > 0 ? `\n\nMissing: ${validation.missingFiles.join(', ')}` : ''),
                buttons: ['Pick another folder', 'Cancel'],
                cancelId: 1,
                defaultId: 0,
            });
            if (response !== 0) return currentShowFolder;
            continue;
        }

        if (chosen === currentShowFolder) {
            return currentShowFolder; // Already using this folder
        }

        try {
            const newReleaseLock = await tryLockShowFolder(chosen);
            await closeShowFolder();
            setNewShowFolder(newReleaseLock, chosen);
            // Only persist after a successful lock — a folder we couldn't lock
            // shouldn't be remembered as the active show folder.
            store.set('showFolder', chosen);
            return currentShowFolder;
        } catch {
            const { response } = await dialog.showMessageBox({
                type: 'warning',
                message: 'This show folder is already in use by another instance.',
                detail: 'Choose “Pick another folder” to select a different show folder.',
                buttons: ['Pick another folder', 'Keep Current'],
                cancelId: 1,
                defaultId: 0,
            });
            if (response !== 0) {
                return currentShowFolder;
            }
        }
    }
}

function setNewShowFolder(rLock: (() => Promise<void>) | null, sf: string | null) {
    releaseLock = rLock;
    currentShowFolder = sf;
}

export async function closeShowFolder() {
    try {
        if (releaseLock) await releaseLock();
    } catch {}
    currentShowFolder = null;
}

/** Wipe the persisted show-folder pointer (electron-store). Used by the `--reset*`
 *  CLI flags to land the user back on the Welcome screen. */
export function clearPersistedShowFolder() {
    store.delete('showFolder');
}

export function getWelcomeShowCloud(): boolean {
    // Unset (true first run, never reset) defaults to showing the cloud choice.
    return store.get('welcomeShowCloud') ?? true;
}

export function setWelcomeShowCloud(v: boolean) {
    store.set('welcomeShowCloud', v);
}
