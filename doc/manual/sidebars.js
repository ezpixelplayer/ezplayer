// @ts-check
// Explicit manual TOC. The structure here is the single source of truth for
// ordering and labels; per-directory _category_.json files are not required.

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  manualSidebar: [
    {
      type: 'category',
      label: 'Introduction',
      collapsed: false,
      items: ['introduction/what-is-ezplayer'],
    },
    {
      type: 'category',
      label: 'The Basics',
      collapsed: false,
      items: [
        'basics/getting-started-local',
        'basics/getting-started-cloud',
        'basics/songs',
        'basics/jukebox',
        'basics/playlists',
        'basics/simple-schedules',
        'basics/local-web-interface',
        'basics/player-screen',
        'basics/preview',
      ],
    },
    {
      type: 'category',
      label: 'Using The Cloud',
      collapsed: true,
      items: [
        'cloud/registering',
        'cloud/status-control-ui',
        'cloud/getting-sequences',
        'cloud/full-cloud-control',
      ],
    },
    {
      type: 'category',
      label: 'Advanced Features',
      collapsed: true,
      items: [
        {
          type: 'category',
          label: 'Complex Schedules',
          link: { type: 'doc', id: 'advanced/complex-schedules/overview' },
          items: [
            'advanced/complex-schedules/background-schedule',
            'advanced/complex-schedules/simulating-your-schedule',
          ],
        },
        'advanced/volume',
        'advanced/viewer-control',
        {
          type: 'category',
          label: 'Show Status',
          items: [
            'advanced/show-status/details',
            'advanced/show-status/controllers',
            'advanced/show-status/statistics',
          ],
        },
      ],
    },
    {
      type: 'category',
      label: 'Additional Settings',
      collapsed: true,
      link: { type: 'doc', id: 'settings/overview' },
      items: [
        'settings/show-folder',
        'settings/ui',
        'settings/audio',
        'settings/jukebox',
        'settings/cloud',
      ],
    },
    {
      type: 'category',
      label: 'Programmer Reference',
      collapsed: true,
      items: [
        'reference/architecture',
        'reference/files',
        'reference/cli',
        'reference/api',
      ],
    },
  ],
};

export default sidebars;
