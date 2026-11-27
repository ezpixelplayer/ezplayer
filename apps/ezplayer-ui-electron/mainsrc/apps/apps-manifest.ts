import type { AppManifest, AppPageSource } from '@ezplayer/ezplayer-core';

/** Package ids and instance names are URL path segments and directory names. */
export const APP_NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const MANIFEST_FILE = 'ezapp.json';

const RUNTIMES = new Set(['node', 'python3', 'binary']);

/** A relative directory inside the package: no absolute paths, no `..`, no drive letters. */
function cleanDir(v: unknown, what: string): AppPageSource | undefined {
    if (v === undefined) return undefined;
    if (typeof v === 'object' && v !== null && (v as { proxy?: unknown }).proxy === true) return { proxy: true };
    if (typeof v !== 'string' || v === '') throw new Error(`${what} must be a directory or {"proxy": true}`);
    const s = v.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
    if (s.startsWith('/') || /^[A-Za-z]:/.test(s) || s.split('/').includes('..')) {
        throw new Error(`${what} must be a directory inside the package`);
    }
    return s === '' ? '.' : s;
}

/** Validate a parsed `ezapp.json`. Throws with a message the Apps card can show. */
export function parseManifest(raw: unknown): AppManifest {
    if (typeof raw !== 'object' || raw === null) throw new Error('ezapp.json is not an object');
    const m = raw as Record<string, unknown>;
    if (typeof m.id !== 'string' || !APP_NAME_RE.test(m.id)) {
        throw new Error('id must be lower-case letters, digits and dashes, up to 40 characters');
    }
    if (typeof m.name !== 'string' || m.name.trim() === '') throw new Error('name is required');
    if (typeof m.version !== 'string' || m.version === '') throw new Error('version is required');
    if (typeof m.runtime !== 'string' || !RUNTIMES.has(m.runtime)) {
        throw new Error('runtime must be node, python3 or binary');
    }
    if (!Array.isArray(m.start) || m.start.length === 0 || m.start.some((s) => typeof s !== 'string' || s === '')) {
        throw new Error('start must be a list of arguments');
    }
    const inputs = m.inputs === undefined ? undefined : parseInputs(m.inputs);
    const events = m.events === undefined ? undefined : parseEvents(m.events);
    const platforms =
        m.platforms === undefined
            ? undefined
            : Array.isArray(m.platforms) && m.platforms.every((p) => typeof p === 'string')
              ? (m.platforms as string[])
              : undefined;
    return {
        id: m.id,
        name: m.name.trim().slice(0, 80),
        version: m.version.slice(0, 40),
        description: typeof m.description === 'string' ? m.description.slice(0, 400) : undefined,
        icon: typeof m.icon === 'string' ? m.icon.slice(0, 16) : undefined,
        runtime: m.runtime as AppManifest['runtime'],
        start: m.start as string[],
        page: cleanDir(m.page, 'page'),
        config: cleanDir(m.config, 'config'),
        inputs,
        platforms,
        events,
    };
}

/** Hard ceilings: an app can ask for a lot, not for everything. */
export const EVENTS_PER_MINUTE_MAX = 6000;
export const CLIENT_PER_SECOND_MAX = 60;

function parseEvents(v: unknown): AppManifest['events'] {
    if (typeof v !== 'object' || v === null) throw new Error('events must be an object');
    const e = v as Record<string, unknown>;
    const num = (x: unknown, what: string, max: number) => {
        if (x === undefined) return undefined;
        if (typeof x !== 'number' || !Number.isFinite(x) || x <= 0)
            throw new Error(`events.${what} must be a positive number`);
        return Math.min(max, x);
    };
    return {
        perMinute: num(e.perMinute, 'perMinute', EVENTS_PER_MINUTE_MAX),
        perClientPerSecond: num(e.perClientPerSecond, 'perClientPerSecond', CLIENT_PER_SECOND_MAX),
    };
}

function parseInputs(v: unknown): AppManifest['inputs'] {
    if (!Array.isArray(v)) throw new Error('inputs must be a list');
    return v.map((x) => {
        const i = x as Record<string, unknown>;
        if (typeof i?.name !== 'string' || !APP_NAME_RE.test(i.name)) throw new Error('an input has a bad name');
        if (i.kind !== 'event' && i.kind !== 'value' && i.kind !== 'text' && i.kind !== 'object') {
            throw new Error(`input ${i.name}: kind must be event, value, text or object`);
        }
        return {
            name: i.name,
            kind: i.kind,
            min: typeof i.min === 'number' ? i.min : undefined,
            max: typeof i.max === 'number' ? i.max : undefined,
        };
    });
}

/** False when the manifest names platforms and this is not one of them. */
export function runsHere(m: AppManifest, platform: string = process.platform): boolean {
    return !m.platforms || m.platforms.length === 0 || m.platforms.includes(platform);
}
