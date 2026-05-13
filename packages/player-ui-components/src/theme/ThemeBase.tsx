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

interface ThemeContextProps {
    themeName: string;
    handleThemeChange: (currentTheme: string) => void;
    uiScale: number;
    setUiScale: (s: number) => void;
}

export const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProviderWrapper = ({ children }: { children: ReactNode }) => {
    const curThemeName = localStorage.getItem('appTheme') || 'EZRGBTheme';
    const [themeName, setThemeName] = useState(curThemeName);
    const [uiScale, setUiScaleState] = useState<number>(readSavedScale);
    const theme = themeCreator(themeName);

    const handleThemeChange = (curTheme: string) => {
        localStorage.setItem('appTheme', curTheme);
        setThemeName(curTheme);
    };

    const setUiScale = (s: number) => {
        const next = clampScale(s);
        localStorage.setItem('appUiScale', String(next));
        setUiScaleState(next);
    };

    // Apply the UI scale. In Electron, prefer `webContents.setZoomFactor` because it's
    // native page zoom — canvas/WebGL render correctly under it (CSS `zoom` doesn't
    // play nicely with canvas; the drawing buffer's coordinate system stays at 1×, so
    // the focal point of any 2D/3D preview drifts off-center). In browser surfaces
    // (embedded/cloud) we don't have that API, so fall back to `documentElement.zoom`.
    useEffect(() => {
        const electronSetZoom = (
            window as unknown as { electronAPI?: { setZoomFactor?: (n: number) => Promise<void> } }
        ).electronAPI?.setZoomFactor;
        if (electronSetZoom) {
            void electronSetZoom(uiScale);
            // Make sure the CSS fallback isn't compounding on top of the native zoom.
            (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = '';
        } else {
            (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom =
                uiScale === 1 ? '' : String(uiScale);
        }
    }, [uiScale]);

    return (
        <ThemeContext.Provider value={{ themeName, handleThemeChange, uiScale, setUiScale }}>
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
