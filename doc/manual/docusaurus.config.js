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

  url: 'https://ezpixelplayer.github.io',
  baseUrl: '/',

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
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'EZPlayer',
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
        copyright: `Copyright © ${new Date().getFullYear()} EZPlayer. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
      },
    }),
};

export default config;
