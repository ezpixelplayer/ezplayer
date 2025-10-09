import { Theme, ThemeProvider } from '@mui/material';
import { PureLightTheme } from '@ezplayer/shared-ui-components';
import { NebulaFighterTheme } from '@ezplayer/shared-ui-components';
import { IndexnineTheme } from '@ezplayer/shared-ui-components';
import { ezrgbTheme } from './schemes/EZRGBTheme';

import { ReactNode, createContext, useContext, useState } from 'react';

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

interface ThemeContextProps {
    themeName: string;
    handleThemeChange: (currentTheme: string) => void;
}

export const ThemeContext = createContext<ThemeContextProps | undefined>(undefined);

export const ThemeProviderWrapper = ({ children }: { children: ReactNode }) => {
    const curThemeName = localStorage.getItem('appTheme') || 'EZRGBTheme';
    const [themeName, setThemeName] = useState(curThemeName);
    const theme = themeCreator(themeName);

    const handleThemeChange = (curTheme: string) => {
        localStorage.setItem('appTheme', curTheme);
        setThemeName(curTheme);
    };

    return (
        <ThemeContext.Provider value={{ themeName, handleThemeChange }}>
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
