/*
 * Parses a single SSE line from the worker (AI SDK v5 UIMessageStream format).
 *
 * Event lines look like:  `data: {"type":"text-delta","delta":"..."}`
 *
 * Side effects: updates `state` (accumulated text, tool-call lookup, pending
 * approvals, error flags) and pushes committed messages into the `messages`
 * array (passed by reference) so the next re-POST (after approval) includes
 * the tool-call and tool-approval-request parts the server needs to resume.
 *
 * The `view` parameter holds the message-rendering callbacks so the parser
 * can be unit-tested without a DOM. In production, the entry file binds the
 * real implementations from `messages-view.js`.
 */
export function parseSSELine(line, state, messagesEl, messages, view) {
  if (!line.startsWith('data: ')) return;
  const raw = line.slice(6).trim();
  if (!raw || raw === '[DONE]') return;

  let part;
  try { part = JSON.parse(raw); } catch { return; }

  switch (part.type) {
    case 'text-start':
      view.hideStatusRow();
      state.accumulatedText = '';
      if (!view.hasStreamingBubble(messagesEl)) {
        view.renderMessageBubble(messagesEl, { role: 'assistant', content: '' }, true);
      }
      break;

    case 'text-delta':
      state.accumulatedText += part.delta ?? part.textDelta ?? part.text ?? '';
      view.updateStreamingMessage(messagesEl, state.accumulatedText);
      break;

    case 'text-end':
      if (state.accumulatedText) {
        messages.push({ role: 'assistant', content: state.accumulatedText });
      }
      state.accumulatedText = '';
      view.finalizeStreamingMessage(messagesEl);
      break;

    case 'tool-call':
    case 'tool-input-available': {
      view.hideStatusRow();
      const { toolCallId, toolName } = part;
      const input = part.input ?? part.args ?? {};
      state.toolCallsById[toolCallId] = { toolName, input };
      view.renderToolCallCard(messagesEl, { toolCallId, toolName, input });
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
      view.updateToolCallCard(messagesEl, { toolCallId, output });
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
      view.finalizeStreamingMessage(messagesEl);
      break;

    case 'error':
      state.hasError = true;
      state.errorText = part.errorText ?? part.error ?? '';
      break;

    default:
      break;
  }
}

export async function readStream(reader, decoder, messagesEl, messages, view) {
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
      lines.forEach((line) => parseSSELine(line, state, messagesEl, messages, view));
    }
  }

  return state;
}
