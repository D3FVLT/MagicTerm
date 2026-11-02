/**
 * The part of the Model Context Protocol MagicTerm serves over stdio: tools only.
 *
 * Dual-era, as the 2026-07-28 revision allows. A request whose `_meta` names a protocol
 * version is served statelessly (modern); an `initialize` handshake selects the legacy
 * revisions most clients still speak. The official SDK pulls in an HTTP stack this
 * desktop app does not need, so the few methods are handled here.
 */

export const MODERN_VERSIONS = ['2026-07-28'] as const;
export const LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'] as const;

const VERSION_KEY = 'io.modelcontextprotocol/protocolVersion';
const CLIENT_INFO_KEY = 'io.modelcontextprotocol/clientInfo';
const SERVER_INFO_KEY = 'io.modelcontextprotocol/serverInfo';

export const RPC_PARSE_ERROR = -32700;
export const RPC_INVALID_REQUEST = -32600;
export const RPC_METHOD_NOT_FOUND = -32601;
export const RPC_INVALID_PARAMS = -32602;
export const RPC_UNSUPPORTED_VERSION = -32022;

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
  structured?: unknown;
}

export interface McpServerContext {
  serverInfo: { name: string; version: string };
  instructions: string;
  tools: McpTool[];
  callTool(name: string, args: Record<string, unknown>, client: string): Promise<ToolResult>;
}

type RpcId = string | number | null;

export type RpcResponse =
  | { jsonrpc: '2.0'; id: RpcId; result: Record<string, unknown> }
  | { jsonrpc: '2.0'; id: RpcId; error: { code: number; message: string; data?: unknown } };

export function rpcError(id: RpcId, code: number, message: string, data?: unknown): RpcResponse {
  return { jsonrpc: '2.0', id, error: data === undefined ? { code, message } : { code, message, data } };
}

class RpcErrorResult {
  constructor(readonly code: number, readonly message: string) {}
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clientName(info: unknown): string {
  const name = record(info)?.name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : '';
}

/** One connection. Legacy clients name themselves once, in `initialize`. */
export function createMcpSession(context: McpServerContext): {
  handle(message: unknown): Promise<RpcResponse | null>;
} {
  let legacyClient = '';

  const run = async (
    method: string,
    params: Record<string, unknown>,
    client: string
  ): Promise<Record<string, unknown> | RpcErrorResult> => {
    switch (method) {
      case 'initialize': {
        const requested = params.protocolVersion;
        const protocolVersion = typeof requested === 'string' && (LEGACY_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : LEGACY_VERSIONS[0];
        legacyClient = clientName(params.clientInfo) || legacyClient;
        return {
          protocolVersion,
          capabilities: { tools: {} },
          serverInfo: context.serverInfo,
          instructions: context.instructions,
        };
      }
      case 'server/discover':
        return {
          supportedVersions: [...MODERN_VERSIONS],
          capabilities: { tools: {} },
          instructions: context.instructions,
          _meta: { [SERVER_INFO_KEY]: context.serverInfo },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: context.tools };
      case 'tools/call': {
        const name = params.name;
        if (typeof name !== 'string' || !context.tools.some((tool) => tool.name === name)) {
          return new RpcErrorResult(RPC_INVALID_PARAMS, `Unknown tool: ${String(name).slice(0, 80)}`);
        }
        const args = params.arguments === undefined ? {} : record(params.arguments);
        if (!args) return new RpcErrorResult(RPC_INVALID_PARAMS, 'Tool arguments must be an object');
        let result: ToolResult;
        try {
          result = await context.callTool(name, args, client);
        } catch (err) {
          result = { text: err instanceof Error ? err.message : 'Tool failed', isError: true };
        }
        const out: Record<string, unknown> = {
          content: [{ type: 'text', text: result.text }],
          isError: Boolean(result.isError),
        };
        if (result.structured !== undefined) out.structuredContent = result.structured;
        return out;
      }
      default:
        return new RpcErrorResult(RPC_METHOD_NOT_FOUND, `Method not found: ${method.slice(0, 80)}`);
    }
  };

  return {
    async handle(message) {
      const request = record(message);
      if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
        const id = request && (typeof request.id === 'string' || typeof request.id === 'number') ? request.id : null;
        return rpcError(id, RPC_INVALID_REQUEST, 'Invalid request');
      }
      const hasId = 'id' in request;
      const id: RpcId = typeof request.id === 'string' || typeof request.id === 'number' ? request.id : null;
      // Notifications (no id), such as notifications/initialized, need no answer.
      if (!hasId) return null;

      const params = request.params === undefined ? {} : record(request.params);
      if (!params) return rpcError(id, RPC_INVALID_PARAMS, 'Params must be an object');
      const meta = record(params._meta);
      const version = meta?.[VERSION_KEY];
      const modern = typeof version === 'string';
      if (modern && !(MODERN_VERSIONS as readonly string[]).includes(version)) {
        return rpcError(id, RPC_UNSUPPORTED_VERSION, 'Unsupported protocol version', {
          supported: [...MODERN_VERSIONS],
          requested: version,
        });
      }
      const client = (modern ? clientName(meta?.[CLIENT_INFO_KEY]) : legacyClient) || 'An MCP client';

      const result = await run(request.method, params, client);
      if (result instanceof RpcErrorResult) return rpcError(id, result.code, result.message);
      return { jsonrpc: '2.0', id, result: modern ? { resultType: 'complete', ...result } : result };
    },
  };
}

/** stdio framing: one JSON-RPC message per line. Overlong lines are dropped, not buffered forever. */
export function createLineReader(onLine: (line: string) => void, maxLine = 1_000_000): (chunk: string) => void {
  let buffer = '';
  let skipping = false;
  return (chunk) => {
    buffer += chunk;
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      const line = buffer.slice(0, newline).replace(/\r$/, '');
      buffer = buffer.slice(newline + 1);
      if (skipping) {
        skipping = false;
        continue;
      }
      if (line.trim()) onLine(line);
    }
    if (buffer.length > maxLine) {
      buffer = '';
      skipping = true;
    }
  };
}
