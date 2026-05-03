import { SidebarMenus } from '@ezplayer/shared-ui-components';
import type { MenuRoute } from '../../../types/menuRoute';

export const SidebarMenu = ({ menuItems }: { menuItems: MenuRoute[] }) => (
    <SidebarMenus
        menuname=""
        option={menuItems
            .filter((r): r is MenuRoute & { sidebar: NonNullable<MenuRoute['sidebar']> } => !!r.sidebar)
            .map((r) => ({
                pathname: r.path,
                subpathname: '',
                icon: r.sidebar.icon as JSX.Element,
                submenuname: r.sidebar.label,
            }))}
    />
);
