import fs, { promises as fsp } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { app } from 'electron';
import type { AppInstallSource } from '@ezplayer/ezplayer-core';
import { MANIFEST_FILE, parseManifest } from './apps-manifest.js';
import { appsDir } from './apps-store.js';
import { readTar } from './tar-extract.js';

/** The curated source: every app in the contrib repository. */
export const CONTRIB_TARBALL = 'https://github.com/ezpixelplayer/ezplayer-contrib/archive/refs/heads/main.tar.gz';

/** Written into each installed package so `update` knows where it came from. */
export const SOURCE_FILE = '.ezapp-source.json';

const MAX_DOWNLOAD = 64 * 1024 * 1024;
const MAX_EXTRACTED = 256 * 1024 * 1024;
const MAX_FILE = 32 * 1024 * 1024;

export interface InstallResult {
    installed: string[];
    skipped: string[];
}

/** The example apps shipped with the player: beside the repo in development, in resources when packaged. */
export function examplesDir(): string | undefined {
    const candidates = app.isPackaged
        ? [path.join(process.resourcesPath, 'apps-examples')]
        : [path.resolve(app.getAppPath(), '..', '..', 'apps-examples'), path.resolve(process.cwd(), 'apps-examples')];
    return candidates.find((d) => fs.existsSync(path.join(d)));
}

/** Install from a folder, a tarball or GitHub URL, the contrib repository or the bundled examples. */
export async function installApps(showFolder: string, source: AppInstallSource): Promise<InstallResult> {
    switch (source.kind) {
        case 'folder':
            return { installed: [await installFolder(showFolder, source.path, source)], skipped: [] };
        case 'url':
            return installTarball(showFolder, await tarballUrlFor(source.url), source);
        case 'contrib':
            return installTarball(showFolder, CONTRIB_TARBALL, source);
        case 'examples': {
            const dir = examplesDir();
            if (!dir) throw new Error('no example apps are bundled with this player');
            const result: InstallResult = { installed: [], skipped: [] };
            for (const d of (await fsp.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory())) {
                const from = path.join(dir, d.name);
                if (!fs.existsSync(path.join(from, MANIFEST_FILE))) continue;
                try {
                    result.installed.push(await installFolder(showFolder, from, { kind: 'folder', path: from }));
                } catch (err) {
                    result.skipped.push(`${d.name}: ${(err as Error).message}`);
                }
            }
            return result;
        }
    }
}

/** A `.tar.gz` link as given, or the archive of a GitHub repository page (`/tree/<branch>` honored). */
export async function tarballUrlFor(url: string): Promise<string> {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') throw new Error('app packages are downloaded over https only');
    if (/\.(tar\.gz|tgz)$/i.test(u.pathname)) return u.toString();
    if (u.hostname === 'github.com') {
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts.length >= 2) {
            const [owner, repoRaw] = parts;
            const repo = repoRaw.replace(/\.git$/, '');
            const branch = parts[2] === 'tree' && parts[3] ? parts.slice(3).join('/') : undefined;
            const archive = (b: string) => `https://github.com/${owner}/${repo}/archive/refs/heads/${b}.tar.gz`;
            if (branch) return archive(branch);
            // No branch in the link: the default is usually main, sometimes still master.
            for (const b of ['main', 'master']) {
                const head = await fetch(archive(b), {
                    method: 'HEAD',
                    redirect: 'follow',
                    signal: AbortSignal.timeout(20_000),
                });
                if (head.ok) return archive(b);
            }
            throw new Error(`${owner}/${repo} has neither a main nor a master branch`);
        }
    }
    throw new Error('give a .tar.gz link or a GitHub repository address');
}

async function recordSource(dest: string, source: AppInstallSource): Promise<void> {
    await fsp.writeFile(path.join(dest, SOURCE_FILE), JSON.stringify({ source, installedAt: Date.now() }, null, 2));
}

async function installFolder(showFolder: string, src: string, source: AppInstallSource): Promise<string> {
    const from = path.resolve(src);
    const manifest = parseManifest(JSON.parse(await fsp.readFile(path.join(from, MANIFEST_FILE), 'utf8')));
    const dest = path.join(appsDir(showFolder), manifest.id);
    if (path.resolve(from) === path.resolve(dest)) return manifest.id; // already in place
    await replaceDir(dest, async (tmp) => {
        await fsp.cp(from, tmp, {
            recursive: true,
            // A development checkout may carry these; the package does not need them.
            filter: (p) => !/(^|[\\/])(node_modules|\.git)([\\/]|$)/.test(path.relative(from, p)),
        });
        await recordSource(tmp, source);
    });
    return manifest.id;
}

async function installTarball(showFolder: string, url: string, source: AppInstallSource): Promise<InstallResult> {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`download failed: ${res.status} ${res.statusText}`);
    const gz = Buffer.from(await res.arrayBuffer());
    if (gz.length > MAX_DOWNLOAD) throw new Error('package is larger than 64 MB');
    const tar = gz[0] === 0x1f && gz[1] === 0x8b ? gunzipSync(gz, { maxOutputLength: MAX_EXTRACTED }) : gz;

    // Collect entries, then find every directory holding a manifest. Each becomes one app.
    const entries = [...readTar(tar)];
    const manifests = entries.filter((e) => e.type === 'file' && path.posix.basename(e.path) === MANIFEST_FILE);
    if (manifests.length === 0) throw new Error(`no ${MANIFEST_FILE} in the package`);

    const installed: string[] = [];
    const skipped: string[] = [];
    for (const m of manifests) {
        const root = path.posix.dirname(m.path);
        let id: string;
        try {
            id = parseManifest(JSON.parse(m.data.toString('utf8'))).id;
        } catch (err) {
            skipped.push(`${root}: ${(err as Error).message}`);
            continue;
        }
        const prefix = root === '.' ? '' : `${root}/`;
        // Manifests nested inside another app's tree belong to that app's files, not to us.
        if (manifests.some((o) => o !== m && prefix.startsWith(`${path.posix.dirname(o.path)}/`))) continue;
        const dest = path.join(appsDir(showFolder), id);
        await replaceDir(dest, async (tmp) => {
            let total = 0;
            for (const e of entries) {
                if (!e.path.startsWith(prefix) || e.path === root) continue;
                const rel = e.path.slice(prefix.length);
                if (rel === '' || rel.split('/').includes('..')) continue;
                const target = path.join(tmp, ...rel.split('/'));
                if (e.type === 'dir') {
                    await fsp.mkdir(target, { recursive: true });
                } else {
                    if (e.data.length > MAX_FILE) throw new Error(`${rel} is larger than 32 MB`);
                    total += e.data.length;
                    if (total > MAX_EXTRACTED) throw new Error('package unpacks to more than 256 MB');
                    await fsp.mkdir(path.dirname(target), { recursive: true });
                    await fsp.writeFile(target, e.data, { mode: e.mode & 0o111 ? 0o755 : 0o644 });
                }
            }
            await recordSource(tmp, source);
        });
        installed.push(id);
    }
    return { installed, skipped };
}

/** Build the new contents beside the target, then swap, so a failed install leaves the old app. */
async function replaceDir(dest: string, fill: (tmp: string) => Promise<void>): Promise<void> {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    const tmp = `${dest}.installing`;
    const old = `${dest}.previous`;
    await fsp.rm(tmp, { recursive: true, force: true });
    await fsp.rm(old, { recursive: true, force: true });
    try {
        await fill(tmp);
        try {
            await fsp.rename(dest, old);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
        }
        await fsp.rename(tmp, dest);
        await fsp.rm(old, { recursive: true, force: true });
    } catch (err) {
        await fsp.rm(tmp, { recursive: true, force: true });
        throw err;
    }
}

export async function uninstallApp(showFolder: string, appId: string): Promise<void> {
    await fsp.rm(path.join(appsDir(showFolder), appId), { recursive: true, force: true });
}
