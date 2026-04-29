import { THINKING_WORDS } from './constants.js';
import { loadIcon, injectCopyButtons } from './icons.js';
import { renderMarkdown, escapeHtml } from './markdown.js';

let thinkingInterval = null;

export function scrollToBottom() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });
}

export async function showError(message) {
  const existing = document.querySelector('.eds-error-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'eds-error-toast';
  toast.innerHTML = '<span class="eds-error-icon"></span><span></span>';
  toast.querySelector('span:last-child').textContent = message;
  document.body.appendChild(toast);

  loadIcon('S2_Icon_AlertCircle_18_N').then((svg) => {
    const placeholder = toast.querySelector('.eds-error-icon');
    if (placeholder) placeholder.replaceWith(svg);
  });

  setTimeout(() => toast.remove(), 5000);
}

export function hideStatusRow() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
  const el = document.getElementById('eds-status');
  if (el) el.remove();
}

export function showStatusRow(messagesEl) {
  if (document.getElementById('eds-status')) return;
  hideStatusRow();
  const startIdx = Math.floor(Math.random() * THINKING_WORDS.length);
  const el = document.createElement('div');
  el.className = 'eds-status';
  el.id = 'eds-status';
  el.innerHTML = `
    <span class="eds-status-dots"><span></span><span></span><span></span></span>
    <span class="eds-status-text">${THINKING_WORDS[startIdx]}…</span>
  `;
  messagesEl.appendChild(el);
  scrollToBottom();

  let idx = startIdx;
  thinkingInterval = setInterval(() => {
    idx = (idx + 1) % THINKING_WORDS.length;
    const textEl = el.querySelector('.eds-status-text');
    if (textEl) textEl.textContent = `${THINKING_WORDS[idx]}…`;
  }, 1800);
}

export function getMessageText(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }
  return '';
}

export function renderMessageBubble(messagesEl, msg, streaming = false) {
  const welcome = messagesEl.querySelector('.eds-welcome');
  if (welcome) welcome.remove();

  const bubble = document.createElement('div');
  bubble.className = `eds-msg eds-msg-${msg.role}${streaming ? ' eds-msg-streaming' : ''}`;
  bubble.dataset.msgId = msg.id || '';

  const body = document.createElement('div');
  body.className = 'eds-body';

  const textContent = getMessageText(msg);

  if (msg.role === 'assistant') {
    body.innerHTML = renderMarkdown(textContent);
  } else {
    body.textContent = textContent;
  }

  bubble.appendChild(body);
  messagesEl.appendChild(bubble);
  if (msg.role === 'assistant') injectCopyButtons(body);
  scrollToBottom();

  return bubble;
}

export function updateStreamingMessage(messagesEl, text) {
  const streamingMsg = messagesEl.querySelector('.eds-msg-streaming');
  if (streamingMsg) {
    const body = streamingMsg.querySelector('.eds-body');
    body.innerHTML = renderMarkdown(text);
    injectCopyButtons(body);
    scrollToBottom();
  }
}

export function finalizeStreamingMessage(messagesEl) {
  const streamingMsg = messagesEl.querySelector('.eds-msg-streaming');
  if (streamingMsg) {
    streamingMsg.classList.remove('eds-msg-streaming');
  }
}

async function resolveApprovalCard(card, approved) {
  const actionsEl = card.querySelector('.eds-approval-actions');
  const iconName = approved ? 'S2_Icon_Checkmark_20_N' : 'S2_Icon_CloseCircle_20_N';
  const cls = approved ? 'eds-approved' : 'eds-rejected';
  const label = approved ? 'Approved' : 'Rejected';
  const chip = document.createElement('span');
  chip.className = `eds-approval-resolved ${cls}`;
  chip.innerHTML = `<span class="eds-resolved-label">${label}</span>`;
  const icon = await loadIcon(iconName);
  chip.prepend(icon);
  actionsEl.replaceWith(chip);
}

/**
 * Pretty-print a sub-config slug for display. Most slugs are single words
 * (`headers`, `access`, `metadata`); `cdn/prod` is a path-style outlier
 * that we render as "CDN Prod" rather than the title-cased default.
 */
function prettySubConfig(slug) {
  if (typeof slug !== 'string' || !slug) return null;
  if (slug === 'cdn/prod') return 'CDN Prod';
  return slug
    .split(/[/_-]/)
    .filter(Boolean)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(' ');
}

/**
 * Tool name + args → human label for the approval-card header. Polymorphic
 * write tools (notably `update_site_sub_config`) carry the actual surface
 * in their args; the default toolName-based label is too generic for them.
 */
function formatToolLabel(toolName, args) {
  if (toolName === 'update_site_sub_config') {
    const sub = prettySubConfig(args?.subConfig);
    if (sub) return `Update Site ${sub} Config`;
  }
  if (toolName === 'purge_cache') {
    const p = args?.path;
    if (p === '*' || !p) return 'Purge Cache (Site-Wide)';
    return `Purge Cache (${p})`;
  }
  return (toolName || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function renderApprovalCard(messagesEl, approval) {
  const card = document.createElement('div');
  card.className = 'eds-approval';
  card.dataset.approvalId = approval.approvalId;

  const toolLabel = formatToolLabel(approval.toolName, approval.args);

  card.innerHTML = `
    <div class="eds-approval-header">
      <span class="eds-approval-icon"></span>
      <span>Approval required: <strong>${escapeHtml(toolLabel)}</strong></span>
    </div>
    <div class="eds-approval-args">${escapeHtml(JSON.stringify(approval.args, null, 2))}</div>
    <div class="eds-approval-actions">
      <button class="eds-btn eds-btn-positive" data-action="approve">Approve</button>
      <button class="eds-btn eds-btn-negative" data-action="reject">Reject</button>
    </div>
  `;

  loadIcon('S2_Icon_AlertDiamondOrange_20_N').then((svg) => {
    card.querySelector('.eds-approval-icon').replaceWith(svg);
  });

  messagesEl.appendChild(card);
  scrollToBottom();

  return new Promise((resolve) => {
    card.querySelector('[data-action="approve"]').addEventListener('click', () => {
      resolveApprovalCard(card, true);
      resolve(true);
    });
    card.querySelector('[data-action="reject"]').addEventListener('click', () => {
      resolveApprovalCard(card, false);
      resolve(false);
    });
  });
}

export function renderAllMessages(messagesEl, messages) {
  // eslint-disable-next-line no-param-reassign
  messagesEl.innerHTML = '';
  messages.forEach((msg) => {
    if (msg.role === 'user') {
      renderMessageBubble(messagesEl, msg);
    } else if (msg.role === 'assistant' && getMessageText(msg)) {
      renderMessageBubble(messagesEl, msg);
    }
  });
  scrollToBottom();
}
