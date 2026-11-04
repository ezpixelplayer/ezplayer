import { describe, expect, it } from 'vitest';
import { parseSettingsLink, parseSettingsLinks } from './settingsLinks';

describe('parseSettingsLink', () => {
    it('accepts label, url and a known icon', () => {
        expect(parseSettingsLink('Pi Setup|/setup|wifi')).toEqual({ label: 'Pi Setup', url: '/setup', icon: 'wifi' });
    });

    it('defaults the icon to link when missing or unknown', () => {
        expect(parseSettingsLink('Router|http://192.168.1.1')).toEqual({
            label: 'Router',
            url: 'http://192.168.1.1',
            icon: 'link',
        });
        expect(parseSettingsLink('Router|https://example.com/|sparkles')).toMatchObject({ icon: 'link' });
    });

    it('trims and lowercases', () => {
        expect(parseSettingsLink('  Pi Setup | /setup | WIFI ')).toEqual({
            label: 'Pi Setup',
            url: '/setup',
            icon: 'wifi',
        });
    });

    it('rejects an empty label, a long label and a bad url', () => {
        expect(parseSettingsLink('|/setup')).toBe('label is empty');
        expect(parseSettingsLink('x'.repeat(41) + '|/setup')).toMatch(/longer/);
        expect(parseSettingsLink('Pi|setup')).toMatch(/must start/);
        expect(parseSettingsLink('Pi|javascript:alert(1)')).toMatch(/must start/);
        expect(parseSettingsLink('Pi|/setup?a="b"')).toMatch(/quotes/);
        expect(parseSettingsLink('Pi')).toMatch(/must start/);
    });
});

describe('parseSettingsLinks', () => {
    it('collects flags in order and skips bad ones with a warning', () => {
        const warnings: string[] = [];
        const links = parseSettingsLinks(
            [
                'EZPlayer',
                'headless',
                '--settings-link=Pi Setup|/setup|wifi',
                '--web-port=3000',
                '--settings-link=|/x',
                '--settings-link=Docs|https://ezplayer.dev/',
            ],
            (m) => warnings.push(m),
        );
        expect(links.map((l) => l.label)).toEqual(['Pi Setup', 'Docs']);
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain('label is empty');
    });

    it('returns nothing when the flag is absent', () => {
        expect(parseSettingsLinks(['EZPlayer', '--local-audio'])).toEqual([]);
    });
});
