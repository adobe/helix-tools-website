const DEFAULT_ICON = 'S2_Icon_InfoCircleBlue_20_N';

const TOOL_ICON_PATTERNS = [
  { pattern: /sidekick.*config|update.*config/i, icon: 'S2_Icon_Edit_20_N' },
  { pattern: /audit|history|log/i, icon: 'Smock_DocumentFragment_18_N' },
  { pattern: /publish|preview/i, icon: 'S2_Icon_Publish_20_N' },
];

export default function getToolIcon(toolName) {
  if (!toolName) return DEFAULT_ICON;
  const match = TOOL_ICON_PATTERNS.find(({ pattern }) => pattern.test(toolName));
  return match ? match.icon : DEFAULT_ICON;
}
