import type { AiProvider } from './ai-assistant.js';

export type StreamEvent = { delta: string } | { done: true } | { error: string };

function errorText(value: unknown): string | null {
  if (typeof value === 'string' && value) return value;
  if (value && typeof value === 'object' && typeof (value as { message?: unknown }).message === 'string') {
    return (value as { message: string }).message;
  }
  return null;
}

function readPayload(provider: AiProvider, payload: string): StreamEvent | null {
  if (payload === '[DONE]') return { done: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const record = parsed as Record<string, unknown>;
  const error = errorText(record.error);
  if (error) return { error };

  if (provider === 'anthropic') {
    if (record.type === 'message_stop') return { done: true };
    const delta = record.delta as { type?: unknown; text?: unknown } | undefined;
    if (record.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
      return { delta: delta.text };
    }
    return null;
  }

  if (provider === 'ollama') {
    const content = (record.message as { content?: unknown } | undefined)?.content;
    if (typeof content === 'string' && content) return { delta: content };
    return record.done === true ? { done: true } : null;
  }

  const choice = (record.choices as { delta?: { content?: unknown } }[] | undefined)?.[0];
  const content = choice?.delta?.content;
  return typeof content === 'string' && content ? { delta: content } : null;
}

/**
 * Turns raw response chunks into text deltas. OpenAI, OpenRouter and Anthropic send
 * server-sent events; Ollama sends one JSON object per line.
 */
export function createStreamDecoder(provider: AiProvider): {
  push(chunk: string): StreamEvent[];
  end(): StreamEvent[];
} {
  let buffer = '';
  const readLine = (line: string): StreamEvent | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    if (provider === 'ollama') return readPayload(provider, trimmed);
    if (!trimmed.startsWith('data:')) return null;
    return readPayload(provider, trimmed.slice(5).trim());
  };
  const drain = (final: boolean): StreamEvent[] => {
    const lines = buffer.split('\n');
    buffer = final ? '' : lines.pop() ?? '';
    const events: StreamEvent[] = [];
    for (const line of lines) {
      const event = readLine(line);
      if (event) events.push(event);
    }
    return events;
  };
  return {
    push(chunk) {
      buffer += chunk;
      return drain(false);
    },
    end() {
      return drain(true);
    },
  };
}
