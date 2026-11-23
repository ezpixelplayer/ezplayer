import type { AudioBusConfig, AudioBusOutput, PlaybackSettings } from '../types/DataTypes';

type ListenerSettings = Pick<PlaybackSettings, 'audioBuses' | 'audioListeners'>;

/** The show audio: what the sequence plays and listeners hear. */
export const AUDIO_BUS_MAIN = 'main';
/** Short-lead bus on the show's outputs, for sounds that must play at once. */
export const AUDIO_BUS_IMMEDIATE = 'immediate';

/** Lead of the show audio; set by the playback loop, not by settings. */
const MAIN_LEAD_MS = 700;
const MAIN_CHUNK_MS = 100;
const DEFAULT_LEAD_MS = 40;
const DEFAULT_CHUNK_MS = 20;
const MAX_BUSES = 16;

export interface ResolvedAudioBus {
    name: string;
    leadMs: number;
    chunkMs: number;
    /** 0-100. */
    volume: number;
    /** Empty plays on the show's outputs. */
    outputs: AudioBusOutput[];
    /** False: heard only by subscribers, not on this computer. */
    playLocally: boolean;
    /** Listeners it is sent to. */
    listeners: string[];
    /** Always present; cannot be removed. */
    builtIn: boolean;
}

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : dflt;

/** True for a usable bus or listener name: 1-40 letters, digits, spaces, _ . or -. */
export const isAudioName = (name: unknown): name is string =>
    typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,39}$/.test(name);

/** Check and tidy a bus definition from a client; an error string says what is wrong. */
export function cleanAudioBus(input: unknown): { ok: true; bus: AudioBusConfig } | { ok: false; error: string } {
    const b = (input ?? {}) as Partial<AudioBusConfig>;
    if (!isAudioName(b.name)) {
        return { ok: false, error: 'name must be 1-40 letters, digits, spaces, _ . or -' };
    }
    if (b.name === AUDIO_BUS_MAIN) return { ok: false, error: 'main cannot be changed' };
    for (const key of ['leadMs', 'chunkMs', 'volume'] as const) {
        if (b[key] !== undefined && (typeof b[key] !== 'number' || !Number.isFinite(b[key]))) {
            return { ok: false, error: `${key} must be a number` };
        }
    }
    if (b.outputs !== undefined && !Array.isArray(b.outputs)) return { ok: false, error: 'outputs must be a list' };
    if (b.playLocally !== undefined && typeof b.playLocally !== 'boolean') {
        return { ok: false, error: 'playLocally must be true or false' };
    }
    if (b.listeners !== undefined && !(Array.isArray(b.listeners) && b.listeners.every(isAudioName))) {
        return { ok: false, error: 'listeners must be a list of listener names' };
    }
    const outputs: AudioBusOutput[] = [];
    for (const o of b.outputs ?? []) {
        if (!o || typeof o.deviceId !== 'string' || !o.deviceId) {
            return { ok: false, error: 'each output needs a deviceId' };
        }
        outputs.push({ deviceId: o.deviceId, label: typeof o.label === 'string' ? o.label : '', groupId: o.groupId });
    }
    const bus: AudioBusConfig = { name: b.name };
    if (b.leadMs !== undefined) bus.leadMs = clampInt(b.leadMs, 10, 5000, DEFAULT_LEAD_MS);
    if (b.chunkMs !== undefined) bus.chunkMs = clampInt(b.chunkMs, 5, 200, DEFAULT_CHUNK_MS);
    if (b.volume !== undefined) bus.volume = clampInt(b.volume, 0, 100, 100);
    if (b.outputs !== undefined) bus.outputs = outputs.length ? outputs : undefined;
    if (b.playLocally !== undefined) bus.playLocally = b.playLocally;
    if (b.listeners !== undefined) bus.listeners = b.listeners.length ? [...new Set(b.listeners)] : undefined;
    return { ok: true, bus };
}

/** Every bus the player has: the built-in two, then the ones in settings. */
export function resolveAudioBuses(settings: Pick<PlaybackSettings, 'audioBuses'> | undefined): ResolvedAudioBus[] {
    const resolve = (c: AudioBusConfig, builtIn: boolean): ResolvedAudioBus => ({
        name: c.name,
        leadMs: clampInt(c.leadMs, 10, 5000, DEFAULT_LEAD_MS),
        chunkMs: clampInt(c.chunkMs, 5, 200, DEFAULT_CHUNK_MS),
        volume: clampInt(c.volume, 0, 100, 100),
        outputs: (c.outputs ?? []).filter((o) => !!o?.deviceId),
        playLocally: c.playLocally !== false,
        listeners: (c.listeners ?? []).filter(isAudioName),
        builtIn,
    });
    const configured = (settings?.audioBuses ?? []).filter((c) => c && typeof c.name === 'string');
    const out: ResolvedAudioBus[] = [
        {
            name: AUDIO_BUS_MAIN,
            leadMs: MAIN_LEAD_MS,
            chunkMs: MAIN_CHUNK_MS,
            volume: 100,
            outputs: [],
            playLocally: true,
            listeners: [],
            builtIn: true,
        },
        resolve(configured.find((c) => c.name === AUDIO_BUS_IMMEDIATE) ?? { name: AUDIO_BUS_IMMEDIATE }, true),
    ];
    for (const c of configured) {
        if (out.length >= MAX_BUSES) break;
        if (c.name === AUDIO_BUS_MAIN || out.some((b) => b.name === c.name)) continue;
        out.push(resolve(c, false));
    }
    return out;
}

/** Settings with `bus` added, or merged over the entry of the same name. */
export function upsertAudioBus<S extends Pick<PlaybackSettings, 'audioBuses'>>(settings: S, bus: AudioBusConfig): S {
    const list = settings.audioBuses ?? [];
    const at = list.findIndex((b) => b.name === bus.name);
    const audioBuses = at < 0 ? [...list, bus] : list.map((b, i) => (i === at ? { ...b, ...bus } : b));
    return { ...settings, audioBuses };
}

/** Settings without the named bus; a built-in bus goes back to its defaults. */
export function removeAudioBus<S extends Pick<PlaybackSettings, 'audioBuses'>>(settings: S, name: string): S {
    const audioBuses = (settings.audioBuses ?? []).filter((b) => b.name !== name);
    return { ...settings, audioBuses: audioBuses.length ? audioBuses : undefined };
}

/** Settings with the listener known; unchanged when it already is. */
export function addAudioListener<S extends ListenerSettings>(settings: S, name: string): S {
    const list = settings.audioListeners ?? [];
    if (list.some((l) => l.name === name)) return settings;
    return { ...settings, audioListeners: [...list, { name }] };
}

/** Settings without the listener, and with no bus sent to it. */
export function removeAudioListener<S extends ListenerSettings>(settings: S, name: string): S {
    const audioListeners = (settings.audioListeners ?? []).filter((l) => l.name !== name);
    const audioBuses = settings.audioBuses?.map((b) => {
        if (!b.listeners?.includes(name)) return b;
        const listeners = b.listeners.filter((n) => n !== name);
        return { ...b, listeners: listeners.length ? listeners : undefined };
    });
    return { ...settings, audioBuses, audioListeners: audioListeners.length ? audioListeners : undefined };
}
