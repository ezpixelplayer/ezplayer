import type { SettingsLink } from '@ezplayer/ezplayer-core';

/** Icons the Settings screen can draw for a link tile; unknown names fall back to 'link'. */
export const SETTINGS_LINK_ICONS = ['link', 'wifi', 'router', 'lan', 'settings', 'power', 'memory'] as const;

const FLAG = '--settings-link=';
const MAX_LABEL = 40;

/** Parse a `--settings-link=<label>|<url>[|<icon>]` value. */
export function parseSettingsLink(value: string): SettingsLink | string {
    const [rawLabel = '', rawUrl = '', rawIcon = ''] = value.split('|');
    const label = rawLabel.trim();
    const url = rawUrl.trim();
    const icon = rawIcon.trim().toLowerCase() || 'link';
    if (!label) return 'label is empty';
    if (label.length > MAX_LABEL) return `label is longer than ${MAX_LABEL} characters`;
    // Relative paths resolve against the page the UI was loaded from.
    if (!/^(\/|https?:\/\/)/i.test(url)) return 'url must start with /, http:// or https://';
    if (/[\s"'<>]/.test(url)) return 'url contains whitespace or quotes';
    return { label, url, icon: (SETTINGS_LINK_ICONS as readonly string[]).includes(icon) ? icon : 'link' };
}

/** Extra link tiles for the Settings screen, in command-line order. Bad entries are skipped with a warning. */
export function parseSettingsLinks(
    argv: readonly string[],
    warn: (msg: string) => void = console.warn,
): SettingsLink[] {
    const links: SettingsLink[] = [];
    for (const arg of argv) {
        if (!arg.startsWith(FLAG)) continue;
        const parsed = parseSettingsLink(arg.slice(FLAG.length));
        if (typeof parsed === 'string') warn(`Ignoring ${arg}: ${parsed}`);
        else links.push(parsed);
    }
    return links;
}

let cached: SettingsLink[] | undefined;

/** Links from this process's command line; fixed for the life of the process. */
export function getSettingsLinks(): SettingsLink[] {
    cached ??= parseSettingsLinks(process.argv);
    return cached;
}
