import net from 'node:net';
import type { IpcMain } from 'electron';
import { Client, type ClientChannel } from 'ssh2';
import { IPC_CHANNELS, type SSHConnectionConfig } from '@magicterm/shared';
import { evaluateHostKey } from './known-hosts';
import { READY_TIMEOUT_MS, friendlyConnectError } from './ssh';
import {
  LOOPBACK,
  SOCKS_REPLY,
  friendlyChannelError,
  friendlyListenError,
  friendlyRemoteListenError,
  listenAddress,
  parseSocksGreeting,
  parseSocksRequest,
  socksReply,
  validatePreset,
  type PortForwardPreset,
  type PortForwardStatus,
} from '../common/port-forward';

/**
 * Forwards run on their own SSH connection, one per tab, so splitting or
 * closing terminal panes does not cut them. The connection opens with the
 * first forward and closes with the last one or with the tab.
 */
interface ForwardHost {
  key: string;
  ownerId: number;
  sender: Electron.WebContents;
  client: Client | null;
  connecting: Promise<Client> | null;
  forwards: Map<string, ActiveForward>;
}

interface ActiveForward {
  preset: PortForwardPreset;
  status: PortForwardStatus;
  server: net.Server | null;
  /** Port the server bound for a remote forward. */
  remoteBound: { address: string; port: number } | null;
  /** Piped connections; their number is the status counter. */
  sockets: Set<net.Socket>;
  /** Connections still waiting for the server to open a channel. */
  pending: Set<net.Socket>;
  channels: Set<ClientChannel>;
  emitTimer: ReturnType<typeof setTimeout> | null;
}

const hosts = new Map<string, ForwardHost>();
const watchedSenders = new Set<number>();
const SOCKS_HANDSHAKE_TIMEOUT_MS = 30000;

function safeSend(sender: Electron.WebContents, channel: string, ...args: unknown[]): void {
  try {
    if (!sender.isDestroyed()) sender.send(channel, ...args);
  } catch {
  }
}

function emit(host: ForwardHost, forward: ActiveForward, immediate = false): void {
  const send = () => {
    forward.emitTimer = null;
    safeSend(host.sender, IPC_CHANNELS.PORT_FORWARD_STATUS, host.key, { ...forward.status });
  };
  if (immediate) {
    if (forward.emitTimer) clearTimeout(forward.emitTimer);
    send();
    return;
  }
  // Browsers open many connections at once; batch the counter updates.
  if (!forward.emitTimer) forward.emitTimer = setTimeout(send, 150);
}

function setState(host: ForwardHost, forward: ActiveForward, patch: Partial<PortForwardStatus>): void {
  forward.status = { ...forward.status, ...patch };
  emit(host, forward, true);
}

function closeForwardResources(host: ForwardHost, forward: ActiveForward): void {
  if (forward.emitTimer) {
    clearTimeout(forward.emitTimer);
    forward.emitTimer = null;
  }
  for (const socket of forward.sockets) socket.destroy();
  forward.sockets.clear();
  for (const socket of forward.pending) socket.destroy();
  forward.pending.clear();
  for (const channel of forward.channels) {
    try {
      channel.close();
    } catch {
    }
  }
  forward.channels.clear();
  forward.server?.close();
  forward.server = null;
  if (forward.remoteBound && host.client) {
    const { address, port } = forward.remoteBound;
    try {
      host.client.unforwardIn(address, port);
    } catch {
    }
  }
  forward.remoteBound = null;
}

function closeHostIfIdle(host: ForwardHost): void {
  if (host.forwards.size > 0) return;
  hosts.delete(host.key);
  const client = host.client;
  host.client = null;
  try {
    client?.end();
  } catch {
  }
}

function stopForward(host: ForwardHost, presetId: string): void {
  const forward = host.forwards.get(presetId);
  if (!forward) return;
  host.forwards.delete(presetId);
  closeForwardResources(host, forward);
  safeSend(host.sender, IPC_CHANNELS.PORT_FORWARD_STATUS, host.key, {
    presetId,
    state: 'stopped',
    connections: 0,
  } satisfies PortForwardStatus);
  closeHostIfIdle(host);
}

function stopHost(host: ForwardHost): void {
  for (const presetId of [...host.forwards.keys()]) stopForward(host, presetId);
  closeHostIfIdle(host);
}

export function cleanupAllForwards(): void {
  for (const host of [...hosts.values()]) stopHost(host);
}

function stopOwnedBy(ownerId: number): void {
  for (const host of [...hosts.values()]) {
    if (host.ownerId === ownerId) stopHost(host);
  }
}

function watchSender(sender: Electron.WebContents): void {
  if (watchedSenders.has(sender.id)) return;
  watchedSenders.add(sender.id);
  const ownerId = sender.id;
  sender.once('destroyed', () => {
    watchedSenders.delete(ownerId);
    stopOwnedBy(ownerId);
  });
  // A reload drops every tab in the renderer; drop their forwards too.
  sender.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) stopOwnedBy(ownerId);
  });
}

function onClientLost(host: ForwardHost, client: Client, reason: string): void {
  if (host.client !== client) return;
  host.client = null;
  for (const forward of host.forwards.values()) {
    forward.remoteBound = null;
    closeForwardResources(host, forward);
    setState(host, forward, { state: 'error', error: reason, connections: 0 });
  }
}

function connectClient(host: ForwardHost, config: SSHConnectionConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let hostKeyError: string | null = null;

    client.on('ready', () => {
      settled = true;
      host.client = client;
      resolve(client);
    });
    client.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(new Error(hostKeyError ?? friendlyConnectError(err)));
        return;
      }
      onClientLost(host, client, `Connection to the server failed: ${friendlyConnectError(err)}`);
    });
    client.on('close', () => {
      if (!settled) {
        settled = true;
        reject(new Error(hostKeyError ?? 'The server closed the connection.'));
        return;
      }
      onClientLost(host, client, 'Connection to the server closed. Turn the forward on again to reconnect.');
    });
    client.on('tcp connection', (info, accept, reject) => {
      const forward = [...host.forwards.values()].find(
        (f) => f.preset.kind === 'remote' && f.remoteBound?.port === info.destPort
      );
      if (!forward) {
        reject();
        return;
      }
      handleRemoteConnection(host, forward, accept, reject);
    });

    client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.authType === 'password' ? config.password : undefined,
      privateKey: config.authType === 'key' ? config.privateKey : undefined,
      keepaliveInterval: 10000,
      keepaliveCountMax: 3,
      readyTimeout: READY_TIMEOUT_MS,
      hostVerifier: (key: Buffer) => {
        const decision = evaluateHostKey(config.host, config.port, key);
        if (decision.kind === 'trusted') return true;
        hostKeyError =
          decision.kind === 'unknown'
            ? "This server's host key is not trusted yet. Open a terminal to it and accept the key first."
            : "This server's host key has changed. Reconnect the terminal to review it.";
        return false;
      },
    });
  });
}

async function ensureClient(host: ForwardHost, config: SSHConnectionConfig): Promise<Client> {
  if (host.client) return host.client;
  if (!host.connecting) {
    host.connecting = connectClient(host, config).finally(() => {
      host.connecting = null;
    });
  }
  return host.connecting;
}

function track(host: ForwardHost, forward: ActiveForward, socket: net.Socket, channel: ClientChannel | null): void {
  forward.sockets.add(socket);
  if (channel) forward.channels.add(channel);
  forward.status.connections = forward.sockets.size;
  emit(host, forward);
  const done = () => {
    socket.destroy();
    if (channel) {
      try {
        channel.close();
      } catch {
      }
      forward.channels.delete(channel);
    }
    if (forward.sockets.delete(socket)) {
      forward.status.connections = forward.sockets.size;
      emit(host, forward);
    }
  };
  socket.on('close', done);
  socket.on('error', done);
  channel?.on('close', done);
  channel?.on('error', done);
}

function pipeBoth(socket: net.Socket, channel: ClientChannel): void {
  socket.pipe(channel);
  channel.pipe(socket);
}

function setWarning(host: ForwardHost, forward: ActiveForward, warning: string | undefined): void {
  if (forward.status.warning === warning) return;
  forward.status.warning = warning;
  emit(host, forward);
}

function handleLocalConnection(host: ForwardHost, forward: ActiveForward, socket: net.Socket): void {
  const client = host.client;
  const { targetHost, targetPort } = forward.preset;
  if (!client || !targetHost || !targetPort) {
    socket.destroy();
    return;
  }
  socket.pause();
  forward.pending.add(socket);
  socket.once('error', () => forward.pending.delete(socket));
  client.forwardOut(socket.remoteAddress ?? LOOPBACK, socket.remotePort ?? 0, targetHost, targetPort, (err, channel) => {
    forward.pending.delete(socket);
    if (err) {
      setWarning(host, forward, friendlyChannelError(err, `${targetHost}:${targetPort}`));
      socket.destroy();
      return;
    }
    if (socket.destroyed || !host.forwards.has(forward.preset.id)) {
      channel.close();
      return;
    }
    setWarning(host, forward, undefined);
    track(host, forward, socket, channel);
    pipeBoth(socket, channel);
  });
}

function socksCodeFor(err: Error): number {
  const message = err.message || '';
  if (/prohibited/i.test(message)) return SOCKS_REPLY.NOT_ALLOWED;
  if (/refused|connect failed/i.test(message)) return SOCKS_REPLY.CONNECTION_REFUSED;
  return SOCKS_REPLY.HOST_UNREACHABLE;
}

function handleSocksConnection(host: ForwardHost, forward: ActiveForward, socket: net.Socket): void {
  let buffer = Buffer.alloc(0);
  let stage: 'greeting' | 'request' = 'greeting';
  forward.pending.add(socket);
  socket.setTimeout(SOCKS_HANDSHAKE_TIMEOUT_MS, () => socket.destroy());
  socket.on('close', () => forward.pending.delete(socket));
  socket.on('error', () => socket.destroy());

  const fail = (reply: Buffer | undefined, message: string) => {
    socket.off('data', onData);
    setWarning(host, forward, message);
    if (reply) socket.end(reply);
    else socket.destroy();
  };

  const onData = (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (stage === 'greeting') {
      const greeting = parseSocksGreeting(buffer);
      if (greeting.kind === 'more') return;
      if (greeting.kind === 'error') {
        fail(greeting.reply, greeting.message);
        return;
      }
      socket.write(greeting.value.reply);
      buffer = buffer.subarray(greeting.consumed);
      stage = 'request';
    }
    const request = parseSocksRequest(buffer);
    if (request.kind === 'more') return;
    if (request.kind === 'error') {
      fail(request.reply, request.message);
      return;
    }
    socket.off('data', onData);
    socket.pause();
    socket.setTimeout(0);
    const rest = buffer.subarray(request.consumed);
    const { host: targetHost, port: targetPort } = request.value;
    const client = host.client;
    if (!client) {
      socket.end(socksReply(SOCKS_REPLY.GENERAL_FAILURE));
      return;
    }
    client.forwardOut(socket.remoteAddress ?? LOOPBACK, socket.remotePort ?? 0, targetHost, targetPort, (err, channel) => {
      forward.pending.delete(socket);
      if (err) {
        setWarning(host, forward, friendlyChannelError(err, `${targetHost}:${targetPort}`));
        if (!socket.destroyed) socket.end(socksReply(socksCodeFor(err)));
        return;
      }
      if (socket.destroyed || !host.forwards.has(forward.preset.id)) {
        channel.close();
        return;
      }
      setWarning(host, forward, undefined);
      socket.write(socksReply(SOCKS_REPLY.SUCCEEDED));
      if (rest.length > 0) channel.write(rest);
      track(host, forward, socket, channel);
      pipeBoth(socket, channel);
    });
  };
  socket.on('data', onData);
}

function handleRemoteConnection(
  host: ForwardHost,
  forward: ActiveForward,
  accept: () => ClientChannel,
  reject: () => void
): void {
  const { targetHost, targetPort } = forward.preset;
  if (!targetHost || !targetPort) {
    reject();
    return;
  }
  const socket = net.createConnection({ host: targetHost, port: targetPort });
  socket.pause();
  socket.once('error', (err: NodeJS.ErrnoException) => {
    if (socket.connecting || !socket.remoteAddress) {
      const reason = err.code === 'ECONNREFUSED' ? 'nothing is listening there' : err.code || err.message;
      setWarning(host, forward, `Could not connect to ${targetHost}:${targetPort} on this computer: ${reason}.`);
      reject();
    }
  });
  socket.once('connect', () => {
    if (!host.forwards.has(forward.preset.id)) {
      socket.destroy();
      reject();
      return;
    }
    let channel: ClientChannel;
    try {
      channel = accept();
    } catch {
      socket.destroy();
      return;
    }
    setWarning(host, forward, undefined);
    track(host, forward, socket, channel);
    pipeBoth(socket, channel);
  });
}

function listenLocal(host: ForwardHost, forward: ActiveForward): Promise<void> {
  const preset = forward.preset;
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      if (preset.kind === 'dynamic') handleSocksConnection(host, forward, socket);
      else handleLocalConnection(host, forward, socket);
    });
    const onStartupError = (err: NodeJS.ErrnoException) => {
      reject(new Error(friendlyListenError(err, preset.listenPort)));
    };
    server.once('error', onStartupError);
    server.listen(preset.listenPort, listenAddress(preset), () => {
      server.off('error', onStartupError);
      server.on('error', (err: NodeJS.ErrnoException) => {
        closeForwardResources(host, forward);
        setState(host, forward, { state: 'error', error: friendlyListenError(err, preset.listenPort), connections: 0 });
      });
      forward.server = server;
      resolve();
    });
  });
}

function listenRemote(forward: ActiveForward, client: Client): Promise<void> {
  const preset = forward.preset;
  const address = listenAddress(preset);
  return new Promise((resolve, reject) => {
    client.forwardIn(address, preset.listenPort, (err, port) => {
      if (err) {
        reject(new Error(friendlyRemoteListenError(preset.listenPort)));
        return;
      }
      forward.remoteBound = { address, port: port || preset.listenPort };
      resolve();
    });
  });
}

/** A port another running forward of this app already listens on. */
function portUsedElsewhere(preset: PortForwardPreset, self: ForwardHost): boolean {
  const side = preset.kind === 'remote' ? 'server' : 'local';
  if (side === 'server') return false;
  for (const host of hosts.values()) {
    for (const forward of host.forwards.values()) {
      if (host === self && forward.preset.id === preset.id) continue;
      if (forward.status.state !== 'listening' && forward.status.state !== 'starting') continue;
      if (forward.preset.kind !== 'remote' && forward.preset.listenPort === preset.listenPort) return true;
    }
  }
  return false;
}

async function startForward(
  host: ForwardHost,
  config: SSHConnectionConfig,
  preset: PortForwardPreset
): Promise<PortForwardStatus> {
  if (host.forwards.has(preset.id)) {
    const existing = host.forwards.get(preset.id)!;
    host.forwards.delete(preset.id);
    closeForwardResources(host, existing);
  }

  const forward: ActiveForward = {
    preset,
    status: { presetId: preset.id, state: 'starting', connections: 0 },
    server: null,
    remoteBound: null,
    sockets: new Set(),
    pending: new Set(),
    channels: new Set(),
    emitTimer: null,
  };

  if (portUsedElsewhere(preset, host)) {
    forward.status = {
      ...forward.status,
      state: 'error',
      error: `Port ${preset.listenPort} is already used by another forward in MagicTerm.`,
    };
    hosts.set(host.key, host);
    host.forwards.set(preset.id, forward);
    emit(host, forward, true);
    return forward.status;
  }

  hosts.set(host.key, host);
  host.forwards.set(preset.id, forward);
  emit(host, forward, true);

  const stillWanted = () => host.forwards.get(preset.id) === forward;
  try {
    const client = await ensureClient(host, config);
    if (!stillWanted()) return { presetId: preset.id, state: 'stopped', connections: 0 };
    if (preset.kind === 'remote') await listenRemote(forward, client);
    else await listenLocal(host, forward);
    if (!stillWanted()) {
      closeForwardResources(host, forward);
      return { presetId: preset.id, state: 'stopped', connections: 0 };
    }
    setState(host, forward, { state: 'listening', error: undefined, warning: undefined });
  } catch (err) {
    if (!stillWanted()) return { presetId: preset.id, state: 'stopped', connections: 0 };
    closeForwardResources(host, forward);
    setState(host, forward, {
      state: 'error',
      error: err instanceof Error ? err.message : 'Could not start the forward.',
    });
  }
  return { ...forward.status };
}

function getOwnedHost(key: string, sender: Electron.WebContents): ForwardHost | null {
  const host = hosts.get(key);
  if (!host || host.ownerId !== sender.id) return null;
  return host;
}

export function setupPortForwardHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    IPC_CHANNELS.PORT_FORWARD_START,
    async (event, key: string, config: SSHConnectionConfig, preset: PortForwardPreset) => {
      if (typeof key !== 'string' || !key || !config || !preset || typeof preset.id !== 'string') {
        return { presetId: preset?.id ?? '', state: 'error', error: 'Invalid request.', connections: 0 };
      }
      const invalid = validatePreset(preset);
      if (invalid) return { presetId: preset.id, state: 'error', error: invalid, connections: 0 };

      let host = hosts.get(key);
      if (host && host.ownerId !== event.sender.id) {
        return { presetId: preset.id, state: 'error', error: 'Invalid request.', connections: 0 };
      }
      if (!host) {
        host = {
          key,
          ownerId: event.sender.id,
          sender: event.sender,
          client: null,
          connecting: null,
          forwards: new Map(),
        };
      }
      watchSender(event.sender);
      const status = await startForward(host, config, preset);
      if (status.state === 'error') {
        // Keep the error visible in the list, but release the connection if nothing runs.
        const running = [...host.forwards.values()].some((f) => f.status.state === 'listening' || f.status.state === 'starting');
        if (!running && host.client) {
          const client = host.client;
          host.client = null;
          try {
            client.end();
          } catch {
          }
        }
      }
      return status;
    }
  );

  ipcMain.handle(IPC_CHANNELS.PORT_FORWARD_STOP, async (event, key: string, presetId: string) => {
    const host = getOwnedHost(key, event.sender);
    if (host) stopForward(host, presetId);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.PORT_FORWARD_STOP_ALL, async (event, key: string) => {
    const host = getOwnedHost(key, event.sender);
    if (host) stopHost(host);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.PORT_FORWARD_LIST, async (event, key: string) => {
    const host = getOwnedHost(key, event.sender);
    if (!host) return [];
    return [...host.forwards.values()].map((f) => ({ ...f.status }));
  });
}
