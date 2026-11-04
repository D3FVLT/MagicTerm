import assert from 'node:assert/strict';
import test from 'node:test';
import { createLineReader, createMcpSession, type McpServerContext } from '../src/common/mcp-protocol.js';
import { MCP_TOOLS, formatExecResult, parseMcpCall, parseMcpSettings } from '../src/common/mcp-tools.js';
import { mcpClientSnippet, mcpSocketPathFor } from '../src/common/mcp-client-config.js';

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
    'list_servers', 'list_sessions', 'read_terminal', 'run_command', 'list_services', 'get_service', 'scan_server', 'run_service_action', 'list_deploy_scenarios', 'run_deploy', 'read_service_logs',
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
  assert.deepEqual(parseMcpCall('list_services', {}), { tool: 'list_services', serverId: null, query: '' });
  assert.deepEqual(parseMcpCall('list_services', { server_id: 's1', query: ' acme/api ' }), { tool: 'list_services', serverId: 's1', query: 'acme/api' });
  assert.throws(() => parseMcpCall('list_services', { query: 5 }), /query must be text/);
  assert.deepEqual(parseMcpCall('get_service', { server_id: 's1', service_id: 'pm2:deploy:web' }), { tool: 'get_service', serverId: 's1', serviceId: 'pm2:deploy:web' });
  assert.throws(() => parseMcpCall('get_service', { server_id: 's1' }), /service_id is required/);
  assert.deepEqual(parseMcpCall('scan_server', { server_id: 's1' }), { tool: 'scan_server', serverId: 's1' });
  assert.deepEqual(parseMcpCall('read_service_logs', { server_id: 's1', service_id: 'systemd:api.service' }), { tool: 'read_service_logs', serverId: 's1', serviceId: 'systemd:api.service', lines: 200 });
  assert.throws(() => parseMcpCall('read_service_logs', { server_id: 's1', service_id: 'x', lines: 5000 }), /lines/);
  assert.deepEqual(parseMcpCall('run_service_action', { server_id: 's1', service_id: 'pm2:deploy:web', action: 'restart' }), { tool: 'run_service_action', serverId: 's1', serviceId: 'pm2:deploy:web', action: 'restart' });
  assert.deepEqual(parseMcpCall('run_service_action', { server_id: 's1', service_id: 'nginx', action: 'test' }).tool, 'run_service_action');
  assert.throws(() => parseMcpCall('run_service_action', { server_id: 's1', service_id: 'nginx', action: 'stop' }), /nginx takes test or reload/);
  assert.throws(() => parseMcpCall('run_service_action', { server_id: 's1', service_id: 'systemd:a.service', action: 'test' }), /only for service_id "nginx"/);
  assert.throws(() => parseMcpCall('run_service_action', { server_id: 's1', service_id: 'x', action: 'kill' }), /action must be/);
  assert.deepEqual(parseMcpCall('list_deploy_scenarios', {}), { tool: 'list_deploy_scenarios', serverId: null, serviceId: null });
  assert.deepEqual(parseMcpCall('run_deploy', { server_id: 's1', service_id: 'pm2:deploy:web', variables: { branch: 'main' } }), { tool: 'run_deploy', serverId: 's1', serviceId: 'pm2:deploy:web', variables: { branch: 'main' } });
  assert.throws(() => parseMcpCall('run_deploy', { server_id: 's1', service_id: 'x', variables: { a: 'x\ny' } }), /one line/);
  assert.throws(() => parseMcpCall('run_deploy', { server_id: 's1', service_id: 'x', variables: ['a'] }), /object/);
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

test('a long user data path moves the socket to the temp folder', () => {
  assert.equal(
    mcpSocketPathFor('darwin', '/Users/me/Library/Application Support/@magicterm/desktop', '/var/folders/x/T/', 'abc123'),
    '/Users/me/Library/Application Support/@magicterm/desktop/mcp.sock'
  );
  const long = `/Users/${'a'.repeat(60)}/Library/Application Support/@magicterm/desktop`;
  assert.equal(mcpSocketPathFor('darwin', long, '/var/folders/x/T/', 'abc123'), '/var/folders/x/T/magicterm-mcp-abc123.sock');
  assert.equal(mcpSocketPathFor('win32', long, 'C:\\Temp', 'abc123'), '\\\\.\\pipe\\magicterm-mcp-abc123');
});
