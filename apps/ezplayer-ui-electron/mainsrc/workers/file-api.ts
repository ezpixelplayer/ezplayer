/**
 * File-management HTTP API, FPP-shaped.
 *
 * Serves the show folder over HTTP so remote clients (embedded web UI, cloud,
 * FPP-ecosystem integrators) can list, download, upload, and delete show files
 * without native dialogs. Paths and response shapes mimic FPP's
 * www/api/controllers/files.php so FPP tooling works unchanged:
 *   GET    /api/files/:dirName           list (?nameOnly=1 -> string array)
 *   GET    /api/file/:dirName/:name      download (?play=1 -> inline media)
 *   POST   /api/file/:dirName/:name      single-shot raw-body upload
 *   POST   /api/file/:dirName            chunked-upload init -> uniqid text
 *   PATCH  /api/file/:dirName            chunk (Upload-Name/-Offset/-Length headers)
 *   DELETE /api/file/:dirName/:name      delete
 *   GET    /api/media                    music+video name array
 *   GET    /api/sequence                 sequence base-name array
 *   GET    /api/sequence/:name           download .fseq
 *   POST   /api/sequence/:name           raw-body .fseq upload
 *
 * EZPlayer-native additions (JSON bodies, registered on the shared router so
 * they sit behind jsonBody()):
 *   POST /api/sequences                  register SequenceRecords (RPC to main)
 *   POST /api/sequences/autodetect       find audio/metadata for an fseq
 *
 * EZP show folders are flat xLights folders, so every logical FPP directory
 * maps to the show root with an extension filter (table below — kept so
 * subdirectories could be adopted later without touching handlers).
 *
 * The raw-transfer router must be mounted BEFORE jsonBody() so upload bodies
 * are never consumed by the JSON parser regardless of content type.
 */

import Router from '@koa/router';
import type Koa from 'koa';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import * as crypto from 'crypto';
import type { IncomingMessage } from 'http';
import { send } from '@koa/send';
import { FSEQReaderAsync } from '@ezplayer/epp';
import type { SequenceRecord } from '@ezplayer/ezplayer-core';
import { autoDetectSongFilesFromFseq } from '../data/song-file-autodetect.js';

export interface FileApiDeps {
    getShowFolder: () => string | undefined;
    getSequences: () => SequenceRecord[] | undefined;
    putSequences: (recs: unknown[]) => Promise<unknown[]>;
}

const AUDIO_EXTS = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac', '.wma']);
const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.mpg', '.mpeg']);
const IMAGE_EXTS = new Set(['.gif', '.jpg', '.jpeg', '.png', '.webp', '.bmp']);
const SEQ_EXTS = new Set(['.fseq']);

const DIR_MAP: Record<string, { exts?: Set<string> }> = {
    sequences: { exts: SEQ_EXTS },
    music: { exts: AUDIO_EXTS },
    videos: { exts: VIDEO_EXTS },
    images: { exts: IMAGE_EXTS },
    uploads: {}, // unfiltered
};

/** Never writable/deletable through this API. (Dotfiles — .ezplayer/, the
 *  folder lock — are excluded wholesale by checkName.) */
const PROTECTED_NAMES = new Set(['xlights_rgbeffects.xml', 'xlights_networks.xml']);

const MAX_UPLOAD_BYTES = (() => {
    const mb = Number(process.env.EZPLAYER_MAX_UPLOAD_MB);
    return Number.isFinite(mb) && mb > 0 ? mb * 1024 * 1024 : 2 * 1024 * 1024 * 1024;
})();

const MEDIA_MIME: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.aac': 'audio/aac',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.wma': 'audio/x-ms-wma',
    '.mp4': 'video/mp4',
    '.mkv': 'video/x-matroska',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.mpg': 'video/mpeg',
    '.mpeg': 'video/mpeg',
    '.gif': 'image/gif',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.fseq': 'application/octet-stream',
};

/** A file name is acceptable iff it's a plain basename: no separators, no
 *  traversal, not a dotfile (which blocks .ezplayer/ and the folder lock). */
function checkName(name: string | undefined): string | null {
    if (!name) return 'File name is required';
    if (name.includes('/') || name.includes('\\')) return 'Subdirectories are not supported';
    if (name === '..' || name === '.' || name.startsWith('.')) return 'Invalid file name';
    if (name !== path.basename(name)) return 'Invalid file name';
    return null;
}

/** Resolve name inside the show folder with a case-insensitive prefix check
 *  (mirrors the /api/show-file guard; Windows paths compare lowercased). */
function resolveInShow(showFolder: string, name: string): string | null {
    const root = path.resolve(showFolder);
    const resolved = path.resolve(root, name);
    if (!resolved.toLowerCase().startsWith(root.toLowerCase() + path.sep)) return null;
    return resolved;
}

// ---------------------------------------------------------------------------
// FPP presentation formats (files.php / common.php)
// ---------------------------------------------------------------------------

/** FPP: date('m/d/y  h:i A') — note the double space. */
function fppMtime(d: Date): string {
    const p2 = (n: number) => String(n).padStart(2, '0');
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    const ampm = d.getHours() < 12 ? 'AM' : 'PM';
    return `${p2(d.getMonth() + 1)}/${p2(d.getDate())}/${p2(d.getFullYear() % 100)}  ${p2(h)}:${p2(d.getMinutes())} ${ampm}`;
}

/** FPP humanFileSize: number_format(x, 2) + unit, "0B" for empty. */
function fppSizeHuman(bytes: number): string {
    if (bytes <= 0) return '0B';
    const units = ['B', 'kB', 'MB', 'GB', 'TB'];
    const base = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const val = bytes / Math.pow(1024, base);
    return `${val.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${units[base]}`;
}

/** FPP human_playtime: [HHh:]MMm:SSs. */
function fppPlaytime(totalSeconds: number | undefined): string {
    if (totalSeconds === undefined || !Number.isFinite(totalSeconds)) return 'Unknown';
    const t = Math.floor(totalSeconds);
    const p2 = (n: number) => String(n).padStart(2, '0');
    const hours = Math.floor(t / 3600);
    const prefix = hours > 0 ? `${p2(hours)}h:` : '';
    return `${prefix}${p2(Math.floor(t / 60) % 60)}m:${p2(t % 60)}s`;
}

// ---------------------------------------------------------------------------
// Upload plumbing
// ---------------------------------------------------------------------------

async function ensureStagingDir(showFolder: string): Promise<string> {
    const dir = path.join(showFolder, '.ezplayer', 'tmp-uploads');
    await fsp.mkdir(dir, { recursive: true });
    return dir;
}

/** Stream an incoming request body to a file, enforcing MAX_UPLOAD_BYTES.
 *  Returns bytes written. */
function streamToFile(req: IncomingMessage, filePath: string, append = false): Promise<number> {
    return new Promise((resolve, reject) => {
        let written = 0;
        const out = fs.createWriteStream(filePath, { flags: append ? 'a' : 'w' });
        req.on('data', (chunk: Buffer) => {
            written += chunk.length;
            if (written > MAX_UPLOAD_BYTES) {
                req.destroy();
                out.destroy();
                reject(Object.assign(new Error('Upload exceeds maximum size'), { status: 413 }));
            }
        });
        req.pipe(out);
        out.on('finish', () => resolve(written));
        out.on('error', reject);
        req.on('error', reject);
    });
}

interface ChunkSession {
    tmpPath: string;
    handle: fsp.FileHandle;
    received: number;
    total: number;
    lastActivity: number;
}

// Keyed by `${dirKey}:${fileName}` — FPP's PATCH carries no session id, only
// Upload-Name headers, so concurrent uploads of different files coexist and
// re-uploading the same name at offset 0 restarts the session.
const chunkSessions = new Map<string, ChunkSession>();

async function dropSession(key: string): Promise<void> {
    const s = chunkSessions.get(key);
    if (!s) return;
    chunkSessions.delete(key);
    try {
        await s.handle.close();
    } catch {}
    try {
        await fsp.unlink(s.tmpPath);
    } catch {}
}

const SESSION_IDLE_MS = 15 * 60 * 1000;
setInterval(() => {
    const now = Date.now();
    for (const [key, s] of chunkSessions) {
        if (now - s.lastActivity > SESSION_IDLE_MS) void dropSession(key);
    }
}, 60_000).unref();

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function createFileApiRouter(deps: FileApiDeps): Router {
    const router = new Router();

    function requireShowFolder(ctx: Koa.Context): string | undefined {
        const sf = deps.getShowFolder();
        if (!sf) {
            ctx.status = 400;
            ctx.body = { status: 'error', error: 'Show folder not set' };
            return undefined;
        }
        return sf;
    }

    function requireDir(ctx: Koa.Context): { key: string; exts?: Set<string> } | undefined {
        const key = String(ctx.params.dirName ?? '').toLowerCase();
        const dir = DIR_MAP[key];
        if (!dir) {
            ctx.status = 404;
            ctx.body = { status: 'error', error: `Unknown directory: ${ctx.params.dirName}` };
            return undefined;
        }
        return { key, ...dir };
    }

    /** Validated absolute target for a :name route, or undefined (error set). */
    function requireTarget(ctx: Koa.Context, showFolder: string, forWrite: boolean): string | undefined {
        const name = String(ctx.params.name ?? '');
        const nameErr = checkName(name);
        if (nameErr) {
            ctx.status = 400;
            ctx.body = { status: 'error', error: nameErr };
            return undefined;
        }
        if (forWrite && PROTECTED_NAMES.has(name.toLowerCase())) {
            ctx.status = 403;
            ctx.body = { status: 'error', error: `${name} is managed by EZPlayer/xLights and cannot be modified here` };
            return undefined;
        }
        const resolved = resolveInShow(showFolder, name);
        if (!resolved) {
            ctx.status = 403;
            ctx.body = { status: 'error', error: 'Resolved path outside show folder' };
            return undefined;
        }
        return resolved;
    }

    async function listDir(showFolder: string, exts?: Set<string>): Promise<string[]> {
        const entries = await fsp.readdir(showFolder, { withFileTypes: true });
        return entries
            .filter((e) => e.isFile())
            .map((e) => e.name)
            .filter((n) => !n.startsWith('.') && !PROTECTED_NAMES.has(n.toLowerCase()))
            .filter((n) => !exts || exts.has(path.extname(n).toLowerCase()))
            .sort((a, b) => a.localeCompare(b));
    }

    /** Playtime from the cached SequenceRecords (fseq or audio basename match),
     *  falling back to the FSEQ header for unregistered sequence files. */
    async function playtimeSecondsFor(showFolder: string, name: string): Promise<number | undefined> {
        const lower = name.toLowerCase();
        const seqs = deps.getSequences() ?? [];
        for (const s of seqs) {
            const fseq = s.files?.fseq ? path.basename(s.files.fseq).toLowerCase() : undefined;
            const audio = s.files?.audio ? path.basename(s.files.audio).toLowerCase() : undefined;
            if ((fseq === lower || audio === lower) && s.work?.length) return s.work.length;
        }
        if (path.extname(lower) === '.fseq') {
            try {
                const rdr = new FSEQReaderAsync(path.join(showFolder, name));
                await rdr.open();
                const secs = ((rdr.header!.msperframe ?? 50) * (rdr.header!.frames ?? 0)) / 1000;
                await rdr.close();
                return secs;
            } catch {
                return undefined;
            }
        }
        return undefined;
    }

    // ------------------------------------------------------------------
    // Listings
    // ------------------------------------------------------------------

    router.get('/api/files/:dirName', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        const dir = requireDir(ctx);
        if (!dir) return;

        const names = await listDir(showFolder, dir.exts);
        if (ctx.query.nameOnly !== undefined && ctx.query.nameOnly !== '0') {
            ctx.body = names;
            return;
        }
        const files = [];
        for (const name of names) {
            const st = await fsp.stat(path.join(showFolder, name));
            files.push({
                name,
                mtime: fppMtime(st.mtime),
                sizeBytes: st.size,
                sizeHuman: fppSizeHuman(st.size),
                playtimeSeconds: fppPlaytime(await playtimeSecondsFor(showFolder, name)),
            });
        }
        ctx.body = { status: 'ok', files };
    });

    router.get('/api/media', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        const music = await listDir(showFolder, AUDIO_EXTS);
        const videos = await listDir(showFolder, VIDEO_EXTS);
        ctx.body = [...music, ...videos].sort((a, b) => a.localeCompare(b));
    });

    router.get('/api/sequence', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        const names = await listDir(showFolder, SEQ_EXTS);
        ctx.body = names.map((n) => n.replace(/\.fseq$/i, ''));
    });

    // ------------------------------------------------------------------
    // Download
    // ------------------------------------------------------------------

    async function serveDownload(ctx: Koa.Context, filePath: string, play: boolean): Promise<void> {
        try {
            const st = await fsp.stat(filePath);
            if (!st.isFile()) throw new Error('not a file');
        } catch {
            ctx.status = 404;
            ctx.body = { status: 'error', error: 'File not found' };
            return;
        }
        const ext = path.extname(filePath).toLowerCase();
        ctx.type = MEDIA_MIME[ext] ?? 'application/octet-stream';
        if (!play) {
            ctx.set('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
        }
        await send(ctx, path.basename(filePath), { root: path.dirname(filePath) });
    }

    router.get('/api/file/:dirName/:name', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        if (!requireDir(ctx)) return;
        const target = requireTarget(ctx, showFolder, false);
        if (!target) return;
        await serveDownload(ctx, target, ctx.query.play !== undefined || ctx.query.attach === '0');
    });

    router.get('/api/sequence/:name', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        ctx.params.name = /\.fseq$/i.test(String(ctx.params.name)) ? ctx.params.name : `${ctx.params.name}.fseq`;
        const target = requireTarget(ctx, showFolder, false);
        if (!target) return;
        await serveDownload(ctx, target, false);
    });

    // ------------------------------------------------------------------
    // Upload
    // ------------------------------------------------------------------

    async function singleShotUpload(ctx: Koa.Context, showFolder: string, target: string): Promise<void> {
        const staging = await ensureStagingDir(showFolder);
        const tmp = path.join(staging, `post-${crypto.randomBytes(8).toString('hex')}`);
        try {
            const written = await streamToFile(ctx.req, tmp);
            await fsp.rename(tmp, target);
            ctx.body = {
                status: 'OK',
                file: path.basename(target),
                dir: String(ctx.params.dirName ?? 'sequences').toLowerCase(),
                written,
                size: written,
                offset: 0,
            };
        } catch (err: any) {
            try {
                await fsp.unlink(tmp);
            } catch {}
            ctx.status = err?.status ?? 500;
            ctx.body = { status: 'error', error: err?.message ?? 'Upload failed' };
        }
    }

    router.post('/api/file/:dirName/:name', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        if (!requireDir(ctx)) return;
        const target = requireTarget(ctx, showFolder, true);
        if (!target) return;
        await singleShotUpload(ctx, showFolder, target);
    });

    router.post('/api/sequence/:name', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        ctx.params.name = /\.fseq$/i.test(String(ctx.params.name)) ? ctx.params.name : `${ctx.params.name}.fseq`;
        ctx.params.dirName = 'sequences';
        const target = requireTarget(ctx, showFolder, true);
        if (!target) return;
        await singleShotUpload(ctx, showFolder, target);
        if (ctx.status === 200 && ctx.body && (ctx.body as any).status === 'OK') {
            ctx.body = { Status: 'OK', Message: '' }; // FPP sequence.php shape
        }
    });

    // Chunked upload init — FPP returns a bare uniqid string.
    router.post('/api/file/:dirName', async (ctx) => {
        if (!requireShowFolder(ctx)) return;
        if (!requireDir(ctx)) return;
        ctx.type = 'text/plain';
        ctx.body = `${Date.now().toString(16)}.${crypto.randomBytes(8).toString('hex')}`;
    });

    router.patch('/api/file/:dirName', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        const dir = requireDir(ctx);
        if (!dir) return;

        const name = ctx.get('Upload-Name');
        const offset = Number(ctx.get('Upload-Offset'));
        const total = Number(ctx.get('Upload-Length'));
        const nameErr = checkName(name);
        if (nameErr || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(total) || total <= 0) {
            ctx.status = 400;
            ctx.body = { status: 'error', error: nameErr ?? 'Upload-Offset / Upload-Length headers required' };
            return;
        }
        if (total > MAX_UPLOAD_BYTES) {
            ctx.status = 413;
            ctx.body = { status: 'error', error: 'Upload exceeds maximum size' };
            return;
        }
        if (PROTECTED_NAMES.has(name.toLowerCase())) {
            ctx.status = 403;
            ctx.body = { status: 'error', error: `${name} is managed by EZPlayer/xLights and cannot be modified here` };
            return;
        }
        const target = resolveInShow(showFolder, name);
        if (!target) {
            ctx.status = 403;
            ctx.body = { status: 'error', error: 'Resolved path outside show folder' };
            return;
        }

        const key = `${dir.key}:${name.toLowerCase()}`;
        let session = chunkSessions.get(key);
        if (offset === 0 && session) {
            await dropSession(key); // restarted upload
            session = undefined;
        }
        if (!session) {
            const staging = await ensureStagingDir(showFolder);
            const tmpPath = path.join(staging, `patch-${crypto.randomBytes(8).toString('hex')}`);
            session = {
                tmpPath,
                handle: await fsp.open(tmpPath, 'w+'),
                received: 0,
                total,
                lastActivity: Date.now(),
            };
            chunkSessions.set(key, session);
        }

        try {
            // Positional writes make out-of-order chunks safe.
            let pos = offset;
            for await (const chunk of ctx.req) {
                const buf = chunk as Buffer;
                if (pos + buf.length > MAX_UPLOAD_BYTES) {
                    throw Object.assign(new Error('Upload exceeds maximum size'), { status: 413 });
                }
                await session.handle.write(buf, 0, buf.length, pos);
                pos += buf.length;
                session.received += buf.length;
            }
            session.lastActivity = Date.now();

            if (session.received >= session.total) {
                await session.handle.close();
                chunkSessions.delete(key);
                await fsp.rename(session.tmpPath, target);
            }
            ctx.body = { status: 'OK', file: name, dir: dir.key, size: session.received };
        } catch (err: any) {
            await dropSession(key);
            ctx.status = err?.status ?? 500;
            ctx.body = { status: 'failed', file: name, dir: dir.key, error: err?.message ?? 'Upload failed' };
        }
    });

    // ------------------------------------------------------------------
    // Delete
    // ------------------------------------------------------------------

    router.delete('/api/file/:dirName/:name', async (ctx) => {
        const showFolder = requireShowFolder(ctx);
        if (!showFolder) return;
        if (!requireDir(ctx)) return;
        const target = requireTarget(ctx, showFolder, true);
        if (!target) return;
        try {
            await fsp.unlink(target);
            ctx.body = { status: 'OK', file: path.basename(target) };
        } catch (err: any) {
            ctx.status = err?.code === 'ENOENT' ? 404 : 500;
            ctx.body = { status: 'error', error: err?.message ?? 'Delete failed' };
        }
    });

    return router;
}

/** EZP-native JSON routes — registered on the shared router (behind jsonBody). */
export function registerSequenceApiRoutes(router: Router, deps: FileApiDeps): void {
    router.post('/api/sequences', async (ctx) => {
        const recs = ctx.request.body;
        if (!Array.isArray(recs)) {
            ctx.status = 400;
            ctx.body = { error: 'Body must be an array of SequenceRecords' };
            return;
        }
        try {
            const sequences = await deps.putSequences(recs);
            ctx.body = { success: true, sequences };
        } catch (err: any) {
            ctx.status = 503;
            ctx.body = { error: err?.message ?? 'Sequence update failed' };
        }
    });

    router.post('/api/sequences/autodetect', async (ctx) => {
        const showFolder = deps.getShowFolder();
        if (!showFolder) {
            ctx.status = 400;
            ctx.body = { error: 'Show folder not set' };
            return;
        }
        const fseqName = (ctx.request.body as any)?.fseq;
        const nameErr = checkName(typeof fseqName === 'string' ? fseqName : undefined);
        if (nameErr) {
            ctx.status = 400;
            ctx.body = { error: nameErr };
            return;
        }
        const target = resolveInShow(showFolder, fseqName);
        if (!target) {
            ctx.status = 403;
            ctx.body = { error: 'Resolved path outside show folder' };
            return;
        }
        const detected = await autoDetectSongFilesFromFseq(target);
        // Report show-relative names — clients never see absolute player paths.
        ctx.body = {
            ...detected,
            audioFile: detected.audioFile ? path.basename(detected.audioFile) : undefined,
            imageFile: detected.imageFile ? path.basename(detected.imageFile) : undefined,
        };
    });
}
