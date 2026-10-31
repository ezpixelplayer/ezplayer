// @ts-check
// See: https://docusaurus.io/docs/api/docusaurus-config

import { themes as prismThemes } from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
    title: 'EZPlayer',
    tagline: 'Sequence your lights. Run your show.',
    favicon: 'img/favicon.ico',

    future: {
        v4: true,
    },

    url: 'https://docs.ezplayer.dev',
    baseUrl: '/',
    // Emit /path.html so Cloudflare Pages serves /path directly; keeps the
    // served URL, canonical and sitemap entries identical (no 308 hop).
    trailingSlash: false,

    organizationName: 'ezpixelplayer',
    projectName: 'ezplayer',

    onBrokenLinks: 'throw',

    // Serve the shared d2-compiled SVGs (and any other shared assets) straight
    // out of doc/assets, so the manual and the slide decks consume one source.
    // e.g. doc/assets/diagrams/arch-simple.svg -> /diagrams/arch-simple.svg
    staticDirectories: ['static', '../assets'],

    i18n: {
        defaultLocale: 'en',
        locales: ['en'],
    },

    presets: [
        [
            'classic',
            /** @type {import('@docusaurus/preset-classic').Options} */
            ({
                docs: {
                    // The manual IS the site — serve docs at the root, no /docs prefix.
                    routeBasePath: '/',
                    sidebarPath: './sidebars.js',
                    editUrl: 'https://github.com/ezpixelplayer/ezplayer/tree/main/doc/manual/',
                },
                blog: false,
                theme: {
                    customCss: './src/css/custom.css',
                },
                sitemap: {
                    lastmod: 'date',
                    changefreq: 'weekly',
                    priority: 0.5,
                    ignorePatterns: ['/search'],
                },
            }),
        ],
    ],

    themes: [
        [
            '@easyops-cn/docusaurus-search-local',
            {
                hashed: true,
                indexDocs: true,
                // Docs are served at site root (no /docs prefix).
                docsRouteBasePath: '/',
                // Blog is disabled in the classic preset above.
                indexBlog: false,
                language: ['en'],
            },
        ],
    ],

    themeConfig:
        /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
        ({
            image: 'img/ezplayer-logo.png',
            metadata: [
                {
                    name: 'keywords',
                    content: 'EZPlayer, xLights, pixel show player, light show scheduler, FSEQ, E1.31, DDP, xSchedule, FPP',
                },
            ],
            colorMode: {
                respectPrefersColorScheme: true,
            },
            navbar: {
                title: 'EZPlayer',
                logo: {
                    alt: 'EZPlayer logo',
                    src: 'img/ezplayer-logo-128.png',
                },
                items: [
                    {
                        type: 'docSidebar',
                        sidebarId: 'manualSidebar',
                        position: 'left',
                        label: 'Manual',
                    },
                    {
                        href: 'https://github.com/ezpixelplayer/ezplayer',
                        label: 'GitHub',
                        position: 'right',
                    },
                ],
            },
            footer: {
                style: 'dark',
                links: [
                    {
                        title: 'Docs',
                        items: [
                            { label: 'Manual', to: '/' },
                            { label: 'Settings', to: '/settings/overview' },
                            { label: 'API Reference', to: '/reference/api' },
                        ],
                    },
                    {
                        title: 'More',
                        items: [
                            {
                                label: 'GitHub',
                                href: 'https://github.com/ezpixelplayer/ezplayer',
                            },
                        ],
                    },
                ],
                copyright: `Copyright © ${new Date().getFullYear()} EZPlayer. Manual licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license">CC BY-SA 4.0</a>. Built with Docusaurus.`,
            },
            prism: {
                theme: prismThemes.github,
                darkTheme: prismThemes.dracula,
            },
        }),
};

export default config;
