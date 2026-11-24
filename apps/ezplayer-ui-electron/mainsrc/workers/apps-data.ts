import { promises as fsp } from 'node:fs';
import path from 'node:path';

export type DataScope = 'public' | 'private';

/** One path component: letters, digits, dot, dash, underscore; no leading dot. */
export const DATA_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Everything one instance may store, across both scopes. */
export const DATA_QUOTA_BYTES = 16 * 1024 * 1024;
/** One document. */
export const DATA_MAX_DOC_BYTES = 4 * 1024 * 1024;

export function isDataScope(s: string): s is DataScope {
    return s === 'public' || s === 'private';
}

export function dataPath(dataDir: string, scope: DataScope, key: string): string {
    return path.join(dataDir, scope, key);
}

/** Each document is stored with a sidecar holding its content type. */
function metaPath(file: string): string {
    return `${file}.ezmeta`;
}

export interface StoredDoc {
    data: Buffer;
    contentType: string;
    mtimeMs: number;
}

export async function readDoc(dataDir: string, scope: DataScope, key: string): Promise<StoredDoc | undefined> {
    const file = dataPath(dataDir, scope, key);
    try {
        const [data, st] = await Promise.all([fsp.readFile(file), fsp.stat(file)]);
        let contentType = 'application/octet-stream';
        try {
            contentType = (await fsp.readFile(metaPath(file), 'utf8')).trim() || contentType;
        } catch {
            /* no sidecar: a file the owner dropped in by hand */
        }
        return { data, contentType, mtimeMs: st.mtimeMs };
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw err;
    }
}

/** Total bytes stored by the instance, both scopes, sidecars excluded. */
export async function usedBytes(dataDir: string): Promise<number> {
    let total = 0;
    for (const scope of ['public', 'private'] as const) {
        let names: string[];
        try {
            names = await fsp.readdir(path.join(dataDir, scope));
        } catch {
            continue;
        }
        for (const n of names) {
            if (n.endsWith('.ezmeta')) continue;
            try {
                total += (await fsp.stat(path.join(dataDir, scope, n))).size;
            } catch {
                /* raced with a delete */
            }
        }
    }
    return total;
}

export async function writeDoc(
    dataDir: string,
    scope: DataScope,
    key: string,
    data: Buffer,
    contentType: string,
): Promise<void> {
    const file = dataPath(dataDir, scope, key);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file);
    await fsp.writeFile(metaPath(file), contentType.slice(0, 120));
}

export async function deleteDoc(dataDir: string, scope: DataScope, key: string): Promise<boolean> {
    const file = dataPath(dataDir, scope, key);
    try {
        await fsp.unlink(file);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw err;
    }
    await fsp.rm(metaPath(file), { force: true });
    return true;
}

export interface DocInfo {
    key: string;
    size: number;
    contentType: string;
    mtimeMs: number;
}

export async function listDocs(dataDir: string, scope: DataScope): Promise<DocInfo[]> {
    let names: string[];
    try {
        names = await fsp.readdir(path.join(dataDir, scope));
    } catch {
        return [];
    }
    const out: DocInfo[] = [];
    for (const n of names.sort()) {
        if (!DATA_KEY_RE.test(n)) continue;
        const file = path.join(dataDir, scope, n);
        try {
            const st = await fsp.stat(file);
            if (!st.isFile()) continue;
            let contentType = 'application/octet-stream';
            try {
                contentType = (await fsp.readFile(metaPath(file), 'utf8')).trim() || contentType;
            } catch {
                /* no sidecar */
            }
            out.push({ key: n, size: st.size, contentType, mtimeMs: st.mtimeMs });
        } catch {
            /* raced with a delete */
        }
    }
    return out;
}
