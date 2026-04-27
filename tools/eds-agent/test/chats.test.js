/* eslint-env node, es2020 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

function makeStorageShim() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    _store: store,
  };
}

// Storage shims must be installed before chats.js is loaded, because
// the module-level constants don't reference storage but later imports
// in test files might. Setting globals here covers both.
globalThis.localStorage = makeStorageShim();
globalThis.sessionStorage = makeStorageShim();

const {
  loadChats,
  saveChats,
  createChat,
  deleteChat,
  // The five names below are not exercised by Task 1's tests; they are
  // destructured here so Tasks 2 and 3 can append more describe blocks
  // without re-importing.
  // eslint-disable-next-line no-unused-vars
  getActiveChatId,
  // eslint-disable-next-line no-unused-vars
  setActiveChatId,
  // eslint-disable-next-line no-unused-vars
  appendMessage,
  // eslint-disable-next-line no-unused-vars
  migrateLegacyMessages,
  // eslint-disable-next-line no-unused-vars
  groupChatsByDate,
} = await import('../chats.js');

beforeEach(() => {
  globalThis.localStorage = makeStorageShim();
  globalThis.sessionStorage = makeStorageShim();
});

describe('eds-agent:chats.js — CRUD', () => {
  it('loadChats returns [] when nothing is stored', () => {
    assert.deepEqual(loadChats('adobe'), []);
  });

  it('saveChats persists JSON under per-org key', () => {
    saveChats('adobe', [{
      id: 'a', title: 't', createdAt: 1, updatedAt: 1, site: '', messages: [],
    }]);
    const raw = localStorage.getItem('eds-agent-chats:adobe');
    assert.ok(raw);
    const parsed = JSON.parse(raw);
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0].id, 'a');
  });

  it('loadChats round-trips saveChats', () => {
    const chats = [{
      id: 'a', title: 'hello', createdAt: 100, updatedAt: 100, site: 'x', messages: [],
    }];
    saveChats('adobe', chats);
    assert.deepEqual(loadChats('adobe'), chats);
  });

  it('chats are scoped per org', () => {
    saveChats('adobe', [{
      id: 'a', title: 'A', createdAt: 1, updatedAt: 1, site: '', messages: [],
    }]);
    saveChats('twdc', [{
      id: 'b', title: 'B', createdAt: 2, updatedAt: 2, site: '', messages: [],
    }]);
    assert.equal(loadChats('adobe').length, 1);
    assert.equal(loadChats('adobe')[0].id, 'a');
    assert.equal(loadChats('twdc').length, 1);
    assert.equal(loadChats('twdc')[0].id, 'b');
  });

  it('createChat unshifts a new chat with a generated id and truncated title', () => {
    const chat = createChat('adobe', 'What happened in the last hour? extra text beyond limit', 'helix');
    assert.ok(chat.id);
    assert.equal(chat.title.length <= 41, true); // 40 chars + ellipsis
    assert.equal(chat.title.endsWith('…'), true);
    assert.equal(chat.site, 'helix');
    assert.ok(chat.createdAt > 0);
    assert.equal(chat.updatedAt, chat.createdAt);
    assert.deepEqual(chat.messages, []);

    const stored = loadChats('adobe');
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, chat.id);
  });

  it('createChat does not truncate short messages or append ellipsis', () => {
    const chat = createChat('adobe', 'short message', '');
    assert.equal(chat.title, 'short message');
    assert.equal(chat.title.endsWith('…'), false);
  });

  it('createChat trims leading/trailing whitespace in title', () => {
    const chat = createChat('adobe', '   hello   ', '');
    assert.equal(chat.title, 'hello');
  });

  it('createChat unshifts so newest is first', () => {
    createChat('adobe', 'first', '');
    createChat('adobe', 'second', '');
    const chats = loadChats('adobe');
    assert.equal(chats[0].title, 'second');
    assert.equal(chats[1].title, 'first');
  });

  it('deleteChat removes the chat and returns the next active id', () => {
    const a = createChat('adobe', 'first', '');
    const b = createChat('adobe', 'second', '');
    const result = deleteChat('adobe', b.id);
    assert.equal(result.remaining.length, 1);
    assert.equal(result.remaining[0].id, a.id);
    assert.equal(result.nextActiveId, a.id);
  });

  it('deleteChat returns nextActiveId=null when list becomes empty', () => {
    const a = createChat('adobe', 'first', '');
    const result = deleteChat('adobe', a.id);
    assert.equal(result.remaining.length, 0);
    assert.equal(result.nextActiveId, null);
  });

  it('deleteChat is a no-op for unknown ids', () => {
    const a = createChat('adobe', 'first', '');
    const result = deleteChat('adobe', 'nonexistent');
    assert.equal(result.remaining.length, 1);
    assert.equal(result.remaining[0].id, a.id);
    assert.equal(result.nextActiveId, a.id);
  });
});
