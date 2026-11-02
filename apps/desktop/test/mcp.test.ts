import assert from 'node:assert/strict';
import test from 'node:test';
import { createLineReader, createMcpSession, type McpServerContext } from '../src/common/mcp-protocol.js';
import { MCP_TOOLS, formatExecResult, parseMcpCall, parseMcpSettings } from '../src/common/mcp-tools.js';
import { mcpClientSnippet } from '../src/common/mcp-client-config.js';

const META = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientInfo': { name: 'claude-code', version: '9' },
  'io.modelcontextprotocol/clientCapabilities': {},
};

function session(calls: { name: string; client: string }[] = []) {
  const context: McpServerContext = {
    serverInfo: { name: 'MagicTerm', version: '0.6.0' },
    instructions: 'test',
    tools: MCP_TOOLS,
    async callTool(name, _args, client) {
      calls.push({ name, client });
      if (name === 'run_command') throw new Error('denied');
      return { text: `ran ${name}`, structured: { ok: true } };
    },
  };
  return createMcpSession(context);
}

test('legacy clients get the initialize handshake and are named by it', async () => {
  const calls: { name: string; client: string }[] = [];
  const mcp = session(calls);
  const init = await mcp.handle({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'cursor' }, capabilities: {} },
  });
  assert.ok(init && 'result' in init);
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(await mcp.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const unknownVersion = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '2099-01-01' } });
  assert.ok(unknownVersion && 'result' in unknownVersion);
  assert.equal(unknownVersion.result.protocolVersion, '2025-11-25');

  const list = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.ok(list && 'result' in list);
  assert.deepEqual((list.result.tools as { name: string }[]).map((tool) => tool.name), [
    'list_servers', 'list_sessions', 'read_terminal', 'run_command',
  ]);
  assert.equal('resultType' in list.result, false);

  await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_servers', arguments: {} } });
  assert.deepEqual(calls, [{ name: 'list_servers', client: 'cursor' }]);
});

test('modern requests are stateless, carry resultType and name the client per request', async () => {
  const calls: { name: string; client: string }[] = [];
  const mcp = session(calls);
  const discover = await mcp.handle({ jsonrpc: '2.0', id: 'd', method: 'server/discover', params: { _meta: META } });
  assert.ok(discover && 'result' in discover);
  assert.equal(discover.result.resultType, 'complete');
  assert.deepEqual(discover.result.supportedVersions, ['2026-07-28']);
  assert.deepEqual(
    (discover.result._meta as Record<string, unknown>)['io.modelcontextprotocol/serverInfo'],
    { name: 'MagicTerm', version: '0.6.0' }
  );

  const call = await mcp.handle({
    jsonrpc: '2.0', id: 5, method: 'tools/call',
    params: { _meta: META, name: 'list_sessions', arguments: {} },
  });
  assert.ok(call && 'result' in call);
  assert.deepEqual(call.result, {
    resultType: 'complete',
    content: [{ type: 'text', text: 'ran list_sessions' }],
    isError: false,
    structuredContent: { ok: true },
  });
  assert.deepEqual(calls, [{ name: 'list_sessions', client: 'claude-code' }]);
});

test('protocol errors: unsupported version, unknown method and tool, bad arguments', async () => {
  const mcp = session();
  const old = await mcp.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/list',
    params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' } },
  });
  assert.ok(old && 'error' in old);
  assert.equal(old.error.code, -32022);
  assert.deepEqual(old.error.data, { supported: ['2026-07-28'], requested: '1900-01-01' });

  const method = await mcp.handle({ jsonrpc: '2.0', id: 2, method: 'resources/list' });
  assert.ok(method && 'error' in method);
  assert.equal(method.error.code, -32601);

  const tool = await mcp.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'rm_rf' } });
  assert.ok(tool && 'error' in tool);
  assert.equal(tool.error.code, -32602);

  const args = await mcp.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'list_servers', arguments: [] } });
  assert.ok(args && 'error' in args);
  assert.equal(args.error.code, -32602);

  const invalid = await mcp.handle({ id: 5, method: 'ping' });
  assert.ok(invalid && 'error' in invalid);
  assert.equal(invalid.error.code, -32600);
});

test('a failing tool is a tool error the model can read, not a protocol error', async () => {
  const mcp = session();
  const reply = await mcp.handle({
    jsonrpc: '2.0', id: 1, method: 'tools/call',
    params: { name: 'run_command', arguments: { server_id: 's', command: 'ls' } },
  });
  assert.ok(reply && 'result' in reply);
  assert.equal(reply.result.isError, true);
  assert.deepEqual(reply.result.content, [{ type: 'text', text: 'denied' }]);
});

test('line reader splits messages across chunks and drops overlong lines', () => {
  const lines: string[] = [];
  const read = createLineReader((line) => lines.push(line), 20);
  read('{"a":1}\r\n{"b"');
  read(':2}\n\n');
  read('x'.repeat(30));
  read('still the long line\n{"c":3}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});

test('tool arguments are validated before anything runs', () => {
  assert.deepEqual(parseMcpCall('read_terminal', { session_id: 'abc' }), { tool: 'read_terminal', sessionId: 'abc', lines: 100 });
  assert.deepEqual(parseMcpCall('run_command', { server_id: 's1', command: ' df -h ', timeout_seconds: 5 }), {
    tool: 'run_command', serverId: 's1', command: 'df -h', timeoutSeconds: 5,
  });
  assert.throws(() => parseMcpCall('run_command', { server_id: 's1', command: '   ' }), /command is required/);
  assert.throws(() => parseMcpCall('run_command', { server_id: 's1', command: 'ls', timeout_seconds: 9999 }), /timeout_seconds/);
  assert.throws(() => parseMcpCall('read_terminal', { lines: 5 }), /session_id is required/);
  assert.throws(() => parseMcpCall('read_terminal', { session_id: 'a', lines: 2.5 }), /lines/);
});

test('settings default to off and drop junk ids', () => {
  assert.deepEqual(parseMcpSettings(undefined), { enabled: false, serverIds: [] });
  assert.deepEqual(parseMcpSettings({ enabled: 'yes', serverIds: ['a', 'a', '', 3, 'b'] }), { enabled: false, serverIds: ['a', 'b'] });
  assert.deepEqual(parseMcpSettings({ enabled: true, serverIds: ['a'] }), { enabled: true, serverIds: ['a'] });
});

test('exec results read clearly for the model', () => {
  const text = formatExecResult({ exitCode: 1, signal: null, stdout: '', stderr: 'nope', truncated: true, timedOut: false });
  assert.match(text, /^Exit code 1\./);
  assert.match(text, /stdout: \(empty\)/);
  assert.match(text, /stderr:\nnope/);
  assert.match(text, /cut at 64 KB/);
  assert.match(formatExecResult({ exitCode: null, signal: null, stdout: 'x', stderr: '', truncated: false, timedOut: true }), /^Timed out/);
});

test('client snippets quote paths with spaces', () => {
  const launch = {
    command: '/Applications/Magic Term.app/Contents/MacOS/Magic Term',
    args: ['/Users/me/Library/Application Support/MagicTerm/mcp-stdio.cjs', '/tmp/mcp.sock'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
  assert.equal(
    mcpClientSnippet('claude', launch),
    "claude mcp add magicterm --scope user -e ELECTRON_RUN_AS_NODE=1 -- '/Applications/Magic Term.app/Contents/MacOS/Magic Term' '/Users/me/Library/Application Support/MagicTerm/mcp-stdio.cjs' /tmp/mcp.sock"
  );
  assert.deepEqual(JSON.parse(mcpClientSnippet('cursor', launch)), { mcpServers: { magicterm: launch } });
  const toml = mcpClientSnippet('codex', { ...launch, command: 'C:\\Program Files\\MagicTerm\\MagicTerm.exe' });
  assert.match(toml, /^\[mcp_servers\.magicterm\]\ncommand = "C:\\\\Program Files\\\\MagicTerm\\\\MagicTerm.exe"/);
  assert.match(toml, /env = \{ ELECTRON_RUN_AS_NODE = "1" \}$/);
});
