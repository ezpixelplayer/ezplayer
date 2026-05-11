/** URL prefix consumers prepend to a player-side API path like `/api/getimage/<id>`
 *  or `/api/show-file?path=…` to reach it through whatever bridge applies.
 *
 *  - Default `''` (LAN browser, Electron renderer): same-origin or detected
 *    Electron port — `${apiBase}/api/getimage/<id>` becomes `/api/getimage/<id>`.
 *  - Cloud SPA wraps its per-player subtree with
 *    `value="/api/enduserspa/proxy/${player_token}"` so the same call shape
 *    routes through the cloud-endpoint's HTTP-over-WS proxy.
 *
 *  `useFrameServerUrl` consults this so Preview3D's `${frameServerUrl}/api/…`
 *  fetches automatically use the cloud prefix when one is provided. */

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
