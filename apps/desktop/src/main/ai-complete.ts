import { net } from 'electron';
import {
  resolveChatUrl,
  type AiProvider,
  type ChatTurn,
} from '../common/ai-assistant';
import { createStreamDecoder, type StreamEvent } from '../common/ai-stream';

interface CompleteInput {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  system: string;
  messages: ChatTurn[];
}

function providerError(status: number, body: string): string {
  let detail = '';
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof parsed.error === 'string') detail = parsed.error;
    else if (parsed.error && typeof parsed.error.message === 'string') detail = parsed.error.message;
    else if (typeof parsed.message === 'string') detail = parsed.message;
  } catch {
    detail = body.replace(/\s+/g, ' ').trim();
  }
  const text = detail.slice(0, 240);
  if (status === 401 || status === 403) return text || 'The provider rejected the key';
  return text ? `HTTP ${status}: ${text}` : `HTTP ${status}`;
}

function readContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!Array.isArray(value)) return '';
  return value
    .map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') return part.text;
      return '';
    })
    .join('');
}

const MAX_REPLY = 32000;
const IDLE_TIMEOUT = 45000;
const TOTAL_TIMEOUT = 180000;

interface StreamOptions {
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export async function completeChat(input: CompleteInput, options: StreamOptions = {}): Promise<string> {
  const endpoint = resolveChatUrl(input.provider, input.baseUrl);
  if ('error' in endpoint) throw new Error(endpoint.error);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: unknown;

  if (input.provider === 'anthropic') {
    headers['x-api-key'] = input.apiKey;
    headers['anthropic-version'] = '2023-06-01';
    body = {
      model: input.model,
      max_tokens: 4096,
      stream: true,
      system: input.system,
      messages: input.messages,
    };
  } else if (input.provider === 'ollama') {
    body = {
      model: input.model,
      stream: true,
      messages: [{ role: 'system', content: input.system }, ...input.messages],
    };
  } else {
    headers.Authorization = `Bearer ${input.apiKey}`;
    body = {
      model: input.model,
      stream: true,
      messages: [{ role: 'system', content: input.system }, ...input.messages],
    };
  }

  const controller = new AbortController();
  let reason = '';
  const stop = (why: string) => {
    if (!reason) reason = why;
    controller.abort();
  };
  const onCancel = () => stop('Stopped');
  if (options.signal?.aborted) onCancel();
  options.signal?.addEventListener('abort', onCancel, { once: true });
  const total = setTimeout(() => stop('The provider took too long to answer'), TOTAL_TIMEOUT);
  let idle = setTimeout(() => stop('The provider stopped responding'), IDLE_TIMEOUT);
  const touch = () => {
    clearTimeout(idle);
    idle = setTimeout(() => stop('The provider stopped responding'), IDLE_TIMEOUT);
  };

  const fail = (err: unknown): never => {
    if (reason) throw new Error(reason);
    const message = err instanceof Error ? err.message : 'Request failed';
    if (input.apiKey && message.includes(input.apiKey)) throw new Error('Request failed');
    throw new Error(message.slice(0, 300));
  };

  try {
    let response: Response;
    try {
      response = await net.fetch(endpoint.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      return fail(err);
    }

    const type = response.headers.get('content-type') ?? '';
    const streamed = response.ok && response.body
      && (type.includes('event-stream') || type.includes('ndjson') || input.provider === 'ollama');
    if (!streamed) return await readWhole(input, response).catch(fail);

    const decoder = createStreamDecoder(input.provider);
    const reader = response.body!.getReader();
    const utf8 = new TextDecoder();
    let text = '';
    const apply = (events: StreamEvent[]): boolean => {
      for (const event of events) {
        if ('error' in event) throw new Error(event.error.slice(0, 300));
        if ('done' in event) return true;
        const room = MAX_REPLY - text.length;
        const delta = event.delta.slice(0, room);
        if (!delta) return true;
        text += delta;
        options.onDelta?.(delta);
      }
      return text.length >= MAX_REPLY;
    };
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          apply(decoder.end());
          break;
        }
        touch();
        if (apply(decoder.push(utf8.decode(value, { stream: true })))) {
          void reader.cancel();
          break;
        }
      }
    } catch (err) {
      return fail(err);
    }
    if (!text.trim()) throw new Error('The provider returned an empty reply');
    return text;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
    options.signal?.removeEventListener('abort', onCancel);
  }
}

async function readWhole(input: CompleteInput, response: Response): Promise<string> {
  const raw = await response.text();
  if (!response.ok) throw new Error(providerError(response.status, raw));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The provider returned a response that is not JSON');
  }

  const record = parsed as {
    choices?: { message?: { content?: unknown } }[];
    content?: unknown;
    message?: { content?: unknown };
  };
  const text = input.provider === 'anthropic'
    ? readContent(record.content)
    : input.provider === 'ollama'
      ? readContent(record.message?.content)
      : readContent(record.choices?.[0]?.message?.content);

  if (!text.trim()) throw new Error('The provider returned an empty reply');
  return text.slice(0, MAX_REPLY);
}

function listedIds(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== 'object') return [];
  const record = parsed as { data?: unknown; models?: unknown };
  const data = record.models ?? record.data;
  if (!Array.isArray(data)) return [];
  const ids: string[] = [];
  for (const item of data) {
    if (typeof item === 'string') {
      ids.push(item);
      continue;
    }
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown; name?: unknown; model?: unknown }).id
      ?? (item as { name?: unknown }).name
      ?? (item as { model?: unknown }).model;
    if (typeof id === 'string' && id) ids.push(id);
  }
  return ids;
}

function modelListed(provider: AiProvider, ids: string[], wanted: string): boolean {
  if (provider === 'ollama') {
    return ids.some((id) => id === wanted || id.startsWith(`${wanted}:`) || wanted.startsWith(`${id}:`));
  }
  return ids.includes(wanted);
}

export async function verifyModel(input: {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}): Promise<void> {
  const endpoint = resolveChatUrl(input.provider, input.baseUrl);
  if ('error' in endpoint) throw new Error(endpoint.error);

  const url = new URL(endpoint.url);
  if (input.provider === 'ollama') url.pathname = '/api/tags';
  else if (input.provider === 'anthropic') url.pathname = '/v1/models';
  else url.pathname = url.pathname.replace(/\/chat\/completions$/, '/models');

  const headers: Record<string, string> = {};
  if (input.provider === 'anthropic') {
    headers['x-api-key'] = input.apiKey;
    headers['anthropic-version'] = '2023-06-01';
  } else if (input.provider !== 'ollama') {
    headers.Authorization = `Bearer ${input.apiKey}`;
  }

  let response: Response;
  try {
    response = await net.fetch(url.toString(), {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    if (input.apiKey && message.includes(input.apiKey)) throw new Error('Could not reach the provider');
    if (input.provider === 'ollama') throw new Error('Could not reach Ollama');
    throw new Error(message.slice(0, 300));
  }

  const raw = await response.text();
  if (!response.ok) throw new Error(providerError(response.status, raw));

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('The provider returned a response that is not JSON');
  }

  const wanted = input.model.trim();
  if (!modelListed(input.provider, listedIds(parsed), wanted)) {
    throw new Error(input.provider === 'ollama' ? `Ollama does not have ${wanted}` : `This key cannot use ${wanted}`);
  }
}
