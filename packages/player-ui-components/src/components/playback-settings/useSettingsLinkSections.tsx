import LanIcon from '@mui/icons-material/Lan';
import LinkIcon from '@mui/icons-material/Link';
import MemoryIcon from '@mui/icons-material/Memory';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import RouterIcon from '@mui/icons-material/Router';
import SettingsIcon from '@mui/icons-material/Settings';
import WifiIcon from '@mui/icons-material/Wifi';
import React from 'react';
import { useSelector } from 'react-redux';
import type { RootState } from '../../store/Store';
import type { SettingsSection } from './SettingsDrawer';

const SIZE = { fontSize: 56 } as const;

/** Icon vocabulary for --settings-link; the player already maps unknown names to 'link'. */
const ICONS: Record<string, React.ReactNode> = {
    link: <LinkIcon sx={SIZE} />,
    wifi: <WifiIcon sx={SIZE} />,
    router: <RouterIcon sx={SIZE} />,
    lan: <LanIcon sx={SIZE} />,
    settings: <SettingsIcon sx={SIZE} />,
    power: <PowerSettingsNewIcon sx={SIZE} />,
    memory: <MemoryIcon sx={SIZE} />,
};

/** One tile per link the player was launched with; each opens outside the UI.
 *  A path such as /setup only means something to a browser that loaded the UI
 *  from the player, so the desktop app shows absolute URLs only. */
export function useSettingsLinkSections(): SettingsSection[] {
    const links = useSelector((s: RootState) => s.settingsLinks.links);
    const openExternal = typeof window !== 'undefined' ? window.electronAPI?.openExternal : undefined;
    return links
        .filter((link) => !openExternal || !link.url.startsWith('/'))
        .map((link, i) => ({
            key: `settingsLink-${i}`,
            label: link.label,
            icon: ICONS[link.icon] ?? ICONS.link,
            onClick: () => {
                if (openExternal) openExternal(link.url);
                else window.open(link.url, '_blank', 'noopener,noreferrer');
            },
        }));
}
