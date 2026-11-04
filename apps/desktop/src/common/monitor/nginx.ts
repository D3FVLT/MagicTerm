/**
 * Reads server blocks out of `nginx -T` output (or config files printed in the same
 * format). Only what the Services monitor needs: names, listen, root, certificate and
 * where requests are passed to.
 */

export interface NginxDirective {
  name: string;
  args: string[];
  block: NginxDirective[] | null;
  file: string;
}

export interface NginxUpstream {
  host: string;
  port: number;
}

export interface NginxProxy {
  location: string;
  target: string;
  upstreams: NginxUpstream[];
}

export interface NginxServer {
  domains: string[];
  listen: string[];
  ssl: boolean;
  root: string | null;
  certificate: string | null;
  proxies: NginxProxy[];
  file: string;
}

const FILE_HEADER = /^# configuration file (.+):$/;

/** Splits the dump into files, in order. The first file is the main config. */
export function splitNginxDump(dump: string): { path: string; text: string }[] {
  const files: { path: string; text: string }[] = [];
  let current: { path: string; lines: string[] } | null = null;
  for (const line of dump.split('\n')) {
    const header = FILE_HEADER.exec(line.trimEnd());
    if (header) {
      if (current) files.push({ path: current.path, text: current.lines.join('\n') });
      current = { path: header[1], lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) files.push({ path: current.path, text: current.lines.join('\n') });
  return files;
}

type Token = { kind: 'word'; value: string } | { kind: '{' | '}' | ';' };

/** nginx unescapes only quotes, backslash, \t, \r and \n; other escapes stay as written, as in regexes. */
function unescape(next: string): string {
  if (next === '"' || next === "'" || next === '\\') return next;
  if (next === 't') return '\t';
  if (next === 'r') return '\r';
  if (next === 'n') return '\n';
  return `\\${next}`;
}

export function tokenizeNginx(text: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '{' || c === '}' || c === ';') {
      tokens.push({ kind: c });
      i++;
      continue;
    }
    let word = '';
    if (c === '"' || c === "'") {
      i++;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\' && i + 1 < text.length) {
          word += unescape(text[i + 1]);
          i += 2;
          continue;
        }
        word += text[i++];
      }
      i++;
      tokens.push({ kind: 'word', value: word });
      continue;
    }
    while (i < text.length) {
      const d = text[i];
      if (/\s/.test(d) || d === ';' || d === '}') break;
      if (d === '{') {
        // ${var} inside a word is a variable, not a block.
        if (word.endsWith('$')) {
          const end = text.indexOf('}', i);
          if (end === -1) break;
          word += text.slice(i, end + 1);
          i = end + 1;
          continue;
        }
        break;
      }
      if (d === '\\' && i + 1 < text.length) {
        word += unescape(text[i + 1]);
        i += 2;
        continue;
      }
      word += d;
      i++;
    }
    tokens.push({ kind: 'word', value: word });
  }
  return tokens;
}

export function parseNginxFile(text: string, file: string): NginxDirective[] {
  const tokens = tokenizeNginx(text);
  let pos = 0;
  const parseBlock = (): NginxDirective[] => {
    const out: NginxDirective[] = [];
    while (pos < tokens.length) {
      const token = tokens[pos];
      if (token.kind === '}') {
        pos++;
        return out;
      }
      if (token.kind !== 'word') {
        pos++;
        continue;
      }
      const name = token.value;
      const args: string[] = [];
      pos++;
      let block: NginxDirective[] | null = null;
      while (pos < tokens.length) {
        const next = tokens[pos];
        if (next.kind === 'word') {
          args.push(next.value);
          pos++;
        } else if (next.kind === ';') {
          pos++;
          break;
        } else if (next.kind === '{') {
          pos++;
          block = parseBlock();
          break;
        } else {
          break;
        }
      }
      out.push({ name, args, block, file });
    }
    return out;
  };
  return parseBlock();
}

function globToRegExp(pattern: string): RegExp {
  let out = '';
  for (const c of pattern) {
    if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|\\[\]]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function dirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index <= 0 ? '/' : path.slice(0, index);
}

/** Parses every file and inlines `include` directives that point at files in the dump. */
export function parseNginxDump(dump: string): NginxDirective[] {
  const files = splitNginxDump(dump);
  if (files.length === 0) return [];
  const parsed = new Map(files.map((f) => [f.path, parseNginxFile(f.text, f.path)]));
  const prefix = dirname(files[0].path);
  const expand = (directives: NginxDirective[], depth: number): NginxDirective[] => {
    const out: NginxDirective[] = [];
    for (const directive of directives) {
      if (directive.name === 'include' && directive.args[0] && depth < 10) {
        const pattern = directive.args[0].startsWith('/') ? directive.args[0] : `${prefix}/${directive.args[0]}`;
        const match = globToRegExp(pattern);
        const paths = [...parsed.keys()].filter((path) => match.test(path)).sort();
        for (const path of paths) out.push(...expand(parsed.get(path) ?? [], depth + 1));
        continue;
      }
      out.push(directive.block ? { ...directive, block: expand(directive.block, depth) } : directive);
    }
    return out;
  };
  return expand(parsed.get(files[0].path) ?? [], 0);
}

function defaultPort(scheme: string): number {
  return scheme === 'https' || scheme === 'grpcs' ? 443 : 80;
}

/** host:port, [v6]:port or a bare host; null for unix sockets and variables. */
export function parseHostPort(value: string, fallbackPort: number): NginxUpstream | null {
  if (!value || value.startsWith('unix:') || value.includes('$')) return null;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (v6) return { host: v6[1], port: v6[2] ? Number(v6[2]) : fallbackPort };
  const index = value.lastIndexOf(':');
  if (index > 0 && /^\d+$/.test(value.slice(index + 1))) {
    return { host: value.slice(0, index), port: Number(value.slice(index + 1)) };
  }
  return { host: value, port: fallbackPort };
}

function resolveTarget(target: string, upstreams: Map<string, NginxUpstream[]>): NginxUpstream[] {
  const url = /^([a-z]+):\/\/([^/]*)/i.exec(target);
  const scheme = url ? url[1].toLowerCase() : '';
  const authority = url ? url[2] : target;
  if (authority.includes('$') || authority.startsWith('unix:')) return [];
  const named = upstreams.get(authority);
  if (named) return named;
  const single = parseHostPort(authority, url ? defaultPort(scheme) : 80);
  return single ? [single] : [];
}

const PASS_DIRECTIVES = new Set(['proxy_pass', 'fastcgi_pass', 'uwsgi_pass', 'grpc_pass', 'scgi_pass']);

/** Server blocks inside `http`, with upstream names resolved. */
export function nginxServers(dump: string): NginxServer[] {
  const root = parseNginxDump(dump);
  const http = root.filter((d) => d.name === 'http' && d.block).flatMap((d) => d.block ?? []);

  const upstreams = new Map<string, NginxUpstream[]>();
  for (const directive of http) {
    if (directive.name !== 'upstream' || !directive.block || !directive.args[0]) continue;
    const servers = directive.block
      .filter((d) => d.name === 'server' && d.args[0])
      .map((d) => parseHostPort(d.args[0], 80))
      .filter((u): u is NginxUpstream => u !== null);
    upstreams.set(directive.args[0], servers);
  }

  const servers: NginxServer[] = [];
  for (const directive of http) {
    if (directive.name !== 'server' || !directive.block) continue;
    const block = directive.block;
    const values = (name: string) => block.filter((d) => d.name === name);
    const domains = values('server_name')
      .flatMap((d) => d.args)
      .filter((name) => name && name !== '_' && !name.startsWith('~') && name !== '""');
    const listen = values('listen').map((d) => d.args.join(' '));
    const ssl = values('listen').some((d) => d.args.includes('ssl') || d.args.includes('quic'))
      || values('ssl').some((d) => d.args[0] === 'on');
    let rootPath = values('root')[0]?.args[0] ?? null;
    const proxies: NginxProxy[] = [];
    const walk = (directives: NginxDirective[], location: string) => {
      for (const d of directives) {
        if (d.name === 'location' && d.block) {
          const label = d.args.join(' ');
          if (!rootPath && label === '/') {
            const locationRoot = d.block.find((inner) => inner.name === 'root');
            if (locationRoot?.args[0]) rootPath = locationRoot.args[0];
          }
          walk(d.block, label);
        } else if (PASS_DIRECTIVES.has(d.name) && d.args[0]) {
          proxies.push({ location, target: d.args[0], upstreams: resolveTarget(d.args[0], upstreams) });
        }
      }
    };
    walk(block, '/');
    servers.push({
      domains: [...new Set(domains)],
      listen,
      ssl,
      root: rootPath,
      certificate: values('ssl_certificate')[0]?.args[0] ?? null,
      proxies,
      file: directive.file,
    });
  }
  return servers;
}
