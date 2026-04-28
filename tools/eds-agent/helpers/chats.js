import { STORAGE_KEYS } from './constants.js';

const TITLE_MAX = 40;

function chatsKey(org) {
  return `${STORAGE_KEYS.CHATS_PREFIX}${org}`;
}

function activeKey(org) {
  return `${STORAGE_KEYS.ACTIVE_PREFIX}${org}`;
}

function makeTitle(message) {
  const trimmed = String(message ?? '').trim();
  if (trimmed.length <= TITLE_MAX) return trimmed;
  return `${trimmed.slice(0, TITLE_MAX).trim()}…`;
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    if (e && e.name === 'QuotaExceededError') return false;
    throw e;
  }
}

export function loadChats(org) {
  if (!org) return [];
  const raw = localStorage.getItem(chatsKey(org));
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveChats(org, chats) {
  if (!org) return false;
  if (safeWrite(chatsKey(org), JSON.stringify(chats))) return true;
  if (chats.length > 1) {
    const trimmed = chats.slice(0, -1);
    if (safeWrite(chatsKey(org), JSON.stringify(trimmed))) return true;
  }
  return false;
}

export function createChat(org, firstUserMessage, site) {
  const now = Date.now();
  const chat = {
    id: crypto.randomUUID(),
    title: makeTitle(firstUserMessage),
    createdAt: now,
    updatedAt: now,
    site: site || '',
    messages: [],
  };
  const chats = loadChats(org);
  chats.unshift(chat);
  saveChats(org, chats);
  return chat;
}

export function deleteChat(org, id) {
  const chats = loadChats(org);
  const idx = chats.findIndex((c) => c.id === id);
  if (idx === -1) {
    return { remaining: chats, nextActiveId: chats[0]?.id ?? null };
  }
  chats.splice(idx, 1);
  saveChats(org, chats);
  return { remaining: chats, nextActiveId: chats[0]?.id ?? null };
}

export function getActiveChatId(org) {
  if (!org) return null;
  return localStorage.getItem(activeKey(org)) || null;
}

export function setActiveChatId(org, id) {
  if (!org) return;
  if (id == null) {
    localStorage.removeItem(activeKey(org));
  } else {
    localStorage.setItem(activeKey(org), id);
  }
}

export function appendMessage(org, id, message) {
  const chats = loadChats(org);
  const chat = chats.find((c) => c.id === id);
  if (!chat) return null;
  chat.messages.push(message);
  chat.updatedAt = Date.now();
  if (!saveChats(org, chats)) return null;
  return chat;
}

export function migrateLegacyMessages(org, site) {
  const raw = sessionStorage.getItem(STORAGE_KEYS.LEGACY_MESSAGES);
  if (!raw) return false;
  sessionStorage.removeItem(STORAGE_KEYS.LEGACY_MESSAGES);
  if (!org) return false;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return false; }
  if (!Array.isArray(parsed) || parsed.length === 0) return false;
  const firstUser = parsed.find((m) => m.role === 'user');
  const titleSource = firstUser ? firstUser.content : '(legacy chat)';
  const now = Date.now();
  const chat = {
    id: crypto.randomUUID(),
    title: makeTitle(typeof titleSource === 'string' ? titleSource : '(legacy chat)'),
    createdAt: now,
    updatedAt: now,
    site: site || '',
    messages: parsed,
  };
  const chats = loadChats(org);
  chats.unshift(chat);
  saveChats(org, chats);
  setActiveChatId(org, chat.id);
  return true;
}

export function groupChatsByDate(chats, now = Date.now()) {
  const d = new Date(now);
  const todayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const oneDay = 24 * 60 * 60 * 1000;
  const yesterdayStart = todayStart - oneDay;
  const sevenAgo = todayStart - 7 * oneDay;
  const thirtyAgo = todayStart - 30 * oneDay;
  const groups = {
    today: [], yesterday: [], last7: [], last30: [], older: [],
  };
  chats.forEach((c) => {
    const t = c.createdAt;
    if (t >= todayStart) groups.today.push(c);
    else if (t >= yesterdayStart) groups.yesterday.push(c);
    else if (t >= sevenAgo) groups.last7.push(c);
    else if (t >= thirtyAgo) groups.last30.push(c);
    else groups.older.push(c);
  });
  return groups;
}
