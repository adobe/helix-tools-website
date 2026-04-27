const CHATS_KEY_PREFIX = 'eds-agent-chats:';
const ACTIVE_KEY_PREFIX = 'eds-agent-active-chat:';
const TITLE_MAX = 40;

function chatsKey(org) {
  return `${CHATS_KEY_PREFIX}${org}`;
}

// eslint-disable-next-line no-unused-vars
function activeKey(org) {
  return `${ACTIVE_KEY_PREFIX}${org}`;
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
  if (!org) return chats;
  let toWrite = chats;
  if (safeWrite(chatsKey(org), JSON.stringify(toWrite))) return toWrite;
  if (toWrite.length > 1) {
    toWrite = toWrite.slice(0, -1);
    safeWrite(chatsKey(org), JSON.stringify(toWrite));
  }
  return toWrite;
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

// Stubs filled in by Tasks 2 and 3. Exported here only so the test file's
// destructured import doesn't fail before those tasks land.

// eslint-disable-next-line no-unused-vars
export function getActiveChatId(org) { return null; }
// eslint-disable-next-line no-unused-vars
export function setActiveChatId(org, id) {}
// eslint-disable-next-line no-unused-vars
export function appendMessage(org, id, message) { return null; }
// eslint-disable-next-line no-unused-vars
export function migrateLegacyMessages(org, site) { return false; }
export function groupChatsByDate(chats) {
  return {
    today: chats, yesterday: [], last7: [], last30: [], older: [],
  };
}
