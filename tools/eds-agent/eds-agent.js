import { registerToolReady } from '../../scripts/scripts.js';
import getToolIcon from './helpers/tool-icon.js';
import {
  loadChats,
  saveChats,
  createChat,
  deleteChat,
  getActiveChatId,
  setActiveChatId,
  migrateLegacyMessages,
  groupChatsByDate,
} from './helpers/chats.js';
import {
  AGENT_ENDPOINT,
  STORAGE_KEYS,
  DESKTOP_BREAKPOINT,
  WELCOME_GROUPS,
  THINKING_WORDS,
  DATE_GROUP_LABELS,
} from './helpers/constants.js';
import { escapeHtml, renderMarkdown } from './helpers/markdown.js';

const iconCache = new Map();

/**
 * Loads a Spectrum SVG icon from /icons/<name>.svg as an inline SVG element.
 * Caches the parsed SVG (concurrent loads share one fetch).
 * Returns a clone, so callers can freely append to the DOM.
 */
async function loadIcon(name) {
  if (!iconCache.has(name)) {
    const promise = fetch(`/icons/${name}.svg`)
      .then((r) => {
        if (!r.ok) throw new Error(`icon ${name} not found`);
        return r.text();
      })
      .then((txt) => {
        const tmpl = document.createElement('template');
        tmpl.innerHTML = txt.trim();
        return tmpl.content.firstElementChild;
      });
    iconCache.set(name, promise);
  }
  const svg = await iconCache.get(name);
  return svg.cloneNode(true);
}

async function injectCopyButtons(root) {
  const pres = root.querySelectorAll('pre');
  if (!pres.length) return;
  const copyIcon = await loadIcon('S2_Icon_Copy_20_N');
  const checkIcon = await loadIcon('S2_Icon_Checkmark_20_N');
  pres.forEach((pre) => {
    if (pre.querySelector('.eds-copy-btn')) return;
    const btn = document.createElement('button');
    btn.className = 'eds-copy-btn';
    btn.title = 'Copy';
    btn.setAttribute('aria-label', 'Copy');
    btn.dataset.copyIdle = copyIcon.outerHTML;
    btn.dataset.copyDone = checkIcon.outerHTML;
    btn.innerHTML = btn.dataset.copyIdle;
    pre.appendChild(btn);
  });
}

function attachCopyDelegation(messagesEl) {
  messagesEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('.eds-copy-btn');
    if (!btn) return;
    const pre = btn.closest('pre');
    const code = pre?.querySelector('code')?.textContent ?? pre?.textContent ?? '';
    try {
      await navigator.clipboard.writeText(code);
      btn.innerHTML = btn.dataset.copyDone;
      setTimeout(() => { btn.innerHTML = btn.dataset.copyIdle; }, 1200);
    } catch {
      /* clipboard unavailable; ignore */
    }
  });
}

let messages = [];
let isStreaming = false;
let currentAbortController = null;
let authToken = localStorage.getItem(STORAGE_KEYS.TOKEN) || '';
let thinkingInterval = null;
let activeChatId = null;
let sidebarDismissAttached = false;

const sendBtnState = {
  el: null,
  sendIconHTML: '',
  stopIconHTML: '<span class="eds-stop" aria-hidden="true"></span>',
};

function setSendButtonMode(mode) {
  const btn = sendBtnState.el;
  if (!btn) return;
  if (mode === 'stop') {
    btn.innerHTML = sendBtnState.stopIconHTML;
    btn.setAttribute('aria-label', 'Stop generating');
    btn.title = 'Stop';
  } else {
    btn.innerHTML = sendBtnState.sendIconHTML;
    btn.setAttribute('aria-label', 'Send message');
    btn.title = 'Send';
  }
}

function getConfig() {
  return {
    authToken,
    org: localStorage.getItem(STORAGE_KEYS.ORG) || '',
    site: localStorage.getItem(STORAGE_KEYS.SITE) || '',
  };
}

function saveConfig(token, org, site) {
  authToken = token;
  localStorage.setItem(STORAGE_KEYS.TOKEN, token);
  localStorage.setItem(STORAGE_KEYS.ORG, org);
  localStorage.setItem(STORAGE_KEYS.SITE, site);
}

function getStoredTheme() {
  const v = localStorage.getItem(STORAGE_KEYS.THEME);
  return (v === 'light' || v === 'dark') ? v : null;
}

function effectiveTheme() {
  return getStoredTheme()
    ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') {
    root.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEYS.THEME, theme);
  } else {
    root.removeAttribute('data-theme');
    localStorage.removeItem(STORAGE_KEYS.THEME);
  }
}

function themeTitle(theme) {
  return `Theme: ${theme} (click to switch)`;
}

function isDesktopViewport() {
  return window.matchMedia(DESKTOP_BREAKPOINT).matches;
}

function getSidebarCollapsed() {
  return localStorage.getItem(STORAGE_KEYS.SIDEBAR_COLLAPSED) === '1';
}

function setSidebarCollapsed(collapsed) {
  if (collapsed) {
    localStorage.setItem(STORAGE_KEYS.SIDEBAR_COLLAPSED, '1');
    document.body.classList.add('eds-sidebar-collapsed');
  } else {
    localStorage.removeItem(STORAGE_KEYS.SIDEBAR_COLLAPSED);
    document.body.classList.remove('eds-sidebar-collapsed');
  }
}

// --- Helper functions ---

function scrollToBottom() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
  });
}

async function showError(message) {
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

function hideStatusRow() {
  if (thinkingInterval) {
    clearInterval(thinkingInterval);
    thinkingInterval = null;
  }
  const el = document.getElementById('eds-status');
  if (el) el.remove();
}

function showStatusRow(messagesEl) {
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

function getMessageText(msg) {
  if (typeof msg.content === 'string') return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((p) => p.type === 'text')
      .map((p) => p.text)
      .join('');
  }
  return '';
}

function getActiveChat(org) {
  if (!activeChatId) return null;
  const chats = loadChats(org);
  return chats.find((c) => c.id === activeChatId) ?? null;
}

function persistMessages(org) {
  if (!org || !activeChatId) return;
  const chats = loadChats(org);
  const chat = chats.find((c) => c.id === activeChatId);
  if (!chat) return;
  chat.messages = messages.slice();
  chat.updatedAt = Date.now();
  saveChats(org, chats);
}

// --- Message rendering ---

function renderMessageBubble(messagesEl, msg, streaming = false) {
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

function updateStreamingMessage(messagesEl, text) {
  const streamingMsg = messagesEl.querySelector('.eds-msg-streaming');
  if (streamingMsg) {
    const body = streamingMsg.querySelector('.eds-body');
    body.innerHTML = renderMarkdown(text);
    injectCopyButtons(body);
    scrollToBottom();
  }
}

function finalizeStreamingMessage(messagesEl) {
  const streamingMsg = messagesEl.querySelector('.eds-msg-streaming');
  if (streamingMsg) {
    streamingMsg.classList.remove('eds-msg-streaming');
  }
}

async function resolveApprovalCard(card, approved) {
  const actionsEl = card.querySelector('.eds-approval-actions');
  const iconName = approved ? 'S2_Icon_CheckmarkCircleGreen_20_N' : 'S2_Icon_CloseCircle_20_N';
  const cls = approved ? 'eds-approved' : 'eds-rejected';
  const label = approved ? 'Approved' : 'Rejected';
  const chip = document.createElement('span');
  chip.className = `eds-approval-resolved ${cls}`;
  chip.innerHTML = `<span class="eds-resolved-label">${label}</span>`;
  const icon = await loadIcon(iconName);
  chip.prepend(icon);
  actionsEl.replaceWith(chip);
}

function renderApprovalCard(messagesEl, approval) {
  const card = document.createElement('div');
  card.className = 'eds-approval';
  card.dataset.approvalId = approval.approvalId;

  const toolLabel = (approval.toolName || 'unknown')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());

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

function renderToolCallCard(messagesEl, { toolCallId, toolName, input }) {
  const card = document.createElement('details');
  card.className = 'eds-toolcall';
  card.dataset.toolCallId = toolCallId;
  card.innerHTML = `
    <summary>
      <span class="eds-toolcall-icon"></span>
      <span class="eds-toolcall-name">${escapeHtml(toolName || 'tool')}</span>
      <span class="eds-toolcall-status">running…</span>
    </summary>
    <div class="eds-toolcall-body">${escapeHtml(JSON.stringify({ input }, null, 2))}</div>
  `;
  loadIcon(getToolIcon(toolName)).then((svg) => {
    card.querySelector('.eds-toolcall-icon').replaceWith(svg);
  });
  messagesEl.appendChild(card);
  scrollToBottom();
  return card;
}

function updateToolCallCard(messagesEl, { toolCallId, output }) {
  const card = messagesEl.querySelector(`.eds-toolcall[data-tool-call-id="${CSS.escape(toolCallId)}"]`);
  if (!card) return;
  card.querySelector('.eds-toolcall-status').textContent = 'done';
  const body = card.querySelector('.eds-toolcall-body');
  body.textContent = typeof output === 'string'
    ? output
    : JSON.stringify(output, null, 2);
}

function renderAllMessages(messagesEl) {
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

// --- SSE Stream parsing ---

/*
 * Parses a single SSE line from the worker (AI SDK v5 UIMessageStream format).
 *
 * Event lines look like:  `data: {"type":"text-delta","delta":"..."}`
 *
 * Side effects: updates `state` (accumulated text, tool-call lookup, pending
 * approvals, error flags) and pushes committed messages into the global
 * `messages` history so the next re-POST (after approval) includes the
 * tool-call and tool-approval-request parts the server needs to resume.
 */
function parseSSELine(line, state, messagesEl) {
  if (!line.startsWith('data: ')) return;
  const raw = line.slice(6).trim();
  if (!raw || raw === '[DONE]') return;

  let part;
  try { part = JSON.parse(raw); } catch { return; }

  switch (part.type) {
    case 'text-start':
      hideStatusRow();
      state.accumulatedText = '';
      if (!messagesEl.querySelector('.eds-msg-streaming')) {
        renderMessageBubble(messagesEl, { role: 'assistant', content: '' }, true);
      }
      break;

    case 'text-delta':
      state.accumulatedText += part.delta ?? part.textDelta ?? part.text ?? '';
      updateStreamingMessage(messagesEl, state.accumulatedText);
      break;

    case 'text-end':
      if (state.accumulatedText) {
        messages.push({ role: 'assistant', content: state.accumulatedText });
      }
      state.accumulatedText = '';
      finalizeStreamingMessage(messagesEl);
      break;

    case 'tool-call':
    case 'tool-input-available': {
      hideStatusRow();
      const { toolCallId, toolName } = part;
      const input = part.input ?? part.args ?? {};
      state.toolCallsById[toolCallId] = { toolName, input };
      renderToolCallCard(messagesEl, { toolCallId, toolName, input });
      messages.push({
        role: 'assistant',
        content: [{
          type: 'tool-call', toolCallId, toolName, input,
        }],
      });
      break;
    }

    case 'tool-approval-request': {
      const { approvalId, toolCallId } = part;
      for (let i = messages.length - 1; i >= 0; i -= 1) {
        const m = messages[i];
        if (m.role === 'assistant' && Array.isArray(m.content)
            && m.content.some((p) => p.type === 'tool-call' && p.toolCallId === toolCallId)) {
          m.content.push({ type: 'tool-approval-request', approvalId, toolCallId });
          break;
        }
      }
      const meta = state.toolCallsById[toolCallId] || {};
      state.pendingApprovals.push({
        approvalId,
        toolCallId,
        toolName: meta.toolName || part.toolName || 'unknown',
        args: meta.input || {},
      });
      break;
    }

    case 'tool-result':
    case 'tool-output-available': {
      const { toolCallId } = part;
      const output = part.output ?? part.result;
      const toolName = part.toolName ?? state.toolCallsById[toolCallId]?.toolName;
      updateToolCallCard(messagesEl, { toolCallId, output });
      messages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId,
          toolName,
          output: typeof output === 'string'
            ? { type: 'text', value: output }
            : { type: 'json', value: output },
        }],
      });
      break;
    }

    case 'finish':
    case 'finish-message':
      if (state.accumulatedText) {
        messages.push({ role: 'assistant', content: state.accumulatedText });
        state.accumulatedText = '';
      }
      finalizeStreamingMessage(messagesEl);
      break;

    case 'error':
      state.hasError = true;
      state.errorText = part.errorText ?? part.error ?? '';
      break;

    default:
      break;
  }
}

async function readStream(reader, decoder, messagesEl) {
  const state = {
    accumulatedText: '',
    toolCallsById: {},
    pendingApprovals: [],
    hasError: false,
    errorText: '',
  };
  let buffer = '';
  let reading = true;

  while (reading) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
    } else {
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      lines.forEach((line) => parseSSELine(line, state, messagesEl));
    }
  }

  if (state.hasError) {
    showError(state.errorText ? `Agent error: ${state.errorText}` : 'Agent encountered an error');
  }

  return state;
}

async function streamChat(messagesEl, config) {
  currentAbortController = new AbortController();
  showStatusRow(messagesEl);

  const payload = {
    messages: messages.filter(
      (m) => m.role === 'user' || m.role === 'assistant' || m.role === 'tool',
    ),
    authToken: config.authToken,
    context: {
      ...(config.org ? { org: config.org } : {}),
      ...(config.site ? { site: config.site } : {}),
    },
  };

  const response = await fetch(`${AGENT_ENDPOINT}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: currentAbortController.signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      openSetupModal({ mode: 'required', errorText: 'Authentication failed — please re-enter your API key.' }); // eslint-disable-line no-use-before-define
      return;
    }
    const errText = await response.text().catch(() => '');
    throw new Error(`Agent returned ${response.status}: ${errText || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = await readStream(reader, decoder, messagesEl);

  const actionable = state.pendingApprovals.filter((a) => a.approvalId);
  // eslint-disable-next-line no-restricted-syntax
  for (const approval of actionable) {
    finalizeStreamingMessage(messagesEl);
    // eslint-disable-next-line no-await-in-loop
    const approved = await renderApprovalCard(messagesEl, approval);
    messages.push({
      role: 'tool',
      content: [{
        type: 'tool-approval-response',
        approvalId: approval.approvalId,
        toolCallId: approval.toolCallId,
        approved,
      }],
    });
  }

  if (actionable.length > 0) {
    await streamChat(messagesEl, config);
  }
}

async function sendMessage(textarea, messagesEl) {
  const text = textarea.value.trim();
  if (!text) return;

  const config = getConfig();
  if (!config.authToken) {
    showError('No API key configured. Go to Settings.');
    return;
  }

  textarea.value = '';
  textarea.style.height = 'auto';
  isStreaming = true;
  setSendButtonMode('stop');

  const userMsg = { role: 'user', content: text };

  if (!activeChatId) {
    const newChat = createChat(config.org, text, config.site);
    activeChatId = newChat.id;
    setActiveChatId(config.org, newChat.id);
    const sidebarEl = document.querySelector('.eds-agent-sidebar');
    if (sidebarEl) {
      // eslint-disable-next-line no-use-before-define
      renderSidebar(sidebarEl, buildSidebarCallbacks(document.getElementById('agent-app')));
    }
  }

  const sendChatId = activeChatId;

  messages.push(userMsg);
  renderMessageBubble(messagesEl, userMsg);

  try {
    await streamChat(messagesEl, config);
  } catch (err) {
    if (err.name !== 'AbortError') {
      showError(err.message || 'Failed to connect to agent');
    }
  } finally {
    hideStatusRow();
    finalizeStreamingMessage(messagesEl);
    isStreaming = false;
    setSendButtonMode('send');
    textarea.focus();
    if (activeChatId === sendChatId) persistMessages(config.org);
  }
}

// --- UI Rendering ---

function renderWelcome(messagesEl, textarea) {
  const welcome = document.createElement('div');
  welcome.className = 'eds-welcome';
  welcome.innerHTML = `
    <h2>How can I help?</h2>
    <p>I can manage your AEM EDS configurations, check page status, query audit logs, search documentation, and more.</p>
    <div class="eds-welcome-groups">
      ${WELCOME_GROUPS.map((g) => `
        <div class="eds-welcome-group">
          <div class="eds-welcome-label">${escapeHtml(g.label)}</div>
          ${g.prompts.map((p) => `<button class="eds-suggestion-chip">${escapeHtml(p)}</button>`).join('')}
        </div>
      `).join('')}
    </div>
  `;
  messagesEl.appendChild(welcome);

  welcome.querySelectorAll('.eds-suggestion-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      textarea.value = chip.textContent;
      textarea.dispatchEvent(new Event('input'));
      sendMessage(textarea, messagesEl);
    });
  });
}

function renderChatRow(chat, isActive, callbacks) {
  const row = document.createElement('div');
  row.className = `eds-chat-row${isActive ? ' eds-chat-row-active' : ''}`;
  row.dataset.chatId = chat.id;
  row.innerHTML = `
    <button class="eds-chat-row-title" type="button" title="${escapeHtml(chat.title)}">${escapeHtml(chat.title || '(untitled)')}</button>
    <button class="eds-chat-row-delete" type="button" aria-label="Delete chat"></button>
    <span class="eds-chat-row-confirm" hidden>
      <button class="eds-chat-row-confirm-yes" type="button">Delete?</button>
      <button class="eds-chat-row-confirm-no" type="button" aria-label="Cancel">×</button>
    </span>
  `;
  loadIcon('trash').then((svg) => {
    const btn = row.querySelector('.eds-chat-row-delete');
    if (btn) btn.appendChild(svg);
  });
  row.querySelector('.eds-chat-row-title').addEventListener('click', () => callbacks.onSwitchChat(chat.id));
  const deleteBtn = row.querySelector('.eds-chat-row-delete');
  const confirmEl = row.querySelector('.eds-chat-row-confirm');
  const yesBtn = row.querySelector('.eds-chat-row-confirm-yes');
  const noBtn = row.querySelector('.eds-chat-row-confirm-no');
  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteBtn.hidden = true;
    confirmEl.hidden = false;
  });
  noBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteBtn.hidden = false;
    confirmEl.hidden = true;
  });
  yesBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    callbacks.onDeleteChat(chat.id);
  });
  return row;
}

function renderSidebar(container, callbacks) {
  const config = getConfig();
  const chats = config.org ? loadChats(config.org) : [];
  const groups = groupChatsByDate(chats);

  container.innerHTML = '';
  container.className = 'eds-agent-sidebar';

  const top = document.createElement('div');
  top.className = 'eds-sidebar-top';
  const newBtn = document.createElement('button');
  newBtn.className = 'eds-btn eds-btn-accent eds-sidebar-new-chat';
  newBtn.type = 'button';
  newBtn.textContent = '+ New chat';
  newBtn.addEventListener('click', () => callbacks.onNewChat());
  top.appendChild(newBtn);
  container.appendChild(top);

  const list = document.createElement('div');
  list.className = 'eds-sidebar-list';

  let totalRendered = 0;
  Object.entries(DATE_GROUP_LABELS).forEach(([key, label]) => {
    const bucket = groups[key];
    if (!bucket.length) return;
    const heading = document.createElement('div');
    heading.className = 'eds-date-group-label';
    heading.textContent = label;
    list.appendChild(heading);
    bucket.forEach((chat) => {
      list.appendChild(renderChatRow(chat, activeChatId === chat.id, callbacks));
      totalRendered += 1;
    });
  });

  if (!totalRendered) {
    const empty = document.createElement('div');
    empty.className = 'eds-sidebar-empty';
    empty.textContent = 'No chats yet';
    list.appendChild(empty);
  }

  container.appendChild(list);

  const footer = document.createElement('button');
  footer.className = 'eds-sidebar-footer';
  footer.type = 'button';
  footer.setAttribute('aria-label', 'Open settings');
  if (config.org) {
    footer.innerHTML = `
      <div class="eds-sidebar-footer-text">
        <div class="eds-sidebar-org">${escapeHtml(config.org)}</div>
        ${config.site ? `<div class="eds-sidebar-site">${escapeHtml(config.site)}</div>` : ''}
      </div>
      <span class="eds-sidebar-footer-icon" aria-hidden="true"></span>
    `;
  } else {
    footer.innerHTML = `
      <div class="eds-sidebar-footer-text">
        <div class="eds-sidebar-org eds-sidebar-org-empty">Not connected</div>
      </div>
      <span class="eds-sidebar-footer-icon" aria-hidden="true"></span>
    `;
  }
  loadIcon('S2_Icon_Settings_20_N').then((svg) => {
    const slot = footer.querySelector('.eds-sidebar-footer-icon');
    if (slot) slot.replaceWith(svg);
  });
  footer.addEventListener('click', () => callbacks.onOpenSettings());

  const collapseBtn = document.createElement('button');
  collapseBtn.className = 'eds-sidebar-collapse';
  collapseBtn.type = 'button';
  collapseBtn.title = 'Collapse sidebar';
  collapseBtn.setAttribute('aria-label', 'Collapse sidebar');
  loadIcon('Smock_ChevronLeft_18_N').then((svg) => collapseBtn.appendChild(svg));
  collapseBtn.addEventListener('click', () => setSidebarCollapsed(true));

  const footerRow = document.createElement('div');
  footerRow.className = 'eds-sidebar-footer-row';
  footerRow.append(footer, collapseBtn);
  container.appendChild(footerRow);
}

function closeModal() {
  const backdrop = document.querySelector('.eds-modal-backdrop');
  if (backdrop) backdrop.remove();
}

async function openSetupModal({ mode = 'required', errorText = '' } = {}) {
  closeModal();
  const config = getConfig();

  const backdrop = document.createElement('div');
  backdrop.className = 'eds-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'eds-modal';
  modal.innerHTML = `
    <h2>EDS Admin Agent</h2>
    <p>Connect to your AEM Edge Delivery Services organization using an Admin API key.</p>
    ${errorText ? `<div class="eds-modal-error">${escapeHtml(errorText)}</div>` : ''}
    <div class="eds-modal-field">
      <label for="setup-token">Admin API Key</label>
      <input type="password" id="setup-token" placeholder="Enter your API key" value="${escapeHtml(config.authToken)}" />
    </div>
    <div class="eds-modal-field">
      <label for="setup-org">Organization</label>
      <input type="text" id="setup-org" placeholder="e.g. adobe" value="${escapeHtml(config.org)}" />
    </div>
    <div class="eds-modal-field">
      <label for="setup-site">Site (optional)</label>
      <input type="text" id="setup-site" placeholder="e.g. my-site" value="${escapeHtml(config.site)}" />
    </div>
    <div class="eds-modal-actions">
      <button class="eds-btn eds-btn-accent" id="setup-connect">Connect</button>
    </div>
  `;

  if (mode === 'optional') {
    const closeBtn = document.createElement('button');
    closeBtn.className = 'eds-modal-close';
    closeBtn.setAttribute('aria-label', 'Close');
    modal.appendChild(closeBtn);
    loadIcon('S2_Icon_Close_20_N').then((svg) => closeBtn.appendChild(svg));
    closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) closeModal();
    });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') {
        closeModal();
        document.removeEventListener('keydown', escHandler);
      }
    });
  }

  backdrop.appendChild(modal);
  document.body.appendChild(backdrop);

  const tokenInput = modal.querySelector('#setup-token');
  const orgInput = modal.querySelector('#setup-org');
  const siteInput = modal.querySelector('#setup-site');
  const connectBtn = modal.querySelector('#setup-connect');

  const submit = () => {
    const token = tokenInput.value.trim();
    const org = orgInput.value.trim();
    const site = siteInput.value.trim();
    if (!token) { tokenInput.focus(); return; }
    if (!org) { orgInput.focus(); return; }
    saveConfig(token, org, site);
    closeModal();
    const appContainer = document.getElementById('agent-app');
    renderChat(appContainer); // eslint-disable-line no-use-before-define
  };

  connectBtn.addEventListener('click', submit);
  [tokenInput, orgInput, siteInput].forEach((input) => {
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  });

  tokenInput.focus();
}

function cancelStreamIfActive() {
  if (isStreaming && currentAbortController) currentAbortController.abort();
}

function buildSidebarCallbacks(container) {
  return {
    onNewChat: () => {
      cancelStreamIfActive();
      const cfg = getConfig();
      if (cfg.org) setActiveChatId(cfg.org, null);
      activeChatId = null;
      document.body.classList.remove('eds-sidebar-open');
      renderChat(container); // eslint-disable-line no-use-before-define
    },
    onSwitchChat: (id) => {
      cancelStreamIfActive();
      const cfg = getConfig();
      activeChatId = id;
      if (cfg.org) setActiveChatId(cfg.org, id);
      document.body.classList.remove('eds-sidebar-open');
      renderChat(container); // eslint-disable-line no-use-before-define
    },
    onDeleteChat: (id) => {
      cancelStreamIfActive();
      const cfg = getConfig();
      if (!cfg.org) return;
      const result = deleteChat(cfg.org, id);
      if (activeChatId === id) {
        activeChatId = result.nextActiveId;
        setActiveChatId(cfg.org, result.nextActiveId);
      }
      renderChat(container); // eslint-disable-line no-use-before-define
    },
    onOpenSettings: () => openSetupModal({ mode: 'optional' }),
  };
}

function renderChat(container) {
  const config = getConfig();
  container.innerHTML = '';

  const app = document.createElement('div');
  app.className = 'eds-agent-app';

  const sidebar = document.createElement('aside');
  app.appendChild(sidebar);

  const main = document.createElement('div');
  main.className = 'eds-agent-main';
  app.appendChild(main);

  // Header
  const header = document.createElement('header');
  header.className = 'eds-agent-header';

  const actions = document.createElement('div');
  actions.className = 'eds-actions';

  const hamburgerBtn = document.createElement('button');
  hamburgerBtn.className = 'eds-icon-btn eds-hamburger-btn';
  hamburgerBtn.id = 'btn-hamburger';
  hamburgerBtn.title = 'Open chats';
  hamburgerBtn.setAttribute('aria-label', 'Open chats');
  hamburgerBtn.setAttribute('aria-expanded', 'false');
  hamburgerBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <line x1="3" y1="6" x2="21" y2="6"></line>
      <line x1="3" y1="12" x2="21" y2="12"></line>
      <line x1="3" y1="18" x2="21" y2="18"></line>
    </svg>
  `;

  const newChatBtn = document.createElement('button');
  newChatBtn.className = 'eds-icon-btn eds-mobile-only';
  newChatBtn.id = 'btn-new-chat';
  newChatBtn.title = 'New chat';
  newChatBtn.setAttribute('aria-label', 'New chat');
  loadIcon('s2-icon-aichat-20-n').then((svg) => newChatBtn.appendChild(svg));

  const themeBtn = document.createElement('button');
  themeBtn.className = 'eds-icon-btn';
  themeBtn.id = 'btn-theme';
  themeBtn.title = themeTitle(effectiveTheme());
  themeBtn.setAttribute('aria-label', 'Toggle theme');
  loadIcon('S2_Icon_Contrast_20_N').then((svg) => themeBtn.appendChild(svg));

  actions.append(hamburgerBtn, newChatBtn, themeBtn);
  header.append(actions);
  main.appendChild(header);

  hamburgerBtn.addEventListener('click', () => {
    if (isDesktopViewport()) {
      setSidebarCollapsed(false);
      hamburgerBtn.setAttribute('aria-expanded', 'true');
      return;
    }
    const willOpen = !sidebar.classList.contains('eds-agent-sidebar-open');
    sidebar.classList.toggle('eds-agent-sidebar-open', willOpen);
    document.body.classList.toggle('eds-sidebar-open', willOpen);
    hamburgerBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
  });

  // Messages area
  const messagesEl = document.createElement('div');
  messagesEl.className = 'eds-agent-messages';
  main.appendChild(messagesEl);
  attachCopyDelegation(messagesEl);

  // Input area
  const inputArea = document.createElement('div');
  inputArea.className = 'eds-agent-input';
  inputArea.innerHTML = `
    <div class="eds-agent-input-row">
      <textarea id="agent-input" rows="1" placeholder="Ask me anything about Edge Delivery Services..."></textarea>
      <button class="eds-agent-send" id="btn-send" aria-label="Send message">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  `;
  main.appendChild(inputArea);

  renderSidebar(sidebar, buildSidebarCallbacks(container));

  container.appendChild(app);

  const textarea = app.querySelector('#agent-input');
  const sendBtn = app.querySelector('#btn-send');
  sendBtnState.el = sendBtn;
  sendBtnState.sendIconHTML = sendBtn.innerHTML;

  const active = config.org ? getActiveChat(config.org) : null;
  if (active) {
    activeChatId = active.id;
    messages = active.messages.slice();
    renderAllMessages(messagesEl);
  } else {
    activeChatId = null;
    messages = [];
    renderWelcome(messagesEl, textarea);
  }

  textarea.addEventListener('input', () => {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  });

  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming) sendMessage(textarea, messagesEl);
    }
  });

  sendBtn.addEventListener('click', () => {
    if (isStreaming) {
      if (currentAbortController) currentAbortController.abort();
    } else {
      sendMessage(textarea, messagesEl);
    }
  });

  newChatBtn.addEventListener('click', () => {
    buildSidebarCallbacks(container).onNewChat();
  });

  themeBtn.addEventListener('click', () => {
    const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    themeBtn.title = themeTitle(next);
  });

  textarea.focus();
}

// --- Initialization ---

// Capture phase + closest() checks let this single document-level listener
// dismiss the sidebar on outside clicks while ignoring clicks on the sidebar
// itself or the hamburger toggle (which has its own handler). Both checks
// are required: removing either re-introduces the bug they prevent.
function attachSidebarBackdropDismiss() {
  if (sidebarDismissAttached) return;
  sidebarDismissAttached = true;
  document.addEventListener('click', (e) => {
    if (!document.body.classList.contains('eds-sidebar-open')) return;
    if (e.target.closest('.eds-agent-sidebar')) return;
    if (e.target.closest('.eds-hamburger-btn')) return;
    document.body.classList.remove('eds-sidebar-open');
    const sidebarEl = document.querySelector('.eds-agent-sidebar');
    if (sidebarEl) sidebarEl.classList.remove('eds-agent-sidebar-open');
    const hamburgerEl = document.querySelector('.eds-hamburger-btn');
    if (hamburgerEl) hamburgerEl.setAttribute('aria-expanded', 'false');
  }, { capture: true });
}

function initEdsAgent() {
  const appContainer = document.getElementById('agent-app');
  if (!appContainer) return;

  applyTheme(getStoredTheme());
  setSidebarCollapsed(getSidebarCollapsed());
  attachSidebarBackdropDismiss();

  const config = getConfig();
  if (config.org) {
    migrateLegacyMessages(config.org, config.site);
    activeChatId = getActiveChatId(config.org);
  }

  if (config.authToken && config.org) {
    renderChat(appContainer);
  } else {
    renderChat(appContainer);
    openSetupModal({ mode: 'required' });
  }
}

registerToolReady(new Promise((resolve) => {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initEdsAgent();
      resolve();
    });
  } else {
    initEdsAgent();
    resolve();
  }
}));
