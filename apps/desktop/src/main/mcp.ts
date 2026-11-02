import { app, BrowserWindow, IpcMain } from 'electron';
import Store from 'electron-store';
import { createHash, randomUUID } from 'crypto';
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'fs';
import { createServer, type Server as NetServer, type Socket } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { IPC_CHANNELS, STORAGE_KEYS, type SSHConnectionConfig } from '@magicterm/shared';
import { createLineReader, createMcpSession, rpcError, RPC_PARSE_ERROR, type ToolResult } from '../common/mcp-protocol';
import { MCP_INSTRUCTIONS, MCP_TOOLS, parseMcpSettings, type McpSettings } from '../common/mcp-tools';
import { mcpSocketPathFor } from '../common/mcp-client-config';
import { execOverSsh } from './ssh-exec';

const store = new Store();

/** How long the user has to answer an approval prompt, on top of the command's own timeout. */
const APPROVAL_WINDOW_MS = 120_000;
const READ_TOOL_TIMEOUT_MS = 15_000;
const MAX_CONNECTIONS = 8;

/**
 * Launched by Claude Code, Cursor or Codex as `ELECTRON_RUN_AS_NODE=1 <MagicTerm> mcp-stdio.cjs <socket>`.
 * It only relays bytes between the client's stdio and the running app, so it holds no secrets
 * and needs no dependencies. Written to the user data folder, outside the app archive.
 */
const SHIM_SOURCE = `'use strict';
const net = require('net');
const socket = net.connect(process.argv[2]);
socket.on('error', (err) => {
  process.stderr.write('MagicTerm MCP: cannot reach MagicTerm. Open it and turn on AI tools (MCP) in Settings. ' + err.message + '\\n');
  process.exit(1);
});
process.stdin.pipe(socket);
socket.pipe(process.stdout);
process.stdin.on('end', () => socket.end());
socket.on('close', () => process.exit(0));
`;

let server: NetServer | null = null;
const connections = new Set<Socket>();
const pendingCalls = new Map<string, { resolve: (result: ToolResult) => void; timer: NodeJS.Timeout }>();

function readSettings(): McpSettings {
  return parseMcpSettings(store.get(STORAGE_KEYS.MCP));
}

export function mcpSocketPath(): string {
  const userData = app.getPath('userData');
  const scope = createHash('sha256').update(userData).digest('hex').slice(0, 12);
  return mcpSocketPathFor(process.platform, userData, tmpdir(), scope);
}

function shimPath(): string {
  return join(app.getPath('userData'), 'mcp-stdio.cjs');
}

function mainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
}

/** Tools run in the renderer: that is where the vault is decrypted and where the user approves. */
function forwardToRenderer(name: string, args: Record<string, unknown>, client: string): Promise<ToolResult> {
  const window = mainWindow();
  if (!window) return Promise.resolve({ text: 'MagicTerm has no open window.', isError: true });

  const timeoutSeconds = typeof args.timeout_seconds === 'number' ? Math.min(Math.max(args.timeout_seconds, 1), 600) : 60;
  const waitMs = name === 'run_command' ? APPROVAL_WINDOW_MS + timeoutSeconds * 1000 + 30_000 : READ_TOOL_TIMEOUT_MS;
  if (name === 'run_command') {
    if (window.isMinimized()) window.restore();
    window.show();
    app.dock?.bounce('informational');
  }

  const callId = randomUUID();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pendingCalls.delete(callId);
      resolve({ text: 'MagicTerm did not answer in time.', isError: true });
    }, waitMs);
    pendingCalls.set(callId, { resolve, timer });
    window.webContents.send(IPC_CHANNELS.MCP_CALL, { callId, name, args, client });
  });
}

function serveConnection(socket: Socket): void {
  if (connections.size >= MAX_CONNECTIONS) {
    socket.destroy();
    return;
  }
  connections.add(socket);
  socket.setEncoding('utf8');
  const session = createMcpSession({
    serverInfo: { name: 'MagicTerm', version: app.getVersion() },
    instructions: MCP_INSTRUCTIONS,
    tools: MCP_TOOLS,
    callTool: forwardToRenderer,
  });
  const send = (message: unknown) => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  };
  const read = createLineReader((line) => {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      send(rpcError(null, RPC_PARSE_ERROR, 'Parse error'));
      return;
    }
    void session.handle(message).then((response) => {
      if (response) send(response);
    });
  });
  socket.on('data', (chunk: string) => read(chunk));
  socket.on('error', () => socket.destroy());
  socket.on('close', () => connections.delete(socket));
}

function start(): void {
  if (server) return;
  const path = mcpSocketPath();
  if (process.platform !== 'win32' && existsSync(path)) {
    try {
      unlinkSync(path);
    } catch {
      // Another MagicTerm may own it; listen() below reports that.
    }
  }
  writeFileSync(shimPath(), SHIM_SOURCE, { mode: 0o600 });
  const next = createServer(serveConnection);
  next.on('error', (err) => {
    console.error('[MCP] socket error:', err.message);
    if (server === next) server = null;
  });
  // The socket must never be reachable by other users, not even before the chmod below.
  const previousUmask = process.platform === 'win32' ? null : process.umask(0o177);
  next.listen(path, () => {
    if (previousUmask !== null) process.umask(previousUmask);
    if (process.platform !== 'win32') chmodSync(path, 0o600);
  });
  next.once('error', () => {
    if (previousUmask !== null) process.umask(previousUmask);
  });
  server = next;
}

export function stopMcp(): void {
  for (const socket of connections) socket.destroy();
  connections.clear();
  for (const [callId, pending] of pendingCalls) {
    clearTimeout(pending.timer);
    pending.resolve({ text: 'AI tools were turned off in MagicTerm.', isError: true });
    pendingCalls.delete(callId);
  }
  server?.close();
  server = null;
}

export function setupMcpHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(IPC_CHANNELS.MCP_SETTINGS_GET, async () => ({ success: true, settings: readSettings() }));

  ipcMain.handle(IPC_CHANNELS.MCP_SETTINGS_SET, async (_event, input: unknown) => {
    const settings = parseMcpSettings(input);
    store.set(STORAGE_KEYS.MCP, settings);
    if (settings.enabled) start();
    else stopMcp();
    return { success: true, settings };
  });

  ipcMain.handle(IPC_CHANNELS.MCP_CLIENT_CONFIG, async () => ({
    success: true,
    config: {
      command: process.execPath,
      args: [shimPath(), mcpSocketPath()],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
  }));

  ipcMain.handle(IPC_CHANNELS.MCP_RESULT, async (event, callId: unknown, result: unknown) => {
    if (typeof callId !== 'string') return { success: false };
    const pending = pendingCalls.get(callId);
    if (!pending || event.sender !== mainWindow()?.webContents) return { success: false };
    clearTimeout(pending.timer);
    pendingCalls.delete(callId);
    const raw = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    pending.resolve({
      text: typeof raw.text === 'string' ? raw.text.slice(0, 200_000) : 'No result',
      isError: raw.isError === true,
      structured: raw.structured,
    });
    return { success: true };
  });

  ipcMain.handle(
    IPC_CHANNELS.MCP_EXEC,
    async (_event, config: SSHConnectionConfig, command: unknown, timeoutSeconds: unknown) => {
      if (typeof command !== 'string' || !command.trim() || command.length > 8000) {
        return { success: false, error: 'Bad command' };
      }
      const seconds = typeof timeoutSeconds === 'number' && timeoutSeconds >= 1 && timeoutSeconds <= 600 ? timeoutSeconds : 60;
      try {
        const result = await execOverSsh(config, command, { timeoutMs: seconds * 1000 });
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message.slice(0, 300) : 'Command failed' };
      }
    }
  );

  if (readSettings().enabled) start();
}
