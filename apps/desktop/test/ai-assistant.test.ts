import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTranscript,
  composeUserMessage,
  extractCommands,
  commandForTerminal,
  parseAiSettings,
  resolveChatUrl,
  splitAssistant,
  isRiskyCommand,
  tailText,
  usableProfiles,
} from '../src/common/ai-assistant.js';
import { createStreamDecoder } from '../src/common/ai-stream.js';

test('refuses to store a plaintext API key', () => {
  const parsed = parseAiSettings({ provider: 'openai', apiKey: 'sk-live-secret' });
  assert.equal(parsed.ok, false);
});

test('accepts ciphertext and does not invent a model', () => {
  const parsed = parseAiSettings({
    provider: 'openai',
    model: 'gpt-4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyCiphertext: 'QQ==',
    enabledServerIds: ['server-1', 'server-1'],
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.settings.profiles, []);
  assert.deepEqual(parsed.settings.enabledServerIds, ['server-1']);
  assert.equal('apiKey' in parsed.settings, false);
  assert.equal('apiKeys' in parsed.settings, false);
});

test('keeps a checked model and drops one that was never checked', () => {
  const parsed = parseAiSettings({
    profiles: [
      { id: 'guess', provider: 'ollama', model: 'gemma4', baseUrl: 'http://127.0.0.1:11434' },
      { id: 'local', provider: 'ollama', model: 'my-local:7b', baseUrl: 'http://127.0.0.1:11434', verified: true },
      { id: 'cloud', provider: 'openai', model: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1', verified: true },
    ],
    activeProfileId: 'cloud',
    apiKeys: { openai: 'sk-live-secret' },
  });
  assert.equal(parsed.ok, false);
  const saved = parseAiSettings({
    profiles: [
      { id: 'guess', provider: 'ollama', model: 'gemma4', baseUrl: 'http://127.0.0.1:11434' },
      { id: 'local', provider: 'ollama', model: 'my-local:7b', baseUrl: 'http://127.0.0.1:11434', verified: true },
      { id: 'cloud', provider: 'openai', model: 'gpt-6-luna', baseUrl: 'https://api.openai.com/v1', verified: true },
    ],
    activeProfileId: 'cloud',
    apiKeys: { openai: 'QQ==' },
  });
  assert.equal(saved.ok, true);
  if (!saved.ok) return;
  assert.deepEqual(saved.settings.profiles.map((profile) => profile.id), ['local', 'cloud']);
  assert.equal(saved.settings.activeProfileId, 'cloud');
  assert.equal(saved.settings.profiles[0].model, 'my-local:7b');
  assert.equal(saved.settings.profiles[0].apiKeyCiphertext, '');
  assert.equal(saved.settings.profiles[1].apiKeyCiphertext, 'QQ==');
  assert.equal('apiKeys' in saved.settings, false);
  assert.deepEqual(usableProfiles(saved.settings).map((profile) => profile.id), ['local', 'cloud']);
  const withoutKey = parseAiSettings({
    ...saved.settings,
    profiles: saved.settings.profiles.map((profile) =>
      profile.id === 'cloud' ? { ...profile, apiKeyCiphertext: '' } : profile
    ),
  });
  assert.equal(withoutKey.ok, true);
  if (!withoutKey.ok) return;
  assert.deepEqual(usableProfiles(withoutKey.settings).map((profile) => profile.id), ['local']);
});

test('each model keeps its own key', () => {
  const parsed = parseAiSettings({
    profiles: [
      {
        id: 'sol',
        provider: 'openai',
        model: 'gpt-6-sol',
        baseUrl: 'https://api.openai.com/v1',
        verified: true,
        apiKeyCiphertext: 'QQ==',
      },
      {
        id: 'astra',
        provider: 'openai',
        model: 'gpt-6-astra',
        baseUrl: 'https://api.openai.com/v1',
        verified: true,
        apiKeyCiphertext: 'Qg==',
      },
    ],
    apiKeys: { openai: 'Qc==' },
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.settings.profiles[0].apiKeyCiphertext, 'QQ==');
  assert.equal(parsed.settings.profiles[1].apiKeyCiphertext, 'Qg==');
  const leaked = parseAiSettings({
    profiles: [
      {
        id: 'sol',
        provider: 'openai',
        model: 'gpt-6-sol',
        baseUrl: 'https://api.openai.com/v1',
        verified: true,
        apiKey: 'sk-live-secret',
      },
    ],
  });
  assert.equal(leaked.ok, false);
});

test('HTTP is only allowed for localhost', () => {
  assert.equal('error' in resolveChatUrl('openai', 'http://example.com/v1'), true);
  const loopback = resolveChatUrl('ollama', 'http://127.0.0.1:11434');
  assert.deepEqual(loopback, { url: 'http://127.0.0.1:11434/api/chat' });
  const local = resolveChatUrl('ollama', 'http://[::1]:11434');
  assert.deepEqual(local, { url: 'http://[::1]:11434/api/chat' });
  const cloud = resolveChatUrl('openai', 'https://api.openai.com/v1');
  assert.deepEqual(cloud, { url: 'https://api.openai.com/v1/chat/completions' });
});

test('a fenced command can be inserted, including several lines', () => {
  const commands = extractCommands('Try this:\n```sh\nls -la\n```\n\n```sh\nls\npwd\n```');
  assert.equal(commands.length, 2);
  assert.deepEqual(commands[0], { text: 'ls -la', insertable: true, risky: false });
  assert.equal(commands[1].insertable, true);
  assert.equal(commands[1].text, 'ls\npwd');
  assert.deepEqual(extractCommands('```sh\n$ ls\n```')[0], { text: 'ls', insertable: true, risky: false });
  assert.equal(commandForTerminal('ls'), 'ls');
  assert.equal(commandForTerminal('ls\npwd'), '\u001b[200~ls\npwd\u001b[201~');
  assert.deepEqual(splitAssistant('```sh\nls -la\n```').map((part) => part.kind), ['command']);
});

test('reply parts keep the order the model wrote them in', () => {
  const parts = splitAssistant('Delete them:\n```sh\nrm /tmp/a\n```\nThen check:\n```bash\ndf -h\n```\nDone.');
  assert.deepEqual(
    parts.map((part) => (part.kind === 'command' ? `cmd:${part.command.text}` : part.kind === 'text' ? part.text : part.kind)),
    ['Delete them:', 'cmd:rm /tmp/a', 'Then check:', 'cmd:df -h', 'Done.']
  );
});

test('only shell fences become insertable commands', () => {
  const parts = splitAssistant('Config:\n```yaml\nport: 80\n```\n```\nuptime\n```\n```python\nprint(1)\n```');
  assert.deepEqual(parts.map((part) => part.kind), ['text', 'code', 'command', 'code']);
  assert.equal(parts[1].kind === 'code' && parts[1].language, 'yaml');
  assert.deepEqual(extractCommands('```json\n{"a":1}\n```'), []);
});

test('commands that change the system are marked risky', () => {
  for (const command of [
    "find /var/lib/redis -maxdepth 1 -type f -name 'temp-*.rdb' -mmin +1440 -delete",
    'rm -rf /var/log/old',
    'sudo systemctl restart redis-server',
    'dd if=/dev/zero of=/dev/sda bs=1M',
    'echo 1 > /proc/sys/vm/drop_caches',
    'redis-cli FLUSHALL',
    'docker system prune -af',
    'kill -9 1234',
  ]) {
    assert.equal(isRiskyCommand(command), true, command);
  }
  for (const command of [
    'df -h /var/lib/redis',
    'du -xhd1 / 2>/dev/null | sort -h',
    'docker run --rm alpine true',
    "journalctl -k --since '2026-11-02 09:30' --no-pager | grep -Ei 'oom|killed process' | tail -30",
    'ps -eo pid,args | grep [r]edis',
    'echo ok >> /tmp/log 2>&1',
  ]) {
    assert.equal(isRiskyCommand(command), false, command);
  }
});

test('the terminal excerpt is part of the user message, not a separate turn', () => {
  const content = composeUserMessage('why did this fail', 'command not found');
  const transcript = buildTranscript(
    [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'ok' },
      { role: 'user', content: 'failed question' },
    ],
    content
  );
  assert.equal(transcript.messages.length, 3);
  assert.equal(transcript.messages[0].content, 'earlier');
  assert.equal(transcript.messages[1].role, 'assistant');
  assert.match(transcript.messages[2].content, /failed question/);
  assert.match(transcript.messages[2].content, /command not found/);
  const agent = buildTranscript([], 'restart nginx', 'agent');
  assert.match(agent.system, /what the command does/);
});

test('blank rows under the prompt do not use up the line budget', () => {
  const screen = ['root@box:~# ls', 'a b', 'root@box:~# ', ...Array.from({ length: 35 }, () => '')];
  assert.equal(tailText(screen, 2), 'a b\nroot@box:~# ');
});

test('terminal tail keeps the newest lines', () => {
  const lines = Array.from({ length: 100 }, (_, index) => `line ${index}`);
  const text = tailText(lines, 2, 6000);
  assert.equal(text, 'line 98\nline 99');
});

test('stream decoder reads OpenAI, Anthropic and Ollama chunks split anywhere', () => {
  const collect = (provider: Parameters<typeof createStreamDecoder>[0], raw: string, size: number) => {
    const decoder = createStreamDecoder(provider);
    const events = [];
    for (let i = 0; i < raw.length; i += size) events.push(...decoder.push(raw.slice(i, i + size)));
    events.push(...decoder.end());
    return events;
  };
  const openai = [
    'data: {"choices":[{"delta":{"role":"assistant"}}]}',
    'data: {"choices":[{"delta":{"content":"Hel"}}]}',
    ': keep-alive',
    'data: {"choices":[{"delta":{"content":"lo"}}]}',
    'data: [DONE]',
    '',
  ].join('\n');
  assert.deepEqual(collect('openai', openai, 7), [{ delta: 'Hel' }, { delta: 'lo' }, { done: true }]);

  const anthropic = [
    'event: message_start',
    'data: {"type":"message_start","message":{}}',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"df -h"}}',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n');
  assert.deepEqual(collect('anthropic', anthropic, 5), [{ delta: 'df -h' }, { done: true }]);

  const ollama = '{"message":{"content":"ok"},"done":false}\n{"message":{"content":""},"done":true}';
  assert.deepEqual(collect('ollama', ollama, 3), [{ delta: 'ok' }, { done: true }]);

  assert.deepEqual(collect('openrouter', 'data: {"error":{"message":"Rate limited"}}\n', 100), [{ error: 'Rate limited' }]);
});

test('an open fence is a pending command while streaming and plain code afterwards', () => {
  const partial = 'Free space:\n```sh\nfind /var/lib/redis -name temp-*.rdb -de';
  const streaming = splitAssistant(partial, { streaming: true });
  assert.deepEqual(streaming.map((part) => part.kind), ['text', 'command']);
  const finished = splitAssistant(partial);
  assert.deepEqual(finished.map((part) => part.kind), ['text', 'code']);
  assert.deepEqual(extractCommands(partial), []);
  assert.deepEqual(splitAssistant('Wait\n```sh', { streaming: true }).map((part) => part.kind), ['text']);
});
