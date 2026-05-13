import type { ReactNode } from 'react';
import type { RouteObject } from 'react-router';

/**
 * A route entry that can drive both the router and the sidebar from a single source.
 * Apps build a `MenuRoute[]` describing what they actually offer, hand it to
 * `<SidebarLayout menuItems={...} />`, and feed `toRouteChildren(menuRoutes)` into the
 * router's children list. Routes without a `sidebar` entry exist in the router but don't
 * appear in the sidebar (e.g. dynamic-id routes, dialogs, redirects).
 */
export interface MenuRoute {
    /** Router path. */
    path: string;
    /** React element rendered by the router for this path. */
    element: ReactNode;
    /** Optional sidebar entry. Omit to mount the route without a sidebar item. */
    sidebar?: {
        icon: ReactNode;
        label: string;
    };
}

/** Project a `MenuRoute[]` to react-router's `RouteObject[]` shape. */
export function toRouteChildren(menuRoutes: MenuRoute[]): RouteObject[] {
    return menuRoutes.map((r) => ({ path: r.path, element: r.element }));
}
