/* eslint-disable import/prefer-default-export */
import { AGENT_ENDPOINT } from './constants.js';
import { readStream } from './sse-parser.js';
import {
  hideStatusRow,
  showStatusRow,
  showError,
  renderMessageBubble,
  updateStreamingMessage,
  finalizeStreamingMessage,
  renderToolCallCard,
  updateToolCallCard,
  renderApprovalCard,
} from './messages-view.js';

function buildView() {
  return {
    hideStatusRow,
    hasStreamingBubble: (el) => !!el.querySelector('.eds-msg-streaming'),
    renderMessageBubble,
    updateStreamingMessage,
    finalizeStreamingMessage,
    renderToolCallCard,
    updateToolCallCard,
  };
}

export async function streamChat(messagesEl, ctx) {
  const {
    messages, config, setAbortController, onAuthError,
  } = ctx;
  const abortController = new AbortController();
  setAbortController(abortController);
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
    signal: abortController.signal,
  });

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      onAuthError('Authentication failed — please re-enter your API key.');
      return;
    }
    const errText = await response.text().catch(() => '');
    throw new Error(`Agent returned ${response.status}: ${errText || response.statusText}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const view = buildView();
  const state = await readStream(reader, decoder, messagesEl, messages, view);

  if (state.hasError) {
    showError(state.errorText ? `Agent error: ${state.errorText}` : 'Agent encountered an error');
  }

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
    await streamChat(messagesEl, ctx);
  }
}
