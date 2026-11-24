// Player apps, server side: the routes app pages and app processes use, the per-instance
// event feeds and status snapshots, the document store, the live socket and page hosting.
// Which instances exist, with their secrets, comes from main as `appsAuth` messages.

import type Router from '@koa/router';
import { send } from '@koa/send';
import httpMod from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type Koa from 'koa';
import getRawBody from 'raw-body';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AppInputMapping, AppsCommand, AppsState, AppStatuses, FullPlayerState } from '@ezplayer/ezplayer-core';
import { AppEventFeed } from './apps-events.js';
import {
    DATA_KEY_RE,
    DATA_MAX_DOC_BYTES,
    DATA_QUOTA_BYTES,
    deleteDoc,
    isDataScope,
    listDocs,
    readDoc,
    usedBytes,
    writeDoc,
} from './apps-data.js';
import { APPS_SDK_JS } from './apps-sdk.js';
import type { AppsAuthEntry } from './serverworkertypes.js';

const STATUS_MAX_BYTES = 256 * 1024;
const EVENT_MAX_BYTES = 64 * 1024;
const POLL_MAX_WAIT_MS = 60_000;
const PAGE_PROXY_MAX_BODY = 2 * 1024 * 1024;
const PAGE_PROXY_TIMEOUT_MS = 30_000;
const INSTANCE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export interface AppsApiDeps {
    appsCommand(cmd: AppsCommand): Promise<AppsState>;
    sawStatus(instance: string): void;
    /** Read the broadcast state (the `apps` key holds input mappings). */
    getState<K extends keyof FullPlayerState>(key: K): FullPlayerState[K] | undefined;
    /** Publish the status map to viewers and the cloud. */
    setState(key: 'appStatuses', value: AppStatuses): void;
}

/** Worker-side state for app instances. */
export class AppsRuntime {
    private instances: Record<string, AppsAuthEntry> = {};
    private readonly feeds = new Map<string, AppEventFeed>();
    private readonly statuses: AppStatuses = {};
    private readonly live = new Map<string, Set<WebSocket>>();

    constructor(private readonly deps: AppsApiDeps) {}

    /** Replace the instance set. Feeds and statuses of instances that are gone go with them. */
    setInstances(next: Record<string, AppsAuthEntry>): void {
        for (const name of Object.keys(this.instances)) {
            if (next[name]) continue;
            this.feeds.get(name)?.close();
            this.feeds.delete(name);
            delete this.statuses[name];
            for (const ws of this.live.get(name) ?? []) ws.close(1001, 'app instance removed');
            this.live.delete(name);
        }
        for (const [name, entry] of Object.entries(next)) {
            const was = this.instances[name];
            // A new process starts with an empty feed; its old events belonged to the last run.
            if (was && was.token !== entry.token) {
                this.feeds.get(name)?.close();
                this.feeds.delete(name);
            }
        }
        this.instances = next;
        this.deps.setState('appStatuses', { ...this.statuses });
    }

    /** The running instance behind an app token, for leases the process opens in its own name. */
    ownerOf(token: string | undefined): { instance: string; title: string } | undefined {
        if (!token) return undefined;
        for (const [instance, entry] of Object.entries(this.instances)) {
            if (entry.token === token) return { instance, title: entry.title };
        }
        return undefined;
    }

    entry(name: string): AppsAuthEntry | undefined {
        return INSTANCE_RE.test(name) ? this.instances[name] : undefined;
    }

    feed(name: string): AppEventFeed {
        let f = this.feeds.get(name);
        if (!f) {
            const e = this.instances[name];
            f = new AppEventFeed(e?.eventsPerMinute, e?.clientPerSecond);
            this.feeds.set(name, f);
        }
        return f;
    }

    status(name: string) {
        return this.statuses[name] ?? { seq: 0, at: 0, state: null };
    }

    setStatus(name: string, state: unknown): void {
        const prev = this.statuses[name];
        const snap = { seq: (prev?.seq ?? 0) + 1, at: Date.now(), state };
        this.statuses[name] = snap;
        this.deps.setState('appStatuses', { ...this.statuses });
        this.deps.sawStatus(name);
        const msg = JSON.stringify({ type: 'status', ...snap });
        for (const ws of this.live.get(name) ?? []) {
            if (ws.readyState === ws.OPEN && ws.bufferedAmount < 1024 * 1024) ws.send(msg);
        }
    }

    /** The instances visitors may see right now. */
    publicList(): { instance: string; name: string; icon?: string; description?: string; page: string }[] {
        return Object.entries(this.instances)
            .filter(([, e]) => e.running)
            .map(([instance, e]) => ({
                instance,
                name: e.title,
                icon: e.icon,
                description: e.description,
                page: `/apps/${encodeURIComponent(instance)}/`,
            }));
    }

    /** Deliver a show input to every instance mapped to it. Returns how many got it. */
    input(source: string, name: string, value: unknown): number {
        const mappings = (this.deps.getState('apps')?.inputMappings ?? []) as AppInputMapping[];
        let n = 0;
        for (const m of mappings) {
            if (m.source !== source || m.name !== name) continue;
            const e = this.instances[m.instance];
            if (!e?.running) continue;
            const r = this.feed(m.instance).push(`input:${source}`, source, {
                type: 'input',
                input: m.input,
                source,
                name,
                value,
            });
            if (!('refused' in r)) n++;
        }
        return n;
    }

    addLive(name: string, ws: WebSocket): void {
        let set = this.live.get(name);
        if (!set) {
            set = new Set();
            this.live.set(name, set);
        }
        set.add(ws);
        ws.on('close', () => set!.delete(ws));
        const snap = this.statuses[name];
        if (snap) ws.send(JSON.stringify({ type: 'status', ...snap }));
    }
}

function tokenOf(ctx: Koa.Context): string | undefined {
    const h = ctx.get('x-ezp-app-token');
    if (h) return h;
    const q = ctx.query.token;
    return typeof q === 'string' ? q : undefined;
}

/** Routes the app process and its pages call. Web app only; never on the kiosk. */
export function registerAppsRoutes(router: Router, apps: AppsRuntime, deps: AppsApiDeps): void {
    const notFound = (ctx: Koa.Context) => {
        ctx.status = 404;
        ctx.body = { error: 'no such app instance' };
    };
    /** The instance's own token, for routes only its process may call. */
    const authed = (ctx: Koa.Context, entry: AppsAuthEntry): boolean => {
        if (!entry.token) {
            ctx.status = 503;
            ctx.body = { error: 'app is not running' };
            return false;
        }
        if (tokenOf(ctx) !== entry.token) {
            ctx.status = 401;
            ctx.body = { error: 'bad app token' };
            return false;
        }
        return true;
    };

    router.get('/api/ezp/apps', (ctx) => {
        ctx.set('Cache-Control', 'no-store');
        ctx.body = {
            ...(deps.getState('apps') ?? { apps: [], instances: [], defaultSchedule: [], inputMappings: [] }),
        };
    });

    router.post('/api/ezp/apps/command', async (ctx) => {
        const cmd = ctx.request.body as AppsCommand | undefined;
        if (!cmd || typeof cmd.op !== 'string') {
            ctx.status = 400;
            ctx.body = { error: 'op is required' };
            return;
        }
        ctx.body = await deps.appsCommand(cmd);
    });

    router.get('/api/ezp/apps/public', (ctx) => {
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Cache-Control', 'no-store');
        ctx.body = { apps: apps.publicList() };
    });

    router.get('/api/ezp/apps/:name/status', (ctx) => {
        if (!apps.entry(ctx.params.name)) return notFound(ctx);
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Cache-Control', 'no-store');
        ctx.body = apps.status(ctx.params.name);
    });

    router.put('/api/ezp/apps/:name/status', async (ctx) => {
        const entry = apps.entry(ctx.params.name);
        if (!entry) return notFound(ctx);
        if (!authed(ctx, entry)) return;
        const state = ctx.request.body ?? (await parseJsonBody(ctx, STATUS_MAX_BYTES));
        if (state === undefined) return;
        if (JSON.stringify(state).length > STATUS_MAX_BYTES) {
            ctx.status = 413;
            ctx.body = { error: 'status is larger than 256 KB' };
            return;
        }
        apps.setStatus(ctx.params.name, state);
        ctx.body = { ok: true, seq: apps.status(ctx.params.name).seq };
    });

    router.post('/api/ezp/apps/:name/events', async (ctx) => {
        const entry = apps.entry(ctx.params.name);
        if (!entry) return notFound(ctx);
        ctx.set('Access-Control-Allow-Origin', '*');
        if (!entry.running) {
            ctx.status = 503;
            ctx.body = { error: 'app is not running' };
            return;
        }
        const body = (ctx.request.body ?? (await parseJsonBody(ctx, EVENT_MAX_BYTES))) as
            { client?: unknown; data?: unknown } | undefined;
        if (body === undefined) return;
        if (JSON.stringify(body).length > EVENT_MAX_BYTES) {
            ctx.status = 413;
            ctx.body = { error: 'event is larger than 64 KB' };
            return;
        }
        // The cloud forwarder marks its requests; anything else came from the LAN.
        const source = ctx.get('x-ezp-source') === 'cloud' ? 'cloud' : 'lan';
        const client =
            typeof body.client === 'string' && body.client.trim()
                ? body.client.trim().slice(0, 64)
                : ctx.get('x-ezp-client') || ctx.ip;
        const r = apps.feed(ctx.params.name).push(source, client, body.data);
        if ('refused' in r) {
            ctx.status = 429;
            ctx.body = { error: r.refused };
            return;
        }
        ctx.body = { ok: true, id: r.id };
    });

    router.get('/api/ezp/apps/:name/events', async (ctx) => {
        const entry = apps.entry(ctx.params.name);
        if (!entry) return notFound(ctx);
        if (!authed(ctx, entry)) return;
        const since = Math.max(0, Number(ctx.query.since) || 0);
        const wait = Math.min(POLL_MAX_WAIT_MS, Math.max(0, (Number(ctx.query.wait) || 0) * 1000));
        ctx.set('Cache-Control', 'no-store');
        const events = await apps.feed(ctx.params.name).poll(since, wait);
        ctx.body = { events };
    });

    // -- documents --------------------------------------------------------------
    const docRoute = (ctx: Koa.Context) => {
        const entry = apps.entry(ctx.params.name);
        if (!entry) {
            notFound(ctx);
            return undefined;
        }
        const scope = ctx.params.scope;
        if (!isDataScope(scope)) {
            ctx.status = 404;
            ctx.body = { error: 'scope must be public or private' };
            return undefined;
        }
        const key = ctx.params.key as string | undefined;
        if (key !== undefined && !DATA_KEY_RE.test(key)) {
            ctx.status = 400;
            ctx.body = { error: 'key: letters, digits, dot, dash, underscore; up to 64' };
            return undefined;
        }
        return { entry, scope, key };
    };

    router.get('/api/ezp/apps/:name/data/:scope', async (ctx) => {
        const r = docRoute(ctx);
        if (!r) return;
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Cache-Control', 'no-store');
        ctx.body = { keys: await listDocs(r.entry.dataDir, r.scope) };
    });

    router.get('/api/ezp/apps/:name/data/:scope/:key', async (ctx) => {
        const r = docRoute(ctx);
        if (!r) return;
        const doc = await readDoc(r.entry.dataDir, r.scope, r.key!);
        ctx.set('Access-Control-Allow-Origin', '*');
        ctx.set('Cache-Control', 'no-store');
        if (!doc) {
            ctx.status = 404;
            ctx.body = { error: 'no such key' };
            return;
        }
        ctx.set('Last-Modified', new Date(doc.mtimeMs).toUTCString());
        ctx.type = doc.contentType;
        ctx.body = doc.data;
    });

    router.put('/api/ezp/apps/:name/data/:scope/:key', async (ctx) => {
        const r = docRoute(ctx);
        if (!r) return;
        let data: Buffer;
        let contentType = ctx.get('content-type') || 'application/octet-stream';
        if (ctx.request.body !== undefined) {
            // jsonBody already consumed a JSON request.
            data = Buffer.from(JSON.stringify(ctx.request.body), 'utf8');
            contentType = 'application/json';
        } else {
            try {
                data = await getRawBody(ctx.req, { limit: DATA_MAX_DOC_BYTES });
            } catch {
                ctx.status = 413;
                ctx.body = { error: 'document is larger than 4 MB' };
                return;
            }
        }
        const existing = await readDoc(r.entry.dataDir, r.scope, r.key!);
        const used = await usedBytes(r.entry.dataDir);
        if (used - (existing?.data.length ?? 0) + data.length > DATA_QUOTA_BYTES) {
            ctx.status = 507;
            ctx.body = { error: 'this app has used its 16 MB of storage' };
            return;
        }
        await writeDoc(r.entry.dataDir, r.scope, r.key!, data, contentType);
        ctx.status = existing ? 200 : 201;
        ctx.body = { ok: true, key: r.key, size: data.length };
    });

    router.delete('/api/ezp/apps/:name/data/:scope/:key', async (ctx) => {
        const r = docRoute(ctx);
        if (!r) return;
        const gone = await deleteDoc(r.entry.dataDir, r.scope, r.key!);
        ctx.status = gone ? 200 : 404;
        ctx.body = { ok: gone };
    });

    // -- show inputs -------------------------------------------------------------
    // Buttons and sensors post here (a Falcon or FPP board can call an HTTP URL on a
    // press); the Apps card's mapping table says which instance input each one drives.
    router.post('/api/ezp/inputs/:source/:name', (ctx) => {
        const { source, name } = ctx.params;
        if (!INSTANCE_RE.test(source) || !INSTANCE_RE.test(name)) {
            ctx.status = 400;
            ctx.body = { error: 'source and name: lower-case letters, digits and dashes' };
            return;
        }
        const body = ctx.request.body as { value?: unknown } | undefined;
        const value = body?.value ?? (typeof ctx.query.value === 'string' ? ctx.query.value : undefined);
        ctx.body = { ok: true, delivered: apps.input(source, name, value) };
    });
    // Boards that can only GET.
    router.get('/api/ezp/inputs/:source/:name', (ctx) => {
        const { source, name } = ctx.params;
        if (!INSTANCE_RE.test(source) || !INSTANCE_RE.test(name)) {
            ctx.status = 400;
            ctx.body = { error: 'source and name: lower-case letters, digits and dashes' };
            return;
        }
        ctx.body = { ok: true, delivered: apps.input(source, name, ctx.query.value) };
    });
}

/** Read and parse a JSON body the global parser skipped (wrong content type). */
async function parseJsonBody(ctx: Koa.Context, limit: number): Promise<unknown> {
    try {
        const raw = await getRawBody(ctx.req, { encoding: 'utf8', limit });
        return raw ? JSON.parse(raw) : {};
    } catch {
        ctx.status = 400;
        ctx.body = { error: 'body must be JSON' };
        return undefined;
    }
}

const UNAVAILABLE_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Not available</title><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><h1>Not available right now</h1><p>This part of the show is switched off at the moment. Try again later.</p></div>`;

/**
 * Pages: `/apps/<instance>/…` (visitors) and `/apps/<instance>/config/…` (owner), with
 * `_sdk.js` and `_context.json` answered at any depth under them. A static directory is served
 * from the package; `{proxy: true}` forwards to the instance's own server on its assigned port.
 * Mounted before the body parser so proxied requests stream through untouched.
 */
export function appsPagesMiddleware(apps: AppsRuntime): Koa.Middleware {
    return async (ctx, next) => {
        if (!ctx.path.startsWith('/apps/')) return next();
        if (ctx.path === '/apps/_sdk.js') {
            ctx.type = 'application/javascript; charset=utf-8';
            ctx.set('Cache-Control', 'public, max-age=300');
            ctx.body = APPS_SDK_JS;
            return;
        }
        const m = ctx.path.match(/^\/apps\/([^/]+)(\/.*)?$/);
        if (!m) return next();
        const name = decodeURIComponent(m[1]);
        const entry = apps.entry(name);
        if (!entry) {
            ctx.status = 404;
            ctx.body = 'no such app instance';
            return;
        }
        if (m[2] === undefined) {
            ctx.redirect(`${ctx.path}/${ctx.search}`);
            return;
        }
        let rest = m[2];
        // The SDK and its context sit next to every page, at any depth, so pages load them with a
        // relative path and never need to know whether they are on the LAN or behind the cloud.
        if (rest.endsWith('/_sdk.js')) {
            ctx.type = 'application/javascript; charset=utf-8';
            ctx.set('Cache-Control', 'public, max-age=300');
            ctx.body = APPS_SDK_JS;
            return;
        }
        if (rest.endsWith('/_context.json')) {
            ctx.set('Cache-Control', 'no-store');
            ctx.body = { mode: 'lan', instance: name };
            return;
        }
        const isConfig = rest === '/config' || rest.startsWith('/config/');
        if (rest === '/config') {
            ctx.redirect(`${ctx.path}/${ctx.search}`);
            return;
        }
        const source = isConfig ? entry.config : entry.page;
        if (isConfig) rest = rest.slice('/config'.length);
        if (source === undefined) {
            ctx.status = 404;
            ctx.body = isConfig ? 'this app has no settings page' : 'this app has no page';
            return;
        }
        if (!isConfig && !entry.running) {
            ctx.status = 503;
            ctx.type = 'text/html';
            ctx.body = UNAVAILABLE_HTML;
            return;
        }
        if (typeof source === 'object') {
            await proxyToInstance(ctx, entry, (isConfig ? '/config' : '') + rest);
            return;
        }
        // Static: the directory is inside the package; `send` keeps paths under its root.
        const root = `${entry.appDir}/${source === '.' ? '' : source}`;
        const rel = rest === '/' ? '/index.html' : decodeURIComponent(rest);
        try {
            const sent = await send(ctx, rel, { root, index: 'index.html', hidden: false, maxAge: 0 });
            if (!sent) ctx.status = 404;
        } catch (err) {
            const status = (err as { status?: number }).status;
            ctx.status = status === 403 || status === 404 ? status : 500;
            if (ctx.status === 500) console.error('[apps] page send failed:', err);
        }
    };
}

/** Forward one request to the instance's own HTTP server, buffered both ways. */
function proxyToInstance(ctx: Koa.Context, entry: AppsAuthEntry, pathWithinApp: string): Promise<void> {
    if (!entry.port || !entry.running) {
        ctx.status = 503;
        ctx.body = 'app is not running';
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const headers: Record<string, string | string[]> = {};
        for (const [k, v] of Object.entries(ctx.req.headers)) {
            if (v === undefined) continue;
            const lower = k.toLowerCase();
            if (lower === 'host' || lower === 'connection' || lower === 'transfer-encoding') continue;
            headers[k] = v;
        }
        headers['host'] = `127.0.0.1:${entry.port}`;
        // The app learns where its page is mounted so it can build relative links.
        headers['x-ezp-app-base'] = ctx.path.slice(0, ctx.path.length - pathWithinApp.length);
        const req = httpMod.request(
            {
                hostname: '127.0.0.1',
                port: entry.port,
                method: ctx.method,
                path: pathWithinApp + ctx.search,
                headers,
                timeout: PAGE_PROXY_TIMEOUT_MS,
            },
            (res) => {
                const chunks: Buffer[] = [];
                let size = 0;
                res.on('data', (c: Buffer) => {
                    size += c.length;
                    if (size <= 8 * 1024 * 1024) chunks.push(c);
                });
                res.on('end', () => {
                    if (size > 8 * 1024 * 1024) {
                        ctx.status = 502;
                        ctx.body = 'response too large';
                    } else {
                        ctx.status = res.statusCode ?? 502;
                        for (const [k, v] of Object.entries(res.headers)) {
                            if (v === undefined) continue;
                            const lower = k.toLowerCase();
                            if (lower === 'connection' || lower === 'transfer-encoding' || lower === 'content-length')
                                continue;
                            ctx.set(k, v as string | string[]);
                        }
                        ctx.body = Buffer.concat(chunks);
                    }
                    resolve();
                });
            },
        );
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', (err) => {
            ctx.status = 502;
            ctx.body = `app page unreachable: ${err.message}`;
            resolve();
        });
        if (ctx.method === 'GET' || ctx.method === 'HEAD') {
            req.end();
            return;
        }
        getRawBody(ctx.req, { limit: PAGE_PROXY_MAX_BODY })
            .then((body) => req.end(body))
            .catch(() => {
                req.destroy();
                ctx.status = 413;
                ctx.body = 'request body too large';
                resolve();
            });
    });
}

/** `WS /api/ezp/apps/<instance>/live`: push-only status snapshots. */
export function attachAppsLiveUpgrade(server: httpMod.Server, apps: AppsRuntime): void {
    const wss = new WebSocketServer({ noServer: true });
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
        const pathname = (req.url ?? '').split('?')[0];
        const m = pathname.match(/^\/api\/ezp\/apps\/([^/]+)\/live$/);
        if (!m) return; // leave for the other upgrade handlers
        const name = decodeURIComponent(m[1]);
        if (!apps.entry(name)) {
            socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
            socket.destroy();
            return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
            // Inbound frames are ignored: events go over HTTP so the source is known.
            ws.on('message', () => {});
            apps.addLive(name, ws);
        });
    });
}
