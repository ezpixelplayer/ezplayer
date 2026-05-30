import { Theme, ThemeProvider } from '@mui/material';
import { PureLightTheme } from '@ezplayer/shared-ui-components';
import { NebulaFighterTheme } from '@ezplayer/shared-ui-components';
import { IndexnineTheme } from '@ezplayer/shared-ui-components';
import { ezrgbTheme } from './schemes/EZRGBTheme';

import { ReactNode, createContext, useContext, useEffect, useState } from 'react';

const themeMap: { [key: string]: Theme } = {
    PureLightTheme,
    NebulaFighterTheme,
    IndexnineTheme,
    EZRGBTheme: ezrgbTheme,
};

export function themeCreator(theme: string): Theme {
    return themeMap[theme];
}

export const ezrgbThemeOptions = [
    {
        id: 'EZRGBTheme',
        name: 'EZRGBTheme',
    },

    {
        id: 'PureLightTheme',
        name: 'PureLightTheme',
    },

    {
        id: 'NebulaFighterTheme',
        name: 'NebulaFighterTheme',
    },
];

export const UI_SCALE_MIN = 0.75;
export const UI_SCALE_MAX = 1.75;
export const UI_SCALE_DEFAULT = 1.0;

function clampScale(n: number): number {
    if (!Number.isFinite(n)) return UI_SCALE_DEFAULT;
    return Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, n));
}

function readSavedScale(): number {
    const raw = localStorage.getItem('appUiScale');
    if (raw == null) return UI_SCALE_DEFAULT;
    const n = Number(raw);
    return clampScale(n);
}

/** Native page zoom is only available in Electron via `webContents.setZoomFactor`.
 *  In browser SPAs we previously fell back to CSS `zoom` on `<html>`, but that
 *  breaks MUI's positioning math — `getBoundingClientRect()` under CSS `zoom`
 *  doesn't match the rendered coordinate space, so Selects, Tabs indicators,
 *  Popovers, etc. all drift. Cloud users have native browser zoom (Ctrl±)
 *  which works correctly, so we drop the slider entirely in browser. */
export function isElectronPageZoomAvailable(): boolean {
    return Boolean(
        (window as unknown as { electronAPI?: { setZoomFactor?: (n: number) => Promise<void> } }).electronAPI
            ?.setZoomFactor,
    );
}

interface ThemeContextProps {
    themeName: string;
    handleThemeChange: (currentTheme: string) => void;
    uiScale: number;
    setUiScale: (s: number) => void;
    /** True iff `setUiScale` actually does anything — false in browser SPAs
     *  where we no longer apply CSS `zoom`. UI surfaces hide the slider when
     *  this is false. */
    canSetUiScale: boolean;
}

export const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProviderWrapper = ({ children }: { children: ReactNode }) => {
    const curThemeName = localStorage.getItem('appTheme') || 'EZRGBTheme';
    const [themeName, setThemeName] = useState(curThemeName);
    const canSetUiScale = isElectronPageZoomAvailable();
    // Honor the saved value only when we can actually apply it. In browser
    // we ignore the stored scale (might have been set in Electron, or set
    // back when this app applied CSS zoom in browser) and pin to 1.
    const [uiScale, setUiScaleState] = useState<number>(() => (canSetUiScale ? readSavedScale() : UI_SCALE_DEFAULT));
    const theme = themeCreator(themeName);

    const handleThemeChange = (curTheme: string) => {
        localStorage.setItem('appTheme', curTheme);
        setThemeName(curTheme);
    };

    const setUiScale = (s: number) => {
        if (!canSetUiScale) return; // no-op in browser; the slider is hidden there anyway
        const next = clampScale(s);
        localStorage.setItem('appUiScale', String(next));
        setUiScaleState(next);
    };

    // Apply the UI scale. Native `webContents.setZoomFactor` only — canvas/WebGL
    // render correctly under it. The browser fallback used to apply CSS `zoom`
    // to documentElement, but that breaks MUI positioning math (Selects, Tabs
    // indicator, Popovers all drifted under non-1 scale). Cloud users now use
    // browser zoom (Ctrl±) instead.
    useEffect(() => {
        const electronSetZoom = (
            window as unknown as { electronAPI?: { setZoomFactor?: (n: number) => Promise<void> } }
        ).electronAPI?.setZoomFactor;
        if (electronSetZoom) {
            void electronSetZoom(uiScale);
        }
        // Clear any leftover CSS `zoom` that an older build wrote — without this,
        // a user who had set scale > 1 in browser before would still see the
        // broken popper positioning until they cleared localStorage.
        (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = '';
    }, [uiScale]);

    return (
        <ThemeContext.Provider value={{ themeName, handleThemeChange, uiScale, setUiScale, canSetUiScale }}>
            <ThemeProvider theme={theme}>{children}</ThemeProvider>
        </ThemeContext.Provider>
    );
};

export const useThemeContext = () => {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useThemeContext must be used within ThemeProviderWrapper');
    }
    return context;
};
