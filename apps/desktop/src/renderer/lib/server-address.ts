import { DEFAULT_SSH_PORT, type Server } from '@magicterm/shared';

export interface ServerAddress {
  host: string;
  port: number;
  username: string;
}

/** Host with the port appended when it is not the default, e.g. `10.0.0.5:2222`. */
export function hostWithPort(host: string, port: number): string {
  return port && port !== DEFAULT_SSH_PORT ? `${host}:${port}` : host;
}

/**
 * Two servers are the same only when user, host and port all match, so one IP can hold
 * several instances on different ports (issue #20) or several accounts on one port.
 * Stored host and username are ciphertext; entries that fail to decrypt are skipped.
 */
export async function assertUniqueAddress(
  servers: Server[],
  target: ServerAddress,
  decrypt: (ciphertext: string) => Promise<string>,
  ignoreId?: string
): Promise<void> {
  const host = target.host.trim().toLowerCase();
  for (const existing of servers) {
    if (existing.id === ignoreId || existing.port !== target.port) continue;
    let existingHost: string;
    let existingUser: string;
    try {
      existingHost = await decrypt(existing.host);
      existingUser = await decrypt(existing.username);
    } catch {
      continue;
    }
    if (existingHost.trim().toLowerCase() === host && existingUser === target.username) {
      throw new Error(`Server ${target.username}@${hostWithPort(target.host, target.port)} already exists`);
    }
  }
}

/** The address an edit would leave the server with, decrypting the fields it does not change. */
export async function addressAfterEdit(
  current: Server,
  input: Partial<ServerAddress>,
  decrypt: (ciphertext: string) => Promise<string>
): Promise<ServerAddress> {
  return {
    host: input.host ?? (await decrypt(current.host)),
    port: input.port ?? current.port,
    username: input.username ?? (await decrypt(current.username)),
  };
}

export function changesAddress(input: Partial<ServerAddress>): boolean {
  return input.host !== undefined || input.port !== undefined || input.username !== undefined;
}
