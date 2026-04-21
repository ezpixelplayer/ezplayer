import { dialog } from 'electron';
import Store from 'electron-store';
import lockfile from 'proper-lockfile';
import * as fsp from 'fs/promises';
import * as path from 'path';
import { getMainWindow } from './main';

const store = new Store<{ showFolder?: string }>();
let releaseLock: null | (() => Promise<void>) = null;
let currentShowFolder: string | null = null;
const REQUIRED_SHOW_FILES = ['xlights_rgbeffects.xml', 'xlights_networks.xml'] as const;

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

export async function isValidShowDirectory(showFolder?: string | null): Promise<ShowDirectoryValidationResult> {
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
            // Startup now uses a dedicated welcome flow for first-time users.
            // If a persisted/CLI folder is invalid, immediately reprompt for another
            // folder instead of showing a separate warning/quit dialog.
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

export async function pickAnotherShowFolder(): Promise<string | null> {
    while (true) {
        const chosen = await promptForFolder();
        if (!chosen) return currentShowFolder; // Gave up
        if (chosen && (await dirExists(chosen))) {
            store.set('showFolder', chosen!);
        }

        if (chosen === currentShowFolder) {
            return currentShowFolder; // Already using this folder
        }

        try {
            const newReleaseLock = await tryLockShowFolder(chosen);
            await closeShowFolder();
            setNewShowFolder(newReleaseLock, chosen);
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
