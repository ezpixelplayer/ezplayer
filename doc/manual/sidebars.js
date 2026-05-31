// @ts-check
// Explicit manual TOC. Intro at top; Architecture next; Reference (incl. the
// API) deliberately way down.

/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  manualSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Architecture',
      collapsed: false,
      items: ['architecture/overview', 'architecture/developer'],
    },
    {
      type: 'category',
      label: 'Reference',
      collapsed: true,
      items: ['reference/api'],
    },
  ],
};

export default sidebars;
