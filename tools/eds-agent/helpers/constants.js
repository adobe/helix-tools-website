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
};

export const DESKTOP_BREAKPOINT = '(min-width: 900px)';

/**
 * Sentinel value used in chat-storage keys when the user hasn't set an
 * org. Knowledge-only chats live under this bucket; they're separate from
 * any real org's chats.
 */
export const ANONYMOUS_ORG_KEY = '_anonymous';

const WELCOME_GROUPS_AUTHED = [
  {
    label: 'Configure',
    prompts: [
      'Show me the current headers config for my site',
      'How do I set a custom preview hostname?',
      'Add a new user to my site',
    ],
  },
  {
    label: 'Learn',
    prompts: [
      'How do I set up AEM Assets for a DA site?',
      'How do I set up permissions for my site?',
      'How do I configure the CDN for my site?',
    ],
  },
  {
    label: 'Activity',
    prompts: [
      'What changed on my site this week?',
      "Who's been editing my site lately?",
      'Show me the last 24 hours of audit log',
    ],
  },
];

const WELCOME_GROUPS_ANONYMOUS = [
  {
    label: 'About',
    prompts: [
      'What can you help me with?',
      'What do I need to set up to use this for my site?',
    ],
  },
  {
    label: 'Concepts',
    prompts: [
      "What's the difference between DA and doc-based authoring?",
      'How do permissions work in Edge Delivery?',
    ],
  },
  {
    label: 'Setup & migration',
    prompts: [
      'How do I set up AEM Assets for a DA site?',
      'How do I migrate from fstab.yaml to the Configuration Service?',
    ],
  },
];

/**
 * Pick the welcome-screen prompt set based on whether the user has set
 * org context. With context, prompts are site-specific and actionable.
 * Without context, prompts are entirely conceptual / learning-oriented
 * so they all work without auth.
 */
export function getWelcomeGroups({ org } = {}) {
  return org ? WELCOME_GROUPS_AUTHED : WELCOME_GROUPS_ANONYMOUS;
}

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
