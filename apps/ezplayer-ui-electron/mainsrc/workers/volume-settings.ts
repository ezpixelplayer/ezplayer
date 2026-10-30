/**
 * Volume as a setting, for the API surfaces that read or write it.
 *
 * The playback worker slews the live level toward what the settings say
 * (`volumeTargets.ts`): the default level, or the schedule window in effect.
 * So a volume "set" here is a write of the default, not a live override; a
 * live override would be slewed straight back. Each output has its own
 * default and windows — one "System default" target, or one per named output.
 */

import * as crypto from 'crypto';
import type {
    PlaybackSettings,
    PlayerPStatusContent,
    VolumeControlState,
    VolumeScheduleEntry,
} from '@ezplayer/ezplayer-core';
import { DEFAULT_VOLUME_TARGET_ID, getActiveVolumeSchedule } from '@ezplayer/ezplayer-core';

type ScheduleDays = VolumeScheduleEntry['days'];

export interface VolumeTargetSettings {
    /** `default` for the system default output, else `AudioOutputConfig.id`. */
    id: string;
    label: string;
    deviceId?: string;
    defaultVolume: number;
    schedule: VolumeScheduleEntry[];
    /** The window in effect now; the default applies while this is null. */
    activeWindow: VolumeScheduleEntry | null;
    /** Live (slewed) level from player status, when known. */
    level?: number;
}

export interface VolumeOverview {
    mode: 'default' | 'outputs';
    targets: VolumeTargetSettings[];
}

export type VolumeWriteResult = { ok: true; settings: PlaybackSettings } | { ok: false; status: number; error: string };

const FALLBACK_CONTROL: VolumeControlState = { defaultVolume: 100 };

function clampLevel(level: number): number {
    return Math.max(0, Math.min(100, Math.round(level)));
}

/** The outputs the settings describe, each with its own volume control. */
function controls(
    settings: PlaybackSettings,
): Array<{ id: string; label: string; deviceId?: string; control: VolumeControlState }> {
    if (settings.useDefaultAudioOutput !== false) {
        return [
            {
                id: DEFAULT_VOLUME_TARGET_ID,
                label: 'System default',
                control: settings.volumeControl ?? FALLBACK_CONTROL,
            },
        ];
    }
    return (settings.audioOutputs ?? []).map((o) => ({
        id: o.id,
        label: o.label,
        deviceId: o.deviceId,
        control: o.volumeControl ?? FALLBACK_CONTROL,
    }));
}

export function describeVolume(
    settings: PlaybackSettings,
    pStatus?: PlayerPStatusContent,
    now: Date = new Date(),
): VolumeOverview {
    const mode = settings.useDefaultAudioOutput !== false ? 'default' : 'outputs';
    const liveLevels = new Map<string, number>();
    if (pStatus?.volume) {
        if (mode === 'default') liveLevels.set(DEFAULT_VOLUME_TARGET_ID, pStatus.volume.level);
        for (const o of pStatus.volume.outputs ?? []) liveLevels.set(o.id, o.level);
    }
    return {
        mode,
        targets: controls(settings).map(({ id, label, deviceId, control }) => ({
            id,
            label,
            deviceId,
            defaultVolume: clampLevel(control.defaultVolume ?? 100),
            schedule: control.schedule ?? [],
            activeWindow: getActiveVolumeSchedule(control, now),
            level: liveLevels.get(id),
        })),
    };
}

export function describeWindow(w: VolumeScheduleEntry): string {
    return `${w.startTime}-${w.endTime} at ${w.volumeLevel}%`;
}

/** One line per target whose window is in effect, e.g. `System default: 20:00-22:00 at 40%`. */
export function activeWindowDescriptions(overview: VolumeOverview): string[] {
    return overview.targets.filter((t) => t.activeWindow).map((t) => `${t.label}: ${describeWindow(t.activeWindow!)}`);
}

/** Headline default: the loudest default across outputs (one in default mode). */
export function headlineDefaultVolume(overview: VolumeOverview): number {
    return overview.targets.reduce((m, t) => Math.max(m, t.defaultVolume), 0);
}

function withControl(
    settings: PlaybackSettings,
    targetId: string | undefined,
    update: (control: VolumeControlState) => VolumeControlState,
): VolumeWriteResult {
    if (settings.useDefaultAudioOutput !== false) {
        if (targetId !== undefined && targetId !== DEFAULT_VOLUME_TARGET_ID) {
            return { ok: false, status: 404, error: `Unknown volume target '${targetId}'` };
        }
        return {
            ok: true,
            settings: { ...settings, volumeControl: update(settings.volumeControl ?? FALLBACK_CONTROL) },
        };
    }
    const outputs = settings.audioOutputs ?? [];
    if (targetId !== undefined && !outputs.some((o) => o.id === targetId)) {
        return { ok: false, status: 404, error: `Unknown volume target '${targetId}'` };
    }
    return {
        ok: true,
        settings: {
            ...settings,
            audioOutputs: outputs.map((o) =>
                targetId === undefined || o.id === targetId
                    ? { ...o, volumeControl: update(o.volumeControl ?? FALLBACK_CONTROL) }
                    : o,
            ),
        },
    };
}

/** Set the default level of one target, or of every target when none is named. */
export function setDefaultVolume(settings: PlaybackSettings, level: unknown, targetId?: string): VolumeWriteResult {
    if (typeof level !== 'number' || !Number.isFinite(level)) {
        return { ok: false, status: 400, error: 'volume must be a number 0-100' };
    }
    const v = clampLevel(level);
    return withControl(settings, targetId, (c) => ({ ...c, defaultVolume: v }));
}

const SCHEDULE_DAYS = new Set<ScheduleDays>([
    'all',
    'weekend-fri-sat',
    'weekend-sat-sun',
    'weekday-mon-fri',
    'weekday-sun-thu',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
]);
// HH:MM; HH may run past 24 for a window that crosses midnight.
const TIME_RE = /^\d{1,3}:[0-5]\d$/;

function parseWindow(raw: unknown, index: number): VolumeScheduleEntry | string {
    const at = `schedule[${index}]`;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return `${at} must be an object`;
    const w = raw as Record<string, unknown>;
    if (!SCHEDULE_DAYS.has(w.days as ScheduleDays)) return `${at}.days must be one of ${[...SCHEDULE_DAYS].join(', ')}`;
    if (typeof w.startTime !== 'string' || !TIME_RE.test(w.startTime)) return `${at}.startTime must be HH:MM`;
    if (typeof w.endTime !== 'string' || !TIME_RE.test(w.endTime)) return `${at}.endTime must be HH:MM`;
    if (typeof w.volumeLevel !== 'number' || !Number.isFinite(w.volumeLevel)) {
        return `${at}.volumeLevel must be a number 0-100`;
    }
    if (w.id !== undefined && typeof w.id !== 'string') return `${at}.id must be a string`;
    return {
        id: typeof w.id === 'string' && w.id ? w.id : crypto.randomUUID(),
        days: w.days as ScheduleDays,
        startTime: w.startTime,
        endTime: w.endTime,
        volumeLevel: clampLevel(w.volumeLevel),
    };
}

/** Replace one target's schedule windows with a validated list. */
export function replaceVolumeSchedule(settings: PlaybackSettings, targetId: string, raw: unknown): VolumeWriteResult {
    if (!Array.isArray(raw)) return { ok: false, status: 400, error: 'schedule must be an array of windows' };
    const windows: VolumeScheduleEntry[] = [];
    for (let i = 0; i < raw.length; i++) {
        const parsed = parseWindow(raw[i], i);
        if (typeof parsed === 'string') return { ok: false, status: 400, error: parsed };
        windows.push(parsed);
    }
    return withControl(settings, targetId, (c) => ({ ...c, schedule: windows }));
}
