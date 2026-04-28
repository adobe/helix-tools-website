/* eslint-env node, es2020 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { parseSSELine } from '../helpers/sse-parser.js';

function makeStubView() {
  const calls = [];
  return {
    calls,
    renderMessageBubble: (...args) => { calls.push(['renderMessageBubble', args]); },
    updateStreamingMessage: (...args) => { calls.push(['updateStreamingMessage', args]); },
    finalizeStreamingMessage: (...args) => { calls.push(['finalizeStreamingMessage', args]); },
    hideStatusRow: () => { calls.push(['hideStatusRow', []]); },
    hasStreamingBubble: () => false,
  };
}

function makeState() {
  return {
    accumulatedText: '',
    toolCallsById: {},
    pendingApprovals: [],
    hasError: false,
    errorText: '',
  };
}

let messages;
let state;
let view;
const messagesEl = {};

beforeEach(() => {
  messages = [];
  state = makeState();
  view = makeStubView();
});

describe('eds-agent:sse-parser.js — parseSSELine', () => {
  it('ignores lines that do not start with "data: "', () => {
    parseSSELine('event: ping', state, messagesEl, messages, view);
    parseSSELine('', state, messagesEl, messages, view);
    assert.equal(view.calls.length, 0);
    assert.equal(messages.length, 0);
  });

  it('ignores [DONE] sentinels', () => {
    parseSSELine('data: [DONE]', state, messagesEl, messages, view);
    assert.equal(view.calls.length, 0);
  });

  it('ignores malformed JSON', () => {
    parseSSELine('data: not-json', state, messagesEl, messages, view);
    assert.equal(view.calls.length, 0);
  });

  it('text-start renders a streaming bubble (when none exists)', () => {
    parseSSELine('data: {"type":"text-start"}', state, messagesEl, messages, view);
    const bubbleCall = view.calls.find(([n]) => n === 'renderMessageBubble');
    assert.ok(bubbleCall);
    assert.deepEqual(bubbleCall[1][1], { role: 'assistant', content: '' });
    assert.equal(bubbleCall[1][2], true);
  });

  it('text-delta accumulates text and updates the streaming message', () => {
    parseSSELine('data: {"type":"text-delta","delta":"Hel"}', state, messagesEl, messages, view);
    parseSSELine('data: {"type":"text-delta","delta":"lo"}', state, messagesEl, messages, view);
    assert.equal(state.accumulatedText, 'Hello');
    const updates = view.calls.filter(([n]) => n === 'updateStreamingMessage');
    assert.equal(updates.length, 2);
    assert.equal(updates[1][1][1], 'Hello');
  });

  it('text-end pushes the assistant message and clears the accumulator', () => {
    state.accumulatedText = 'Hello world';
    parseSSELine('data: {"type":"text-end"}', state, messagesEl, messages, view);
    assert.deepEqual(messages, [{ role: 'assistant', content: 'Hello world' }]);
    assert.equal(state.accumulatedText, '');
    assert.ok(view.calls.find(([n]) => n === 'finalizeStreamingMessage'));
  });

  it('tool-call records the call and pushes a tool-call assistant message', () => {
    parseSSELine(
      'data: {"type":"tool-call","toolCallId":"t1","toolName":"list_sites","input":{"org":"adobe"}}',
      state,
      messagesEl,
      messages,
      view,
    );
    assert.deepEqual(state.toolCallsById.t1, { toolName: 'list_sites', input: { org: 'adobe' } });
    assert.deepEqual(messages, [{
      role: 'assistant',
      content: [{
        type: 'tool-call', toolCallId: 't1', toolName: 'list_sites', input: { org: 'adobe' },
      }],
    }]);
  });

  it('tool-approval-request appends approval part to matching tool-call message', () => {
    parseSSELine(
      'data: {"type":"tool-call","toolCallId":"t1","toolName":"publish","input":{}}',
      state,
      messagesEl,
      messages,
      view,
    );
    parseSSELine(
      'data: {"type":"tool-approval-request","approvalId":"a1","toolCallId":"t1"}',
      state,
      messagesEl,
      messages,
      view,
    );
    const last = messages[messages.length - 1];
    assert.equal(last.content.length, 2);
    assert.deepEqual(last.content[1], { type: 'tool-approval-request', approvalId: 'a1', toolCallId: 't1' });
    assert.deepEqual(state.pendingApprovals, [{
      approvalId: 'a1', toolCallId: 't1', toolName: 'publish', args: {},
    }]);
  });

  it('tool-result pushes a tool message', () => {
    state.toolCallsById.t1 = { toolName: 'list_sites', input: {} };
    parseSSELine(
      'data: {"type":"tool-result","toolCallId":"t1","output":{"sites":["a"]}}',
      state,
      messagesEl,
      messages,
      view,
    );
    assert.deepEqual(messages, [{
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: 't1',
        toolName: 'list_sites',
        output: { type: 'json', value: { sites: ['a'] } },
      }],
    }]);
  });

  it('tool-result with string output produces text-typed value', () => {
    state.toolCallsById.t1 = { toolName: 'echo', input: {} };
    parseSSELine(
      'data: {"type":"tool-result","toolCallId":"t1","output":"hello"}',
      state,
      messagesEl,
      messages,
      view,
    );
    assert.deepEqual(messages[0].content[0].output, { type: 'text', value: 'hello' });
  });

  it('finish flushes pending text and finalizes the bubble', () => {
    state.accumulatedText = 'partial';
    parseSSELine('data: {"type":"finish"}', state, messagesEl, messages, view);
    assert.deepEqual(messages, [{ role: 'assistant', content: 'partial' }]);
    assert.equal(state.accumulatedText, '');
    assert.ok(view.calls.find(([n]) => n === 'finalizeStreamingMessage'));
  });

  it('error sets state flags', () => {
    parseSSELine('data: {"type":"error","errorText":"boom"}', state, messagesEl, messages, view);
    assert.equal(state.hasError, true);
    assert.equal(state.errorText, 'boom');
  });

  it('unknown event types are ignored', () => {
    parseSSELine('data: {"type":"unknown"}', state, messagesEl, messages, view);
    assert.equal(view.calls.length, 0);
    assert.equal(messages.length, 0);
  });
});
