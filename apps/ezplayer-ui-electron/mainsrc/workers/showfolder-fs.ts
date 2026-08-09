/**
 * File operations for the file manager.
 * 
 * Confined to the show folder.  `resolveInShow` is what stops that path
 * from meaning anything outside the show folder. Two properties matter:
 *
 *  1. Containment is checked AFTER resolving symlinks (`fs.realpath`), not by
 *     string prefix. A prefix test is not enough here: this walks
 *     subdirectories, where a symlink pointing at `C:\` or `/etc` would
 *     otherwise be followed straight out of the show folder.
 *  2. The player's own settings directory (`.ezplayer/`) is refused outright.
 *     It holds the very password records that gate this feature, plus cloud
 *     credentials, so it is not something the file manager may read or write.
 *
 * Paths crossing the wire are always POSIX-style and relative to the show
 * folder root (`""` is the root itself). Callers never see or send absolute
 * host paths.
 */

import fsp from 'fs/promises';
import path from 'path';
import { SUBDIR_NAME } from '../data/SettingsMigration.js';

/** Files xLights owns; losing one breaks the show, so they may never be
 *  renamed, moved or deleted. */
const PROTECTED_ROOT_FILES = new Set(['xlights_rgbeffects.xml', 'xlights_networks.xml']);

/** Windows device names that are illegal as file names; creating one can hang
 *  or misbehave rather than fail cleanly. */
const WINDOWS_RESERVED = new Set([
    'con',
    'prn',
    'aux',
    'nul',
    ...Array.from({ length: 9 }, (_, i) => `com${i + 1}`),
    ...Array.from({ length: 9 }, (_, i) => `lpt${i + 1}`),
]);

export interface FileEntry {
    /** POSIX-style path relative to the show folder root. */
    path: string;
    name: string;
    kind: 'file' | 'directory';
    sizeBytes: number;
    /** Epoch ms. */
    modified: number;
    /** True for entries the UI must not offer to rename, move, or delete. */
    protected: boolean;
}

export class ShowFolderError extends Error {
    constructor(
        message: string,
        readonly code:
            | 'no-show-folder'
            | 'invalid-path'
            | 'forbidden'
            | 'not-found'
            | 'exists'
            | 'not-a-directory'
            | 'too-large'
            | 'io',
    ) {
        super(message);
        this.name = 'ShowFolderError';
    }
}

/**
 * Normalize a wire path to POSIX form.
 */
function normalizeRelative(input: string): string {
    const posix = input.replace(/\\/g, '/');
    if (posix.startsWith('/') || path.win32.isAbsolute(input) || /^[a-zA-Z]:/.test(posix)) {
        throw new ShowFolderError('Absolute paths are not allowed', 'invalid-path');
    }
    return posix.replace(/\/+$/, '');
}

/**
 * Reject a path before it ever touches the filesystem.
 */
function assertSafeRelative(rel: string): void {
    if (rel === '') return; // the root itself
    const segments = rel.split('/');
    for (const seg of segments) {
        if (seg === '' || seg === '.') throw new ShowFolderError('Invalid path', 'invalid-path');
        if (seg === '..') throw new ShowFolderError('Paths may not leave the show folder', 'invalid-path');
        // NUL and, on Windows, the alternate-data-stream separator. `a.txt:b`
        // looks like a plain basename but writes a hidden stream.
        if (seg.includes('\0') || seg.includes(':')) {
            throw new ShowFolderError('Invalid character in path', 'invalid-path');
        }
        const base = seg.split('.')[0].toLowerCase();
        if (WINDOWS_RESERVED.has(base)) {
            throw new ShowFolderError(`"${seg}" is a reserved name`, 'invalid-path');
        }
    }
    if (isPlayerInternal(segments[0])) {
        throw new ShowFolderError(`"${segments[0]}" belongs to EZPlayer and is not accessible`, 'forbidden');
    }
}

/**
 * Root-level names EZPlayer owns: the `.ezplayer/` settings directory (which
 * holds the very password records enabling this feature, plus cloud credentials)
 * and the `.ezplayer-folder.lock*` files the show-folder lock uses. One prefix
 * rule covers both, and covers anything similar we add later.
 */
function isPlayerInternal(rootSegment: string): boolean {
    return rootSegment.toLowerCase().startsWith(SUBDIR_NAME);
}

/** True when `child` is `root` or lives beneath it. Both must already be real
 *  (symlink-free) absolute paths. */
function isContained(root: string, child: string): boolean {
    const rel = path.relative(root, child);
    if (rel === '') return true;
    return !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** Case-insensitive on Windows and macOS, where the filesystem is too. */
function samePath(a: string, b: string): boolean {
    return process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
}

/**
 * Turn a wire-relative path into an absolute host path, proving it stays inside
 * the show folder even after symlinks are resolved.
 *
 * `mustExist: false` is for create/rename targets: the leaf may not exist yet,
 * so we resolve the deepest existing ancestor and check containment there, then
 * re-check the joined result.
 */
export async function resolveInShow(
    showFolder: string | undefined,
    rel: string,
    opts: { mustExist?: boolean } = {},
): Promise<string> {
    if (!showFolder) throw new ShowFolderError('No show folder is open', 'no-show-folder');
    const normalized = normalizeRelative(rel);
    assertSafeRelative(normalized);

    let realRoot: string;
    try {
        realRoot = await fsp.realpath(path.resolve(showFolder));
    } catch {
        throw new ShowFolderError('The show folder is unavailable', 'no-show-folder');
    }

    const candidate = path.resolve(realRoot, normalized);

    // Authoritative check: resolve symlinks on the deepest existing prefix.
    let probe = candidate;
    const missing: string[] = [];
    for (;;) {
        try {
            const real = await fsp.realpath(probe);
            if (!isContained(realRoot, real)) {
                throw new ShowFolderError('Path resolves outside the show folder', 'forbidden');
            }
            // Re-apply the segments that did not exist yet.
            const resolved = missing.length ? path.join(real, ...missing.reverse()) : real;
            if (!isContained(realRoot, resolved)) {
                throw new ShowFolderError('Path resolves outside the show folder', 'forbidden');
            }
            assertNotSettingsDir(realRoot, resolved);
            return resolved;
        } catch (e) {
            if (e instanceof ShowFolderError) throw e;
            const parent = path.dirname(probe);
            if (parent === probe) throw new ShowFolderError('Path could not be resolved', 'invalid-path');
            if (opts.mustExist) throw new ShowFolderError('No such file or folder', 'not-found');
            missing.push(path.basename(probe));
            probe = parent;
        }
    }
}

/** Second line of defence, in case a symlink resolved into player-owned space. */
function assertNotSettingsDir(realRoot: string, resolved: string): void {
    const rel = path.relative(realRoot, resolved);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return;
    if (isPlayerInternal(rel.split(path.sep)[0])) {
        throw new ShowFolderError('That path belongs to EZPlayer and is not accessible', 'forbidden');
    }
}

function toWire(realRoot: string, abs: string): string {
    return path.relative(realRoot, abs).split(path.sep).join('/');
}

function isProtected(wirePath: string): boolean {
    const segments = wirePath.split('/');
    return segments.length === 1 && PROTECTED_ROOT_FILES.has(segments[0].toLowerCase());
}

/** Throw if the target is one of xLights' own files. */
function assertMutable(wirePath: string): void {
    if (isProtected(wirePath)) {
        throw new ShowFolderError(`"${wirePath}" is required by xLights and cannot be changed here`, 'forbidden');
    }
}

/** One directory's contents, sorted directories-first then by name. */
export async function listDirectory(showFolder: string | undefined, rel: string): Promise<FileEntry[]> {
    const abs = await resolveInShow(showFolder, rel, { mustExist: true });
    const realRoot = await fsp.realpath(path.resolve(showFolder!));

    let dirents;
    try {
        dirents = await fsp.readdir(abs, { withFileTypes: true });
    } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'ENOTDIR') throw new ShowFolderError('Not a folder', 'not-a-directory');
        if (code === 'ENOENT') throw new ShowFolderError('No such folder', 'not-found');
        throw new ShowFolderError('Could not read the folder', 'io');
    }

    const entries: FileEntry[] = [];
    for (const dirent of dirents) {
        const childAbs = path.join(abs, dirent.name);
        const wire = toWire(realRoot, childAbs);
        // Never list EZPlayer's own files — they cannot be opened anyway, so
        // showing them would only offer operations that are going to fail.
        if (isPlayerInternal(wire.split('/')[0])) continue;

        let stat;
        try {
            stat = await fsp.stat(childAbs);
        } catch {
            // Broken symlink or a file that vanished mid-listing: skip rather
            // than fail the whole directory.
            continue;
        }
        // A symlink that leaves the show folder is not shown at all — listing
        // it would imply it can be opened, and it cannot.
        try {
            if (!isContained(realRoot, await fsp.realpath(childAbs))) continue;
        } catch {
            continue;
        }

        entries.push({
            path: wire,
            name: dirent.name,
            kind: stat.isDirectory() ? 'directory' : 'file',
            sizeBytes: stat.isDirectory() ? 0 : stat.size,
            modified: stat.mtimeMs,
            protected: isProtected(wire),
        });
    }

    entries.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    return entries;
}

export async function statEntry(showFolder: string | undefined, rel: string): Promise<FileEntry> {
    const abs = await resolveInShow(showFolder, rel, { mustExist: true });
    const realRoot = await fsp.realpath(path.resolve(showFolder!));
    let stat;
    try {
        stat = await fsp.stat(abs);
    } catch {
        throw new ShowFolderError('No such file or folder', 'not-found');
    }
    const wire = toWire(realRoot, abs);
    return {
        path: wire,
        name: path.basename(abs) || '/',
        kind: stat.isDirectory() ? 'directory' : 'file',
        sizeBytes: stat.isDirectory() ? 0 : stat.size,
        modified: stat.mtimeMs,
        protected: isProtected(wire),
    };
}

export async function createDirectory(showFolder: string | undefined, rel: string): Promise<void> {
    const abs = await resolveInShow(showFolder, rel);
    try {
        await fsp.mkdir(abs, { recursive: false });
    } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'EEXIST') throw new ShowFolderError('That name is already taken', 'exists');
        if (code === 'ENOENT') throw new ShowFolderError('The parent folder does not exist', 'not-found');
        throw new ShowFolderError('Could not create the folder', 'io');
    }
}

/** Rename or move — the same operation, distinguished only by whether the
 *  parent directory changes. Both endpoints are validated. */
export async function movePath(showFolder: string | undefined, fromRel: string, toRel: string): Promise<void> {
    const realRoot = await fsp.realpath(path.resolve(showFolder ?? ''));
    const fromAbs = await resolveInShow(showFolder, fromRel, { mustExist: true });
    assertMutable(toWire(realRoot, fromAbs));
    const toAbs = await resolveInShow(showFolder, toRel);
    assertMutable(toWire(realRoot, toAbs));

    if (samePath(fromAbs, toAbs)) return;
    // Moving a directory into itself would detach the subtree.
    if (isContained(fromAbs, toAbs)) {
        throw new ShowFolderError('A folder cannot be moved inside itself', 'invalid-path');
    }
    // Refuse to clobber. The upload path may overwrite deliberately; a
    // rename/move silently destroying a file is never what was meant.
    try {
        await fsp.stat(toAbs);
        throw new ShowFolderError('That name is already taken', 'exists');
    } catch (e) {
        if (e instanceof ShowFolderError) throw e;
        // ENOENT is the good case.
    }

    try {
        await fsp.rename(fromAbs, toAbs);
    } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'ENOENT') throw new ShowFolderError('The destination folder does not exist', 'not-found');
        throw new ShowFolderError('Could not move that item', 'io');
    }
}

export async function deletePath(showFolder: string | undefined, rel: string, opts: { recursive?: boolean } = {}) {
    if (normalizeRelative(rel) === '') {
        throw new ShowFolderError('The show folder itself cannot be deleted', 'forbidden');
    }
    const abs = await resolveInShow(showFolder, rel, { mustExist: true });
    const realRoot = await fsp.realpath(path.resolve(showFolder!));
    assertMutable(toWire(realRoot, abs));

    const stat = await fsp.lstat(abs).catch(() => undefined);
    if (!stat) throw new ShowFolderError('No such file or folder', 'not-found');

    try {
        if (stat.isDirectory()) {
            if (opts.recursive) await fsp.rm(abs, { recursive: true, force: true });
            else await fsp.rmdir(abs);
        } else {
            await fsp.unlink(abs);
        }
    } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'ENOTEMPTY') throw new ShowFolderError('That folder is not empty', 'io');
        throw new ShowFolderError('Could not delete that item', 'io');
    }
}

/** Read a byte range, for streaming a download in chunks. */
export async function readChunk(
    showFolder: string | undefined,
    rel: string,
    offset: number,
    length: number,
): Promise<{ bytes: Buffer; total: number }> {
    const abs = await resolveInShow(showFolder, rel, { mustExist: true });
    const handle = await fsp.open(abs, 'r').catch(() => {
        throw new ShowFolderError('Could not open that file', 'io');
    });
    try {
        const stat = await handle.stat();
        if (stat.isDirectory()) throw new ShowFolderError('That is a folder', 'not-a-directory');
        const start = Math.max(0, Math.floor(offset));
        const size = Math.max(0, Math.min(Math.floor(length), stat.size - start));
        const buf = Buffer.alloc(size);
        if (size > 0) await handle.read(buf, 0, size, start);
        return { bytes: buf, total: stat.size };
    } finally {
        await handle.close().catch(() => undefined);
    }
}

/**
 * Write a chunk at `offset`, creating the file on the first one. Positional
 * writes mean chunks may arrive out of order, which is what lets the cloud
 * path run several in flight.
 */
export async function writeChunk(
    showFolder: string | undefined,
    rel: string,
    offset: number,
    bytes: Buffer,
    opts: { truncate?: boolean } = {},
): Promise<number> {
    const abs = await resolveInShow(showFolder, rel);
    const realRoot = await fsp.realpath(path.resolve(showFolder!));
    assertMutable(toWire(realRoot, abs));

    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const handle = await fsp.open(abs, offset === 0 && opts.truncate !== false ? 'w' : 'r+').catch(async (e) => {
        // 'r+' fails when the file doesn't exist yet (a non-zero first chunk).
        if ((e as { code?: string }).code === 'ENOENT') return fsp.open(abs, 'w');
        throw new ShowFolderError('Could not open that file for writing', 'io');
    });
    try {
        await handle.write(bytes, 0, bytes.length, Math.max(0, Math.floor(offset)));
        const stat = await handle.stat();
        return stat.size;
    } catch {
        throw new ShowFolderError('Could not write that file', 'io');
    } finally {
        await handle.close().catch(() => undefined);
    }
}
