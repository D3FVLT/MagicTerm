import { Client } from 'ssh2';
import type { SSHConnectionConfig } from '@magicterm/shared';
import type { ExecResult } from '../common/mcp-tools';
import { evaluateHostKey } from './known-hosts';
import { friendlyConnectError } from './ssh';

const MAX_STREAM_BYTES = 64 * 1024;
const READY_TIMEOUT_MS = 20_000;

/** A host key the user has not trusted, with what the host-key dialog needs to ask about it. */
export class HostKeyError extends Error {
  constructor(
    message: string,
    readonly challenge: {
      code: 'host_key_unknown' | 'host_key_mismatch';
      host: string;
      port: number;
      fingerprint: string;
      storedFingerprint?: string;
    }
  ) {
    super(message);
  }
}

/**
 * Opens a connection for background work (AI tools, the Services monitor). Unlike the
 * interactive terminal it never asks about host keys: only a key the user already trusted
 * in MagicTerm is accepted. Errors are already worded for people.
 */
export function connectTrusted(config: SSHConnectionConfig, options: { keepalive?: boolean } = {}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let ready = false;
    let hostKeyProblem: HostKeyError | null = null;

    client.on('ready', () => {
      ready = true;
      resolve(client);
    });
    client.on('error', (err) => {
      if (!ready) reject(hostKeyProblem ?? new Error(friendlyConnectError(err)));
    });

    client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.authType === 'password' ? config.password : undefined,
      privateKey: config.authType === 'key' ? config.privateKey : undefined,
      readyTimeout: READY_TIMEOUT_MS,
      keepaliveInterval: options.keepalive ? 15_000 : undefined,
      keepaliveCountMax: options.keepalive ? 3 : undefined,
      hostVerifier: (key: Buffer) => {
        const decision = evaluateHostKey(config.host, config.port, key);
        if (decision.kind === 'trusted') return true;
        hostKeyProblem = decision.kind === 'unknown'
          ? new HostKeyError(
            'MagicTerm has not trusted this server\'s host key yet. Open a terminal to it in MagicTerm once and accept the key.',
            { code: 'host_key_unknown', host: config.host, port: config.port, fingerprint: decision.fingerprint }
          )
          : new HostKeyError(
            'The server\'s host key changed since MagicTerm trusted it. Check it in MagicTerm before running commands.',
            {
              code: 'host_key_mismatch',
              host: config.host,
              port: config.port,
              fingerprint: decision.fingerprint,
              storedFingerprint: decision.storedFingerprint,
            }
          );
        return false;
      },
    });
  });
}

/**
 * Runs one command on an open connection. `stdin` is written and closed; output past
 * `maxBytes` per stream is dropped and reported as truncated.
 */
export function runOnClient(
  client: Client,
  command: string,
  options: { timeoutMs: number; stdin?: string; maxBytes?: number }
): Promise<ExecResult> {
  const maxBytes = options.maxBytes ?? MAX_STREAM_BYTES;
  return new Promise((resolve, reject) => {
    const chunks = { stdout: [] as Buffer[], stderr: [] as Buffer[] };
    const sizes = { stdout: 0, stderr: 0 };
    let truncated = false;
    let settled = false;
    let timer: NodeJS.Timeout | null = null;

    const text = (stream: 'stdout' | 'stderr') => Buffer.concat(chunks[stream]).toString('utf8');
    const finish = (result: Omit<ExecResult, 'stdout' | 'stderr' | 'truncated'> | Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (result instanceof Error) reject(result);
      else resolve({ ...result, stdout: text('stdout'), stderr: text('stderr'), truncated });
    };

    const append = (stream: 'stdout' | 'stderr', data: Buffer) => {
      const room = maxBytes - sizes[stream];
      if (room <= 0) {
        truncated = true;
        return;
      }
      const piece = data.length > room ? data.subarray(0, room) : data;
      if (data.length > room) truncated = true;
      chunks[stream].push(piece);
      sizes[stream] += piece.length;
    };

    client.exec(command, (err, stream) => {
      if (err) {
        finish(err);
        return;
      }
      timer = setTimeout(() => {
        try {
          stream.signal('KILL');
          stream.close();
        } catch {
          // Closing below is enough.
        }
        finish({ exitCode: null, signal: null, timedOut: true });
      }, options.timeoutMs);
      stream.on('data', (data: Buffer) => append('stdout', data));
      stream.stderr.on('data', (data: Buffer) => append('stderr', data));
      stream.on('close', (code: number | null, signal?: string) => {
        finish({ exitCode: typeof code === 'number' ? code : null, signal: signal ?? null, timedOut: false });
      });
      if (options.stdin !== undefined) stream.end(options.stdin);
    });
  });
}

export interface RunningStream {
  /** Closes stdin, which the followed-log scripts take as the signal to stop; the channel closes 3 s later at the latest. */
  stop: () => void;
}

/**
 * Starts a long-running command whose output arrives as it is printed. `stdin` is written
 * and left open, so the command can watch it for EOF.
 */
export function streamOnClient(
  client: Client,
  command: string,
  options: {
    stdin: string;
    onData: (text: string) => void;
    onClose: (result: { exitCode: number | null; error: string | null }) => void;
  }
): RunningStream {
  let closed = false;
  let channel: import('ssh2').ClientChannel | null = null;
  let stopRequested = false;
  const finish = (exitCode: number | null, error: string | null) => {
    if (closed) return;
    closed = true;
    options.onClose({ exitCode, error });
  };
  const stopChannel = () => {
    if (!channel || closed) return;
    try {
      channel.end();
    } catch {
      // Closed below.
    }
    setTimeout(() => {
      try {
        channel?.close();
      } catch {
        // Already closed.
      }
    }, 3000).unref();
  };
  client.exec(command, (err, stream) => {
    if (err) {
      finish(null, err.message);
      return;
    }
    channel = stream;
    stream.on('data', (data: Buffer) => options.onData(data.toString('utf8')));
    stream.stderr.on('data', (data: Buffer) => options.onData(data.toString('utf8')));
    stream.on('close', (code: number | null) => finish(typeof code === 'number' ? code : null, null));
    stream.write(options.stdin);
    if (stopRequested) stopChannel();
  });
  return {
    stop: () => {
      stopRequested = true;
      stopChannel();
    },
  };
}

/** Runs one command on its own connection, for AI tools. */
export async function execOverSsh(
  config: SSHConnectionConfig,
  command: string,
  options: { timeoutMs: number }
): Promise<ExecResult> {
  const client = await connectTrusted(config);
  try {
    return await runOnClient(client, command, { timeoutMs: options.timeoutMs });
  } finally {
    try {
      client.end();
    } catch {
      // Already closed.
    }
  }
}
