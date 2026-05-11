/**
 * `useRouteBase` lets a component prepend the current app's route base to
 * absolute paths like `${ROUTES.CREATE_EDIT_PLAYLIST}/-1`. Most consumers
 * (Electron, the LAN browser UI) don't have a route base — the routes live
 * at the URL root — so the default is `''` and the existing
 * `navigate(`${base}${ROUTES.X}`)` pattern is a no-op.
 *
 * The cloud per-player view (ezpui) wraps its subtree in
 * `<RouteBaseProvider value={`/p/${token}`}>`. Inside, the same
 * `navigate(`${base}${ROUTES.X}`)` resolves to `/p/<token>/<route>` so the
 * player_token stays in the URL across in-app navigations.
 *
 * This is just a tiny context — no router hooks, no `useLocation` parsing —
 * because the base is determined by which app you're in, not by the current
 * URL. The provider is set once per app subtree.
 */

import { createContext, useContext, type ReactNode } from 'react';

const RouteBaseContext = createContext<string>('');

export interface RouteBaseProviderProps {
    value: string;
    children: ReactNode;
}

export const RouteBaseProvider = ({ value, children }: RouteBaseProviderProps) => (
    <RouteBaseContext.Provider value={value}>{children}</RouteBaseContext.Provider>
);

/** Returns the URL prefix to prepend to absolute in-app navigation paths.
 *  `''` if no provider is mounted — every existing LAN/Electron path keeps
 *  working unchanged. */
export const useRouteBase = (): string => useContext(RouteBaseContext);
