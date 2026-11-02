import type { AiProvider, ChatTurn } from '../../common/ai-assistant';

interface CompleteInput {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
  system: string;
  messages: ChatTurn[];
}

export async function verifyModel(input: {
  provider: AiProvider;
  model: string;
  baseUrl: string;
  apiKey: string;
}): Promise<void> {
  const result = await window.electronAPI.ai.verify(input);
  if (!result.success) throw new Error(result.error || 'Check failed');
}

/** Streams the reply through onDelta and resolves with the whole text. Aborting the signal stops the request in main. */
export async function completeChat(
  input: CompleteInput,
  options: { signal?: AbortSignal; onDelta?: (delta: string) => void } = {}
): Promise<string> {
  const requestId = crypto.randomUUID();
  const off = options.onDelta
    ? window.electronAPI.ai.onDelta((event) => {
        if (event.requestId === requestId) options.onDelta?.(event.delta);
      })
    : () => {};
  const cancel = () => {
    void window.electronAPI.ai.cancel(requestId);
  };
  options.signal?.addEventListener('abort', cancel, { once: true });
  try {
    const result = await window.electronAPI.ai.complete({ ...input, requestId });
    if (!result.success || !result.text) throw new Error(result.error || 'Request failed');
    return result.text;
  } finally {
    off();
    options.signal?.removeEventListener('abort', cancel);
  }
}
