/** Prefix to prepend to absolute in-app paths like
 *  `${useRouteBase()}${ROUTES.CREATE_EDIT_PLAYLIST}/-1`. Defaults to `''`
 *  (LAN/Electron); ezpui wraps its subtree with `value="/p/${token}"`. */

import { createContext, useContext, type ReactNode } from 'react';

const RouteBaseContext = createContext<string>('');

export interface RouteBaseProviderProps {
    value: string;
    children: ReactNode;
}

export const RouteBaseProvider = ({ value, children }: RouteBaseProviderProps) => (
    <RouteBaseContext.Provider value={value}>{children}</RouteBaseContext.Provider>
);

export const useRouteBase = (): string => useContext(RouteBaseContext);
