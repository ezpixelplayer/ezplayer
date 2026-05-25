import { useEffect, useState } from 'react';

/** Cross-app UI preference: "always use orbit controls" instead of letting the
 *  3D viewer auto-pick between freelook (mouse) and orbit (touch). When on,
 *  every `Viewer3D` that opts in gets the trackpad-friendly OrbitControls
 *  variant regardless of input detection.
 *
 *  Stored alongside the existing UI prefs in localStorage `playbackSettings`
 *  so we don't grow yet another storage key. Changes notify in-tab listeners
 *  via a custom event (the native `storage` event only fires for OTHER tabs).
 */
const STORAGE_KEY = 'playbackSettings';
const FIELD = 'preferOrbitControls';
const CHANGE_EVENT = 'ezplayer:orbit-preference-change';

const readPref = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as { [k: string]: unknown };
        return parsed[FIELD] === true;
    } catch {
        return false;
    }
};

const writePref = (next: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        const parsed = (raw ? JSON.parse(raw) : {}) as { [k: string]: unknown };
        parsed[FIELD] = next;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
        window.dispatchEvent(new Event(CHANGE_EVENT));
    } catch {
        // localStorage may be disabled (private mode, kiosk lock-down). Silently
        // no-op — the preference is non-critical, just falls back to detection.
    }
};

/** Read the current preference + subscribe to changes. Returns false until the
 *  user toggles it on in UISettings; default-off preserves prior behavior. */
export const useOrbitPreference = (): boolean => {
    const [value, setValue] = useState<boolean>(() => readPref());
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handler = () => setValue(readPref());
        window.addEventListener(CHANGE_EVENT, handler);
        // Native storage events fire for cross-tab changes only — useful when
        // the user has the app open in two tabs.
        window.addEventListener('storage', handler);
        return () => {
            window.removeEventListener(CHANGE_EVENT, handler);
            window.removeEventListener('storage', handler);
        };
    }, []);
    return value;
};

export const setOrbitPreference = (next: boolean): void => writePref(next);
