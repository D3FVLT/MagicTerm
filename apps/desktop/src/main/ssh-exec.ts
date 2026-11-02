import { Client } from 'ssh2';
import type { SSHConnectionConfig } from '@magicterm/shared';
import type { ExecResult } from '../common/mcp-tools';
import { evaluateHostKey } from './known-hosts';
import { friendlyConnectError } from './ssh';

const MAX_STREAM_BYTES = 64 * 1024;
const READY_TIMEOUT_MS = 20_000;

/**
 * Runs one command on its own connection, for AI tools. Unlike the interactive terminal it
 * never asks about host keys: only a key the user already trusted in MagicTerm is accepted.
 */
export function execOverSsh(
  config: SSHConnectionConfig,
  command: string,
  options: { timeoutMs: number }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;
    let hostKeyProblem = '';
    const out = { stdout: '', stderr: '', truncated: false };
    let timer: NodeJS.Timeout | null = null;

    const finish = (result: ExecResult | Error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      try {
        client.end();
      } catch {
        // Already closed.
      }
      if (result instanceof Error) reject(result);
      else resolve(result);
    };

    const append = (stream: 'stdout' | 'stderr', data: Buffer) => {
      const room = MAX_STREAM_BYTES - Buffer.byteLength(out[stream]);
      if (room <= 0) {
        out.truncated = true;
        return;
      }
      const text = data.toString('utf8');
      if (Buffer.byteLength(text) > room) {
        out[stream] += data.subarray(0, room).toString('utf8');
        out.truncated = true;
      } else {
        out[stream] += text;
      }
    };

    client.on('ready', () => {
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
          finish({ exitCode: null, signal: null, ...out, timedOut: true });
        }, options.timeoutMs);
        stream.on('data', (data: Buffer) => append('stdout', data));
        stream.stderr.on('data', (data: Buffer) => append('stderr', data));
        stream.on('close', (code: number | null, signal?: string) => {
          finish({
            exitCode: typeof code === 'number' ? code : null,
            signal: signal ?? null,
            ...out,
            timedOut: false,
          });
        });
      });
    });

    client.on('error', (err) => {
      finish(new Error(hostKeyProblem || friendlyConnectError(err)));
    });

    client.connect({
      host: config.host,
      port: config.port,
      username: config.username,
      password: config.authType === 'password' ? config.password : undefined,
      privateKey: config.authType === 'key' ? config.privateKey : undefined,
      readyTimeout: READY_TIMEOUT_MS,
      hostVerifier: (key: Buffer) => {
        const decision = evaluateHostKey(config.host, config.port, key);
        if (decision.kind === 'trusted') return true;
        hostKeyProblem = decision.kind === 'unknown'
          ? 'MagicTerm has not trusted this server\'s host key yet. Open a terminal to it in MagicTerm once and accept the key.'
          : 'The server\'s host key changed since MagicTerm trusted it. Check it in MagicTerm before running commands.';
        return false;
      },
    });
  });
}
