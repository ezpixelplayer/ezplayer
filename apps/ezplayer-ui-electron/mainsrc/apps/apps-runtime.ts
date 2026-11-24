import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { AppManifest } from '@ezplayer/ezplayer-core';

export interface ResolvedRuntime {
    /** Executable to spawn. */
    command: string;
    /** Arguments before the manifest's own. */
    argsPrefix: string[];
    env: Record<string, string>;
    /** For the startup report. */
    label: string;
    version?: string;
}

/** Electron's own binary runs plain node scripts when told to. */
function nodeRuntime(): ResolvedRuntime {
    return {
        command: process.execPath,
        argsPrefix: [],
        env: { ELECTRON_RUN_AS_NODE: '1' },
        label: "the player's own Node",
        version: `node ${process.versions.node}`,
    };
}

/** The Microsoft Store alias answers `python` with a dialog, never a Python. */
function isStoreAlias(p: string): boolean {
    return /\\WindowsApps\\/i.test(p);
}

function tryVersion(exe: string): string | undefined {
    try {
        const r = spawnSync(exe, ['--version'], { timeout: 5_000, windowsHide: true, encoding: 'utf8' });
        if (r.status !== 0) return undefined;
        const v = `${r.stdout}${r.stderr}`.trim();
        return /^Python 3\./.test(v) ? v : undefined;
    } catch {
        return undefined;
    }
}

function pathCandidates(names: string[]): string[] {
    const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
    const exts = process.platform === 'win32' ? ['.exe', ''] : [''];
    const out: string[] = [];
    for (const d of dirs) for (const n of names) for (const x of exts) out.push(path.join(d, n + x));
    return out;
}

let pythonCache: { key: string; result: ResolvedRuntime | undefined } | undefined;

/** Find a Python 3: the owner's setting first, then PATH, skipping the Store alias. */
export function findPython(configured: string | undefined): ResolvedRuntime | undefined {
    const key = configured ?? '';
    if (pythonCache?.key === key) return pythonCache.result;
    const candidates = configured ? [configured] : pathCandidates(['python3', 'python']);
    let result: ResolvedRuntime | undefined;
    for (const c of candidates) {
        if (isStoreAlias(c) || !fs.existsSync(c)) continue;
        const version = tryVersion(c);
        if (!version) continue;
        result = {
            command: c,
            argsPrefix: [],
            env: { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
            label: c,
            version,
        };
        break;
    }
    pythonCache = { key, result };
    return result;
}

/** Forget the cached Python lookup, after the owner changes the path. */
export function resetRuntimeCache(): void {
    pythonCache = undefined;
}

/** Where installers usually put Python, beyond the PATH. */
function usualPythonDirs(): string[] {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
    if (process.platform === 'win32') {
        const roots = [
            path.join(process.env.LOCALAPPDATA ?? '', 'Programs', 'Python'),
            process.env.ProgramFiles ?? 'C:\\Program Files',
            'C:\\',
        ];
        const out: string[] = [];
        for (const r of roots) {
            try {
                for (const d of fs.readdirSync(r)) if (/^Python3\d+/i.test(d)) out.push(path.join(r, d));
            } catch {
                /* not there */
            }
        }
        return out;
    }
    return ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', path.join(home, '.pyenv', 'shims')];
}

/** Every Python 3 this computer seems to have, with its version, for the owner to pick from. */
export function findPythonCandidates(): { path: string; version: string }[] {
    const names = ['python3', 'python'];
    const exts = process.platform === 'win32' ? ['.exe'] : [''];
    const candidates = [...pathCandidates(names)];
    for (const d of usualPythonDirs())
        for (const n of names) for (const x of exts) candidates.push(path.join(d, n + x));
    const seen = new Set<string>();
    const out: { path: string; version: string }[] = [];
    for (const c of candidates) {
        let real = c;
        try {
            real = fs.realpathSync(c);
        } catch {
            continue;
        }
        if (seen.has(real) || isStoreAlias(c)) continue;
        seen.add(real);
        const version = tryVersion(c);
        if (version) out.push({ path: c, version });
    }
    return out;
}

/** The version string when `exe` is a working Python 3, else the reason it is not. */
export function checkPython(exe: string): { version: string } | { error: string } {
    if (!fs.existsSync(exe)) return { error: `${exe} does not exist` };
    if (isStoreAlias(exe))
        return { error: 'that is the Microsoft Store alias, not a Python; install Python from python.org' };
    const version = tryVersion(exe);
    return version ? { version } : { error: `${exe} did not answer --version as a Python 3` };
}

/** What to spawn for a manifest, or the reason nothing can be. */
export function resolveRuntime(
    manifest: AppManifest,
    appDir: string,
    pythonPath: string | undefined,
): { runtime: ResolvedRuntime; args: string[] } | { error: string } {
    switch (manifest.runtime) {
        case 'node':
            return { runtime: nodeRuntime(), args: manifest.start };
        case 'python3': {
            const py = findPython(pythonPath);
            if (!py) {
                return {
                    error: pythonPath
                        ? `Python 3 was not found at ${pythonPath}`
                        : 'Python 3 was not found on this computer. Install it from python.org, or set its path on the Apps card.',
                };
            }
            return { runtime: py, args: manifest.start };
        }
        case 'binary': {
            const [exe, ...rest] = manifest.start;
            const resolved = path.isAbsolute(exe) ? exe : path.join(appDir, exe);
            if (!fs.existsSync(resolved)) return { error: `${exe} is not in the package` };
            return {
                runtime: { command: resolved, argsPrefix: [], env: {}, label: resolved },
                args: rest,
            };
        }
    }
}
