import { useEffect, useRef, useState } from 'react';
import { Button } from './ui/Button';
import { Select } from './ui/Select';
import {
  composeUserMessage,
  buildTranscript,
  commandForTerminal,
  profileLabel,
  providerNeedsKey,
  readTerminalTail,
  resolveChatUrl,
  splitAssistant,
  type AiSettings,
  type SuggestedCommand,
} from '../../common/ai-assistant';
import { completeChat } from '../lib/ai-client';
import { AI_SETTINGS_EVENT, decryptApiKey, loadAiSettings, openSettings, saveAiSettings } from '../lib/ai-settings';
import { ChatMarkdown } from './ChatMarkdown';

interface AssistantPanelProps {
  serverId: string;
  sessionId: string;
  getTerminal: () => Parameters<typeof readTerminalTail>[0];
  onInsert: (command: string) => void;
  onClose: () => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  stopped?: boolean;
}

const chats = new Map<string, ChatMessage[]>();

const blockAction = 'rounded px-2 py-0.5 text-xs text-fg-muted hover:bg-surface-3 hover:text-fg';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className={blockAction}
      onClick={() => {
        void window.electronAPI.clipboard.writeText(text).then((result) => {
          if (result.success) setCopied(true);
        });
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function CommandBlock({
  command,
  pending,
  onInsert,
}: {
  command: SuggestedCommand;
  pending: boolean;
  onInsert: (text: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = window.setTimeout(() => setConfirming(false), 4000);
    return () => window.clearTimeout(timer);
  }, [confirming]);

  const insert = () => {
    if (command.risky && !confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    onInsert(command.text);
  };

  return (
    <div className={`overflow-hidden rounded-lg border bg-surface-2 ${command.risky ? 'border-warning' : 'border-edge'}`}>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words px-2 pt-1.5 font-mono text-xs text-fg">
        {command.text}
      </pre>
      <div className={`flex items-center gap-1 px-1.5 pb-1 pt-0.5 ${pending ? 'invisible' : ''}`}>
        {command.risky && <span className="min-w-0 flex-1 truncate px-0.5 text-xs text-warning">Changes the system</span>}
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          <CopyButton text={command.text} />
          {command.insertable ? (
            <button
              type="button"
              className={confirming ? 'rounded bg-surface-3 px-2 py-0.5 text-xs font-medium text-warning' : `${blockAction} font-medium text-fg`}
              onClick={insert}
            >
              {confirming ? 'Insert anyway' : 'Insert'}
            </button>
          ) : (
            <span className="px-2 text-xs text-fg-subtle">Too long to paste</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ text, language }: { text: string; language: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-surface-2">
      <div className="flex items-center gap-1 border-b border-edge px-1.5 py-0.5">
        <span className="flex-1 px-0.5 text-xs text-fg-subtle">{language || 'code'}</span>
        <CopyButton text={text} />
      </div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words px-2 py-1.5 font-mono text-xs text-fg">{text}</pre>
    </div>
  );
}

function promptSettled(before: string, after: string): boolean {
  if (!after || after === before) return false;
  const last = after.split('\n').filter((line) => line.trim()).at(-1) ?? '';
  return /[$#%]\s*$/.test(last);
}

export function AssistantPanel({ serverId, sessionId, getTerminal, onInsert, onClose }: AssistantPanelProps) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>(() => chats.get(sessionId) ?? []);
  const [draft, setDraft] = useState('');
  const [includeContext, setIncludeContext] = useState(true);
  const [agent, setAgent] = useState(false);
  const [watching, setWatching] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(sessionId);
  const sendingRef = useRef(false);
  const watchGen = useRef(0);
  const watchStop = useRef<(() => void) | null>(null);
  const askRef = useRef<(question: string, excerpt: string | null, silent?: boolean) => Promise<void>>(async () => {});
  const getTerminalRef = useRef(getTerminal);
  sessionRef.current = sessionId;
  getTerminalRef.current = getTerminal;

  useEffect(() => {
    setMessages(chats.get(sessionId) ?? []);
    watchStop.current?.();
    watchStop.current = null;
    watchGen.current += 1;
    setWatching(false);
    setError('');
    stickRef.current = true;
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    const reload = () => {
      loadAiSettings()
        .then((loaded) => {
          if (!cancelled) setSettings(loaded);
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load assistant settings');
        });
    };
    reload();
    window.addEventListener(AI_SETTINGS_EVENT, reload);
    return () => {
      cancelled = true;
      window.removeEventListener(AI_SETTINGS_EVENT, reload);
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (stickRef.current) listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy, watching]);

  useEffect(() => () => {
    abortRef.current?.abort();
    watchStop.current?.();
  }, []);

  const remember = (id: string, next: ChatMessage[]) => {
    chats.set(id, next);
    if (sessionRef.current === id) setMessages(next);
  };

  const persist = async (next: AiSettings) => {
    setSettings(next);
    await saveAiSettings(next);
  };

  const profiles = settings?.profiles ?? [];
  const profile = profiles.find((item) => item.id === settings?.activeProfileId) ?? profiles[0] ?? null;
  const missingKey = Boolean(profile && providerNeedsKey(profile.provider) && !profile.apiKeyCiphertext);
  const enabled = Boolean(serverId && settings?.enabledServerIds.includes(serverId));

  const turnOn = async () => {
    if (!settings || !serverId) return;
    setError('');
    try {
      await persist({
        ...settings,
        enabledServerIds: [...settings.enabledServerIds, serverId],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not enable the assistant');
    }
  };

  const ask = async (question: string, excerpt: string | null, silent = false) => {
    if (!settings || !profile || sendingRef.current) return;
    const chatId = sessionId;
    const endpoint = resolveChatUrl(profile.provider, profile.baseUrl);
    if ('error' in endpoint) {
      setError(endpoint.error);
      return;
    }
    const history = messages.map((message) => ({ role: message.role, content: message.content }));
    const composed = composeUserMessage(question, excerpt);
    const transcript = buildTranscript(history, composed, agent ? 'agent' : 'chat');
    sendingRef.current = true;
    watchStop.current?.();
    watchStop.current = null;
    watchGen.current += 1;
    setWatching(false);
    if (!silent) {
      const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: question.trim() };
      stickRef.current = true;
      remember(chatId, [...messages, userMessage]);
      setDraft('');
    }
    setError('');
    setBusy(true);
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const replyId = crypto.randomUUID();
    let text = '';
    let frame = 0;
    const showReply = (content: string, state: Pick<ChatMessage, 'streaming' | 'stopped'>) => {
      const stored = chats.get(chatId) ?? [];
      const reply: ChatMessage = { id: replyId, role: 'assistant', content, ...state };
      const next = stored.some((message) => message.id === replyId)
        ? stored.map((message) => (message.id === replyId ? reply : message))
        : [...stored, reply];
      remember(chatId, next);
    };
    try {
      const ciphertext = profile.apiKeyCiphertext;
      const apiKey = ciphertext ? await decryptApiKey(ciphertext) : '';
      const reply = await completeChat(
        {
          provider: profile.provider,
          model: profile.model,
          baseUrl: profile.baseUrl,
          apiKey,
          system: transcript.system,
          messages: transcript.messages,
        },
        {
          signal: controller.signal,
          onDelta: (delta) => {
            text += delta;
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
              frame = 0;
              showReply(text, { streaming: true });
            });
          },
        }
      );
      window.cancelAnimationFrame(frame);
      showReply(reply, {});
    } catch (err) {
      window.cancelAnimationFrame(frame);
      const stopped = controller.signal.aborted;
      if (text.trim()) showReply(text, { stopped: true });
      if (!stopped) setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      sendingRef.current = false;
      if (abortRef.current === controller) setBusy(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };
  askRef.current = ask;

  const submit = () => {
    if (!settings || !profile || busy || sendingRef.current) return;
    const question = draft.trim();
    if (!question) return;
    const excerpt = agent || includeContext ? readTerminalTail(getTerminal()) : '';
    void ask(question, excerpt || null);
  };

  const insertCommand = (command: string) => {
    const before = readTerminalTail(getTerminalRef.current());
    onInsert(commandForTerminal(command));
    if (!agent) return;
    watchStop.current?.();
    const generation = watchGen.current + 1;
    watchGen.current = generation;
    let last = before;
    let stableFor = 0;
    let baseline = before;
    let phase: 'echo' | 'run' = 'echo';
    setWatching(true);
    const interval = window.setInterval(() => {
      if (watchGen.current !== generation) {
        window.clearInterval(interval);
        return;
      }
      if (sendingRef.current) return;
      const tail = readTerminalTail(getTerminalRef.current());
      if (tail !== last) {
        last = tail;
        stableFor = 0;
        return;
      }
      stableFor += 400;
      if (phase === 'echo') {
        if (tail === before || stableFor < 800) return;
        if (promptSettled(before, tail)) {
          window.clearInterval(interval);
          setWatching(false);
          void askRef.current('The last command finished. What is the next step?', tail || null, true);
          return;
        }
        baseline = tail;
        phase = 'run';
        stableFor = 0;
        return;
      }
      if (tail === baseline) return;
      const settled = promptSettled(baseline, tail) && stableFor >= 800;
      const quiet = stableFor >= 4000;
      if (!settled && !quiet) return;
      window.clearInterval(interval);
      setWatching(false);
      void askRef.current('The last command finished. What is the next step?', tail || null, true);
    }, 400);
    watchStop.current = () => window.clearInterval(interval);
  };

  return (
    <aside
      className="flex h-full w-[380px] shrink-0 flex-col border-l border-edge bg-surface-1"
      aria-label="Assistant"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <h2 className="shrink-0 text-sm font-medium text-fg">Assistant</h2>
        {settings && profile && (enabled || missingKey) && (
          <div className="min-w-0 flex-1">
            <Select
              id={`assistant-active-model-${sessionId}`}
              aria-label="Model"
              value={profile.id}
              disabled={busy}
              onChange={(event) => {
                const activeProfileId = event.target.value;
                if (activeProfileId !== settings.activeProfileId) {
                  void persist({ ...settings, activeProfileId });
                }
              }}
              options={profiles.map((item) => ({ value: item.id, label: profileLabel(item) }))}
              className="text-xs"
            />
          </div>
        )}
        <button
          type="button"
          className="shrink-0 px-1 text-sm text-fg-subtle hover:text-fg"
          onClick={onClose}
          aria-label="Close assistant"
        >
          Close
        </button>
      </div>

      {!settings && !error && <p className="px-3 py-3 text-sm text-fg-subtle">Loading…</p>}

      {settings && profiles.length === 0 && (
        <div className="px-3 py-3">
          <p className="text-sm text-fg-muted">No model yet.</p>
          <Button type="button" size="sm" className="mt-3" onClick={() => openSettings('assistant')}>
            Add a model
          </Button>
        </div>
      )}

      {!serverId && profiles.length > 0 && (
        <p className="px-3 py-3 text-sm text-fg-muted">Open a server terminal.</p>
      )}

      {serverId && settings && profile && missingKey && (
        <div className="px-3 py-3">
          <p className="text-sm text-fg-muted">This model has no key.</p>
          <Button type="button" size="sm" className="mt-3" onClick={() => openSettings('assistant')}>
            Add the key
          </Button>
        </div>
      )}

      {serverId && settings && profiles.length > 0 && !missingKey && !enabled && (
        <div className="px-3 py-3">
          <p className="text-sm text-fg-muted">Off for this server.</p>
          <Button type="button" size="sm" className="mt-3" onClick={() => { void turnOn(); }}>
            Turn on
          </Button>
        </div>
      )}

      {serverId && settings && profile && enabled && !missingKey && (
        <>
          <div
            ref={listRef}
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
            onScroll={(event) => {
              const list = event.currentTarget;
              stickRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
            }}
          >
            {messages.length === 0 && (
              <p className="text-sm text-fg-muted">
                {agent ? 'Describe the outcome.' : 'Ask for a command.'}
              </p>
            )}
            {messages.map((message) => {
              if (message.role === 'user') {
                return (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-surface-2 px-3 py-2">
                      <ChatMarkdown text={message.content} />
                    </div>
                  </div>
                );
              }
              return (
                <div key={message.id} className="max-w-[95%]">
                  <p className="text-xs text-fg-subtle">Assistant</p>
                  <div className="mt-1 space-y-2">
                    {splitAssistant(message.content, { streaming: message.streaming }).map((part, index) => {
                      if (part.kind === 'text') return <ChatMarkdown key={index} text={part.text} />;
                      if (part.kind === 'code') return <CodeBlock key={index} text={part.text} language={part.language} />;
                      return (
                        <CommandBlock
                          key={index}
                          command={part.command}
                          pending={Boolean(message.streaming)}
                          onInsert={insertCommand}
                        />
                      );
                    })}
                  </div>
                  {message.stopped && <p className="mt-1 text-xs text-fg-subtle">Stopped</p>}
                </div>
              );
            })}
            {watching && <p className="text-sm text-fg-subtle">Watching the terminal.</p>}
            {busy && !messages.at(-1)?.streaming && <p className="text-sm text-fg-subtle">Thinking…</p>}
          </div>

          <form
            className="border-t border-edge px-3 py-3"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="mb-2 flex gap-3 text-xs" role="group" aria-label="Mode">
              <button
                type="button"
                aria-pressed={!agent}
                className={agent ? 'text-fg-subtle hover:text-fg' : 'border-b border-accent text-fg'}
                onClick={() => {
                  watchStop.current?.();
                  watchStop.current = null;
                  watchGen.current += 1;
                  setWatching(false);
                  setAgent(false);
                }}
              >
                Chat
              </button>
              <button
                type="button"
                aria-pressed={agent}
                className={agent ? 'border-b border-accent text-fg' : 'text-fg-subtle hover:text-fg'}
                onClick={() => setAgent(true)}
              >
                Agent
              </button>
            </div>
            {!agent && (
              <label className="mb-2 flex items-center gap-2 text-xs text-fg-muted">
                <input
                  type="checkbox"
                  checked={includeContext}
                  onChange={(event) => setIncludeContext(event.target.checked)}
                  className="h-3.5 w-3.5 accent-accent"
                />
                Include terminal output
              </label>
            )}
            <div className="rounded-lg border border-edge bg-surface-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.preventDefault();
                    onClose();
                    return;
                  }
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
                rows={3}
                placeholder={agent ? 'Describe the outcome' : 'Ask for a command'}
                className="w-full resize-none bg-transparent px-3 py-2 text-sm text-fg placeholder:text-fg-subtle focus:outline-none"
              />
              <div className="flex justify-end px-2 pb-2">
                {busy ? (
                  <Button type="button" size="sm" variant="secondary" onClick={stop}>
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" size="sm" disabled={!draft.trim()}>
                    Send
                  </Button>
                )}
              </div>
            </div>
            {error && <p className="mt-2 text-sm text-danger" role="alert">{error}</p>}
          </form>
        </>
      )}
      {error && (!enabled || profiles.length === 0 || missingKey) && (
        <p className="px-3 pb-3 text-sm text-danger" role="alert">{error}</p>
      )}
    </aside>
  );
}
