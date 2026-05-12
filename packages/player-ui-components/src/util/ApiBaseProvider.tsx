/** URL prefix prepended to player-side API paths. Default `''` (LAN/Electron
 *  same-origin); cloud SPA sets `/api/enduserspa/proxy/<token>`. */

import { createContext, useContext, type ReactNode } from 'react';

const ApiBaseContext = createContext<string>('');

export interface ApiBaseProviderProps {
    value: string;
    children: ReactNode;
}

export const ApiBaseProvider = ({ value, children }: ApiBaseProviderProps) => (
    <ApiBaseContext.Provider value={value}>{children}</ApiBaseContext.Provider>
);

export const useApiBase = (): string => useContext(ApiBaseContext);
