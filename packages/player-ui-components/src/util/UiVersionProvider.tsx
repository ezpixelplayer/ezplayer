/** Version of the UI bundle itself, for display alongside the connected
 *  player's version (About box). Unset means the UI ships with the player
 *  (LAN/Electron) and a separate line would be redundant; the cloud SPA sets
 *  its bundle version since it deploys independently of players. */

import { createContext, useContext, type ReactNode } from 'react';

const UiVersionContext = createContext<string | undefined>(undefined);

export interface UiVersionProviderProps {
    value: string;
    children: ReactNode;
}

export const UiVersionProvider = ({ value, children }: UiVersionProviderProps) => (
    <UiVersionContext.Provider value={value}>{children}</UiVersionContext.Provider>
);

export const useUiVersion = (): string | undefined => useContext(UiVersionContext);
