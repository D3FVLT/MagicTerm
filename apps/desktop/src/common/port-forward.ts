/**
 * Port forwarding presets and the pure parts of running them: validation,
 * labels, error text and the SOCKS5 handshake. Shared by main and renderer.
 */

export type PortForwardKind = 'local' | 'remote' | 'dynamic';

export interface PortForwardPreset {
  id: string;
  kind: PortForwardKind;
  /** Optional name shown in the list. */
  label?: string;
  /**
   * local, dynamic: port on this computer.
   * remote: port on the server.
   */
  listenPort: number;
  /**
   * local: host and port as seen from the server.
   * remote: host and port as seen from this computer.
   * dynamic: unused.
   */
  targetHost?: string;
  targetPort?: number;
  /**
   * Listen on every interface instead of loopback. On this computer that
   * lets other devices on the network use the forward; for a remote forward
   * the server also needs `GatewayPorts` enabled in sshd_config.
   */
  allInterfaces?: boolean;
  /** Start the forward when a tab to this server connects. */
  autoStart?: boolean;
}

export type PortForwardState = 'starting' | 'listening' | 'error' | 'stopped';

export interface PortForwardStatus {
  presetId: string;
  state: PortForwardState;
  /** Why the forward is not running. */
  error?: string;
  /** Last connection through a running forward that failed. The listener keeps running. */
  warning?: string;
  /** Number of open connections through the forward. */
  connections: number;
}

export const LOOPBACK = '127.0.0.1';

export const KIND_LABELS: Record<PortForwardKind, string> = {
  local: 'Local',
  remote: 'Remote',
  dynamic: 'SOCKS',
};

export function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535;
}

/** Host names, IPv4 and IPv6 literals. No spaces, schemes, paths or ports. */
export function isValidHost(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const host = value.trim();
  if (!host || host.length > 253 || host !== value) return false;
  if (host.includes(':')) return /^[0-9a-fA-F:.]+$/.test(host);
  return /^[A-Za-z0-9._-]+$/.test(host);
}

/** Returns a sentence describing what is wrong with the preset, or null. */
export function validatePreset(preset: PortForwardPreset): string | null {
  if (preset.kind !== 'local' && preset.kind !== 'remote' && preset.kind !== 'dynamic') {
    return 'Choose local, remote or SOCKS.';
  }
  if (!isValidPort(preset.listenPort)) {
    return preset.kind === 'remote'
      ? 'Server port must be a number from 1 to 65535.'
      : 'Local port must be a number from 1 to 65535.';
  }
  if (preset.kind === 'dynamic') return null;
  if (!isValidHost(preset.targetHost)) {
    return preset.kind === 'local'
      ? 'Enter the host to reach from the server, for example 127.0.0.1.'
      : 'Enter the host to reach from this computer, for example 127.0.0.1.';
  }
  if (!isValidPort(preset.targetPort)) {
    return 'Destination port must be a number from 1 to 65535.';
  }
  return null;
}

/**
 * Two presets of one server cannot listen on the same port: local and SOCKS
 * forwards share this computer's ports, remote forwards share the server's.
 */
export function findPortClash(
  presets: PortForwardPreset[],
  candidate: PortForwardPreset
): PortForwardPreset | null {
  const side = (p: PortForwardPreset) => (p.kind === 'remote' ? 'server' : 'local');
  return (
    presets.find(
      (p) => p.id !== candidate.id && side(p) === side(candidate) && p.listenPort === candidate.listenPort
    ) ?? null
  );
}

/** Parses the decrypted preset list, dropping anything malformed. */
export function parsePresets(json: string | null | undefined): PortForwardPreset[] {
  if (!json) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const presets: PortForwardPreset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const value = item as Record<string, unknown>;
    if (typeof value.id !== 'string' || !value.id) continue;
    const preset: PortForwardPreset = {
      id: value.id,
      kind: value.kind as PortForwardKind,
      listenPort: value.listenPort as number,
    };
    if (typeof value.label === 'string' && value.label.trim()) preset.label = value.label.trim();
    if (preset.kind !== 'dynamic') {
      preset.targetHost = value.targetHost as string;
      preset.targetPort = value.targetPort as number;
    }
    if (value.allInterfaces === true) preset.allInterfaces = true;
    if (value.autoStart === true) preset.autoStart = true;
    if (validatePreset(preset)) continue;
    presets.push(preset);
  }
  return presets;
}

export function serializePresets(presets: PortForwardPreset[]): string {
  return JSON.stringify(presets);
}

/** Address the listener binds to. */
export function listenAddress(preset: PortForwardPreset): string {
  if (preset.kind === 'remote') return preset.allInterfaces ? '' : 'localhost';
  return preset.allInterfaces ? '0.0.0.0' : LOOPBACK;
}

function hostPort(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`;
}

/** One-line description, for example `127.0.0.1:8080 → 127.0.0.1:80 on the server`. */
export function describePreset(preset: PortForwardPreset): string {
  const target = hostPort(preset.targetHost ?? '', preset.targetPort ?? 0);
  if (preset.kind === 'local') {
    const local = preset.allInterfaces ? `*:${preset.listenPort}` : hostPort(LOOPBACK, preset.listenPort);
    return `${local} → ${target} on the server`;
  }
  if (preset.kind === 'remote') {
    const remote = preset.allInterfaces ? `*:${preset.listenPort}` : `localhost:${preset.listenPort}`;
    return `${remote} on the server → ${target}`;
  }
  const local = preset.allInterfaces ? `*:${preset.listenPort}` : hostPort(LOOPBACK, preset.listenPort);
  return `SOCKS5 proxy on ${local}`;
}

/** What to open or paste on this computer to use a running forward. Null for remote forwards. */
export function localAddress(preset: PortForwardPreset): string | null {
  if (preset.kind === 'remote') return null;
  return hostPort(LOOPBACK, preset.listenPort);
}

/** http(s) link for local forwards to common web ports. */
export function browserUrl(preset: PortForwardPreset): string | null {
  if (preset.kind !== 'local') return null;
  const scheme = preset.targetPort === 443 || preset.targetPort === 8443 ? 'https' : 'http';
  return `${scheme}://${hostPort(LOOPBACK, preset.listenPort)}`;
}

/** Error from listening on a port on this computer. */
export function friendlyListenError(err: { code?: string; message?: string }, port: number): string {
  switch (err.code) {
    case 'EADDRINUSE':
      return `Port ${port} is already in use on this computer.`;
    case 'EACCES':
      return `Not allowed to listen on port ${port} on this computer. Use a port above 1023.`;
    case 'EADDRNOTAVAIL':
      return 'This computer has no such address to listen on.';
    default:
      return err.message || `Could not listen on port ${port}.`;
  }
}

/** Error from asking the server to listen (ssh -R). */
export function friendlyRemoteListenError(port: number): string {
  return (
    `The server refused to listen on port ${port}. The port may be in use, ports below 1024 need root, `
    + 'or remote forwarding is turned off (AllowTcpForwarding in sshd_config).'
  );
}

/** Error from opening a channel through the server (ssh -L, -D). */
export function friendlyChannelError(err: { message?: string; reason?: number | string }, target: string): string {
  const message = err.message || '';
  if (/administratively prohibited|prohibited/i.test(message)) {
    return `The server does not allow forwarding (AllowTcpForwarding in sshd_config). Tried ${target}.`;
  }
  if (/connect failed|Connection refused/i.test(message)) {
    return `The server could not connect to ${target}: nothing is listening there.`;
  }
  if (/resolve|unknown host|Name or service/i.test(message)) {
    return `The server could not resolve ${target}.`;
  }
  return `The server could not open ${target}${message ? `: ${message}` : '.'}`;
}

// SOCKS5 (RFC 1928): no authentication, CONNECT only.

export type SocksParse<T> =
  | { kind: 'more' }
  | { kind: 'error'; reply?: Buffer; message: string }
  | { kind: 'ok'; value: T; consumed: number };

/** Client greeting: VER NMETHODS METHODS. Replies with "no authentication" or "no acceptable method". */
export function parseSocksGreeting(buf: Buffer): SocksParse<{ reply: Buffer }> {
  if (buf.length < 2) return { kind: 'more' };
  if (buf[0] !== 0x05) {
    return { kind: 'error', message: 'Only SOCKS5 is supported. Use socks5:// or socks5h://.' };
  }
  const count = buf[1];
  if (buf.length < 2 + count) return { kind: 'more' };
  const methods = buf.subarray(2, 2 + count);
  if (!methods.includes(0x00)) {
    return {
      kind: 'error',
      reply: Buffer.from([0x05, 0xff]),
      message: 'The SOCKS client asked for authentication, which this proxy does not use.',
    };
  }
  return { kind: 'ok', value: { reply: Buffer.from([0x05, 0x00]) }, consumed: 2 + count };
}

export const SOCKS_REPLY = {
  SUCCEEDED: 0x00,
  GENERAL_FAILURE: 0x01,
  NOT_ALLOWED: 0x02,
  HOST_UNREACHABLE: 0x04,
  CONNECTION_REFUSED: 0x05,
  COMMAND_NOT_SUPPORTED: 0x07,
  ADDRESS_NOT_SUPPORTED: 0x08,
} as const;

/** Reply with a zero IPv4 bind address, which clients ignore for CONNECT. */
export function socksReply(code: number): Buffer {
  return Buffer.from([0x05, code, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
}

/** Request: VER CMD RSV ATYP DST.ADDR DST.PORT. */
export function parseSocksRequest(buf: Buffer): SocksParse<{ host: string; port: number }> {
  if (buf.length < 4) return { kind: 'more' };
  if (buf[0] !== 0x05) return { kind: 'error', reply: socksReply(SOCKS_REPLY.GENERAL_FAILURE), message: 'Bad SOCKS request.' };
  if (buf[1] !== 0x01) {
    return {
      kind: 'error',
      reply: socksReply(SOCKS_REPLY.COMMAND_NOT_SUPPORTED),
      message: 'Only SOCKS CONNECT is supported.',
    };
  }
  const atyp = buf[3];
  let host: string;
  let offset: number;
  if (atyp === 0x01) {
    if (buf.length < 4 + 4 + 2) return { kind: 'more' };
    host = Array.from(buf.subarray(4, 8)).join('.');
    offset = 8;
  } else if (atyp === 0x03) {
    if (buf.length < 5) return { kind: 'more' };
    const len = buf[4];
    if (buf.length < 5 + len + 2) return { kind: 'more' };
    host = buf.subarray(5, 5 + len).toString('utf8');
    offset = 5 + len;
  } else if (atyp === 0x04) {
    if (buf.length < 4 + 16 + 2) return { kind: 'more' };
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) parts.push(buf.readUInt16BE(4 + i).toString(16));
    host = parts.join(':');
    offset = 20;
  } else {
    return {
      kind: 'error',
      reply: socksReply(SOCKS_REPLY.ADDRESS_NOT_SUPPORTED),
      message: 'Unknown SOCKS address type.',
    };
  }
  const port = buf.readUInt16BE(offset);
  return { kind: 'ok', value: { host, port }, consumed: offset + 2 };
}
