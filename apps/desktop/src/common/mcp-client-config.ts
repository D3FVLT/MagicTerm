export interface McpLaunch {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export type McpClient = 'claude' | 'cursor' | 'codex';

/** macOS caps a unix socket path at 104 bytes and Linux at 108. */
const MAX_SOCKET_PATH = 100;

/**
 * Where the app listens for MCP clients. A user data folder with a long path would push
 * the socket past the limit, so it then goes in the per-user temp folder instead.
 */
export function mcpSocketPathFor(platform: string, userData: string, tempDir: string, scope: string): string {
  if (platform === 'win32') return `\\\\.\\pipe\\magicterm-mcp-${scope}`;
  const preferred = `${userData.replace(/\/+$/, '')}/mcp.sock`;
  if (new TextEncoder().encode(preferred).length <= MAX_SOCKET_PATH) return preferred;
  return `${tempDir.replace(/\/+$/, '')}/magicterm-mcp-${scope}.sock`;
}

function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** What to paste into each client to launch MagicTerm's MCP relay. */
export function mcpClientSnippet(client: McpClient, launch: McpLaunch): string {
  if (client === 'claude') {
    const env = Object.entries(launch.env).map(([key, value]) => `-e ${key}=${shellQuote(value)}`);
    return ['claude mcp add magicterm --scope user', ...env, '--', ...[launch.command, ...launch.args].map(shellQuote)].join(' ');
  }
  if (client === 'cursor') {
    return JSON.stringify({ mcpServers: { magicterm: launch } }, null, 2);
  }
  // TOML basic strings use the same escapes as JSON for these paths.
  const env = Object.entries(launch.env).map(([key, value]) => `${key} = ${JSON.stringify(value)}`).join(', ');
  return [
    '[mcp_servers.magicterm]',
    `command = ${JSON.stringify(launch.command)}`,
    `args = [${launch.args.map((arg) => JSON.stringify(arg)).join(', ')}]`,
    `env = { ${env} }`,
  ].join('\n');
}
