/**
 * FPP-compat route registration. Mounted on the shared router (same port and
 * paths as a real FPP), translating onto EZPlayer's cached state and the
 * player-command RPC bridge. See doc/manual/docs/reference/fpp-compat.md.
 *
 * Anything FPP-shaped that is NOT registered here deliberately 404s — FPP
 * tools already branch on 404. Never stub a write endpoint with a fake 200.
 */

import type Router from '@koa/router';
import type { RouterContext } from '@koa/router';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import fsp from 'fs/promises';
import * as crypto from 'crypto';
import type { EZPlayerCommand, PlayerPStatusContent, PlaylistRecord, ScheduledPlaylist, SequenceRecord } from '@ezplayer/ezplayer-core';
import { buildFppStatus, buildFppdVersion, buildSystemInfo, type FppIdentity, type FppStatusSources } from './fpp-status.js';
import { fppCommandDescriptors, runFppCommand, type FppCommandDeps } from './fpp-commands.js';

export interface FppApiDeps {
    getShowFolder: () => string | undefined;
    getPStatus: () => PlayerPStatusContent | undefined;
    getSequences: () => SequenceRecord[] | undefined;
    getPlaylists: () => PlaylistRecord[] | undefined;
    getSchedule: () => ScheduledPlaylist[] | undefined;
    sendPlayerCommand: (cmd: EZPlayerCommand) => Promise<void>;
    appVersion: string;
}

// ---------------------------------------------------------------------------
// Identity — uuid persisted per show folder in .ezplayer/fpp-compat.json
// ---------------------------------------------------------------------------

let cachedUuid: { showFolder: string; uuid: string } | undefined;

async function getUuid(showFolder: string | undefined): Promise<string> {
    if (!showFolder) return 'EZP-unconfigured';
    if (cachedUuid?.showFolder === showFolder) return cachedUuid.uuid;
    const file = path.join(showFolder, '.ezplayer', 'fpp-compat.json');
    try {
        const parsed = JSON.parse(await fsp.readFile(file, 'utf8')) as { uuid?: string };
        if (parsed.uuid) {
            cachedUuid = { showFolder, uuid: parsed.uuid };
            return parsed.uuid;
        }
    } catch {}
    const uuid = `EZP-${crypto.randomUUID()}`;
    try {
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(file, JSON.stringify({ uuid }, null, 2));
    } catch (e) {
        console.warn('[fpp-compat] could not persist uuid:', e);
    }
    cachedUuid = { showFolder, uuid };
    return uuid;
}

function localIPv4s(): string[] {
    const out: string[] = [];
    for (const ifaces of Object.values(os.networkInterfaces())) {
        for (const iface of ifaces ?? []) {
            if (iface.family === 'IPv4' && !iface.internal) out.push(iface.address);
        }
    }
    return out;
}

async function identityOf(deps: FppApiDeps): Promise<FppIdentity> {
    return {
        hostName: os.hostname(),
        appVersion: deps.appVersion,
        uuid: await getUuid(deps.getShowFolder()),
        ips: localIPv4s(),
    };
}

function statusSources(deps: FppApiDeps): FppStatusSources {
    return {
        pStatus: deps.getPStatus(),
        sequences: deps.getSequences(),
        playlists: deps.getPlaylists(),
        schedule: deps.getSchedule(),
    };
}

// ---------------------------------------------------------------------------

export function registerFppCompatRoutes(router: Router, deps: FppApiDeps): void {
    const cmdDeps: FppCommandDeps = {
        sendPlayerCommand: deps.sendPlayerCommand,
        getPStatus: deps.getPStatus,
        getPlaylists: deps.getPlaylists,
        getSequences: deps.getSequences,
    };

    // ---- status / identity -------------------------------------------------

    const serveStatus = async (ctx: RouterContext) => {
        ctx.body = buildFppStatus(statusSources(deps), await identityOf(deps), Date.now());
    };
    router.get('/api/system/status', serveStatus);
    router.get('/api/fppd/status', serveStatus);

    router.get('/api/system/info', async (ctx) => {
        ctx.body = buildSystemInfo(await identityOf(deps), { freemem: os.freemem(), totalmem: os.totalmem() });
    });

    router.get('/api/fppd/version', async (ctx) => {
        ctx.body = buildFppdVersion(await identityOf(deps));
    });

    // Some discovery flows probe the plugin list; an empty one is accurate.
    router.get('/api/plugin', (ctx) => {
        ctx.body = [];
    });

    // ---- command API -------------------------------------------------------

    const respondCommand = (ctx: RouterContext, result: { status: number; message: string }) => {
        ctx.status = result.status;
        ctx.type = 'text/plain';
        ctx.body = result.message;
    };

    // GET /api/command/{Name}[/{arg1}/{arg2}...] — name and args are path
    // segments (URL-encoded); regex route because the arg count is open-ended.
    // @koa/router exposes regex capture groups via ctx.captures (params stays
    // empty for regex paths, even with named groups).
    router.get(/^\/api\/command\/(.+)$/, async (ctx) => {
        const rest = ctx.captures?.[0];
        if (!rest) {
            respondCommand(ctx, { status: 400, message: 'command required' });
            return;
        }
        const segments = rest.split('/').map((s) => decodeURIComponent(s));
        const name = segments[0];
        respondCommand(ctx, await runFppCommand(name, segments.slice(1), cmdDeps));
    });

    // POST /api/command  {command, args[]}
    router.post('/api/command', async (ctx) => {
        const body = ctx.request.body as { command?: string; args?: unknown[] } | undefined;
        if (!body?.command) {
            respondCommand(ctx, { status: 400, message: 'command required' });
            return;
        }
        const args = Array.isArray(body.args) ? body.args.map(String) : [];
        respondCommand(ctx, await runFppCommand(body.command, args, cmdDeps));
    });

    // POST /api/command/{Name} with a JSON array body of args
    router.post(/^\/api\/command\/(.+)$/, async (ctx) => {
        const name = decodeURIComponent(ctx.captures?.[0] ?? '');
        const body = ctx.request.body;
        const args = Array.isArray(body) ? body.map(String) : [];
        respondCommand(ctx, await runFppCommand(name, args, cmdDeps));
    });

    router.get('/api/commands', (ctx) => {
        ctx.body = fppCommandDescriptors();
    });

    router.get('/api/commands/:name', (ctx) => {
        const found = fppCommandDescriptors().find((d) => d.name === ctx.params.name);
        if (!found) {
            ctx.status = 404;
            ctx.body = { Status: 'Error', Message: `Unknown command: ${ctx.params.name}` };
            return;
        }
        ctx.body = found;
    });

    // ---- playlist.php convenience GETs -------------------------------------

    const okJson = { Status: 'OK', Message: '' };

    const startPlaylist = async (ctx: RouterContext) => {
        const name = decodeURIComponent(String(ctx.params.name));
        const repeat = String(ctx.params.repeat ?? '0');
        const result = await runFppCommand('Start Playlist', [name, repeat, '0', '0'], cmdDeps);
        ctx.status = result.status;
        ctx.body = result.status === 200 ? okJson : { Status: 'Error', Message: result.message };
    };
    router.get('/api/playlist/:name/start', startPlaylist);
    router.get('/api/playlist/:name/start/:repeat', startPlaylist);
    router.get('/api/playlist/:name/start/:repeat/:scheduleProtected', startPlaylist);

    const simpleCommand = (command: string, args: string[] = []) => async (ctx: RouterContext) => {
        const result = await runFppCommand(command, args, cmdDeps);
        ctx.status = result.status;
        ctx.body = result.status === 200 ? okJson : { Status: 'Error', Message: result.message };
    };
    router.get('/api/playlists/stop', simpleCommand('Stop Now'));
    router.get('/api/playlists/stopgracefully', simpleCommand('Stop Gracefully'));
    router.get('/api/playlists/stopgracefullyafterloop', simpleCommand('Stop Gracefully', ['true']));
    router.get('/api/playlists/pause', simpleCommand('Pause Playlist'));
    router.get('/api/playlists/resume', simpleCommand('Resume Playlist'));

    // ---- volume ------------------------------------------------------------

    router.get('/api/system/volume', (ctx) => {
        ctx.body = { status: 'OK', method: 'EZPlayer', volume: Math.round(deps.getPStatus()?.volume?.level ?? 100) };
    });

    router.post('/api/system/volume', async (ctx) => {
        const v = Number((ctx.request.body as any)?.volume);
        if (!Number.isFinite(v)) {
            ctx.status = 400;
            ctx.body = { status: 'error', error: 'volume required' };
            return;
        }
        await deps.sendPlayerCommand({ command: 'setvolume', volume: Math.max(0, Math.min(100, Math.round(v))) });
        ctx.body = { status: 'OK', volume: Math.max(0, Math.min(100, Math.round(v))) };
    });
}
