export const AGENT_ENDPOINT = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? 'http://localhost:8787'
  : 'https://helix-admin-agent.adobe.workers.dev';

export const STORAGE_KEYS = {
  ORG: 'eds-agent-org',
  SITE: 'eds-agent-site',
  TOKEN: 'eds-agent-token',
  THEME: 'eds-agent-theme',
  SIDEBAR_COLLAPSED: 'eds-agent-sidebar-collapsed',
  CHATS_PREFIX: 'eds-agent-chats:',
  ACTIVE_PREFIX: 'eds-agent-active-chat:',
  LEGACY_MESSAGES: 'eds-agent-messages',
};

export const DESKTOP_BREAKPOINT = '(min-width: 900px)';

export const WELCOME_GROUPS = [
  {
    label: 'Sites & config',
    prompts: [
      'List all sites in my organization',
      'Show the sidekick config for my site',
    ],
  },
  {
    label: 'Status & logs',
    prompts: [
      'What happened in the last hour?',
      'Audit log for the last deploy',
    ],
  },
  {
    label: 'Help & docs',
    prompts: [
      'How do I set up a custom domain?',
      'Search EDS docs for redirects',
    ],
  },
];

export const THINKING_WORDS = [
  'Contacting the Edge Delivery Gods',
  'Document Authoring',
  'Renaming Helix',
  'Re-inventing the wheel',
  'Consulting the Oracle',
  'Conducting Research',
  'Planning Adobe Summit',
  'Analyzing the data',
  'Checking the gravitational constant in your locale',
  'Replacing the stars with potatoes',
];

export const DATE_GROUP_LABELS = {
  today: 'Today',
  yesterday: 'Yesterday',
  last7: 'Previous 7 days',
  last30: 'Previous 30 days',
  older: 'Older',
};
