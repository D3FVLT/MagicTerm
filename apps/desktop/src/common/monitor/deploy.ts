/**
 * Deploy scenarios: an ordered list of shell steps run in a project folder, stopping at the
 * first failure. Passwords are never in a command line or an environment variable:
 * git and sudo ask through an askpass helper that prints a marker and waits on a FIFO,
 * and MagicTerm writes the user's answer into that FIFO over a second channel.
 */
import { prelude, shQuote } from './script.js';
import type { DiscoveredService, DiscoveryResult, ProjectInfo } from './types.js';

export interface DeployScenario {
  /** Folder the steps run in. */
  cwd: string;
  /** One shell command per step; `{{name}}` placeholders are filled in before a run. */
  steps: string[];
  updatedAt: string;
}

export interface DeployStepResult {
  command: string;
  exitCode: number | null;
  durationMs: number | null;
}

export type DeployStatus = 'running' | 'succeeded' | 'failed' | 'cancelled' | 'error';

/** What history keeps of a run. Stored encrypted. */
export interface DeployRunRecord {
  id: string;
  serverId: string;
  serviceId: string;
  cwd: string;
  steps: DeployStepResult[];
  status: Exclude<DeployStatus, 'running'>;
  startedAt: string;
  finishedAt: string;
  /** "MagicTerm" or the AI tool that asked for it. */
  startedBy: string;
  /** Last part of the output. */
  output: string;
}

export const MAX_STEPS = 30;
export const MAX_STEP_LENGTH = 4000;
/** Each step may run this long before it is stopped. */
export const STEP_TIMEOUT_SECONDS = 900;
export const RECORD_OUTPUT_BYTES = 32 * 1024;

const SAFE_USER = /^[a-z_][a-z0-9_.-]{0,31}$/i;

function installStep(project: ProjectInfo): string | null {
  const files = new Set(project.markers);
  switch (project.packageManager) {
    case 'pnpm':
      return 'pnpm install --frozen-lockfile';
    case 'yarn':
      return 'yarn install --frozen-lockfile';
    case 'bun':
      return 'bun install --frozen-lockfile';
    case 'npm':
      return files.has('package-lock.json') ? 'npm ci' : 'npm install';
    case 'uv':
      return 'uv sync';
    case 'poetry':
      return 'poetry install';
    case 'pipenv':
      return 'pipenv install --deploy';
    case 'pip':
      return files.has('requirements.txt') ? 'pip install -r requirements.txt' : null;
    case 'composer':
      return 'composer install --no-dev --optimize-autoloader';
    case 'bundler':
      return 'bundle install';
    case 'cargo':
      return 'cargo build --release';
    case 'go':
      return 'go build ./...';
    default:
      return null;
  }
}

function restartStep(service: DiscoveredService, loginUser: string): string | null {
  const sudo = loginUser === 'root' ? '' : 'sudo ';
  if (service.kind === 'systemd') return `${sudo}systemctl restart ${service.id.slice('systemd:'.length)}`;
  if (service.kind === 'pm2') {
    const user = service.id.split(':')[1] ?? '';
    const name = /^[\w.-]+$/.test(service.name) ? service.name : shQuote(service.name);
    if (!user || user === loginUser) return `pm2 reload ${name}`;
    return SAFE_USER.test(user) ? `sudo -u ${user} -H bash -lc 'pm2 reload ${name.replace(/'/g, `'\\''`)}'` : null;
  }
  return null;
}

/**
 * A starting point from what the scan found: pull, install, build, restart. Steps that write
 * files run as the service's user when MagicTerm logs in as root, so they do not end up owned by root.
 */
export function suggestScenario(discovery: DiscoveryResult, service: DiscoveredService, now = new Date()): DeployScenario | null {
  const project = service.projectPath ? discovery.projects.find((p) => p.path === service.projectPath) : undefined;
  const loginUser = discovery.host.user;
  if (service.kind === 'docker' && service.docker?.composeProject && service.docker.composeService && service.cwd) {
    const svc = service.docker.composeService;
    const steps = [
      ...(project?.git?.remote ? ['git pull --ff-only'] : []),
      project?.markers.includes('Dockerfile') ? `docker compose up -d --build ${svc}` : `docker compose pull ${svc}`,
      ...(project?.markers.includes('Dockerfile') ? [] : [`docker compose up -d ${svc}`]),
    ];
    return { cwd: service.cwd, steps, updatedAt: now.toISOString() };
  }
  if (!project || !project.exists) return null;
  const cwd = project.git?.root ?? project.path;
  const owner = service.kind === 'pm2' ? service.id.split(':')[1] : service.user;
  const asOwner = (command: string) =>
    loginUser === 'root' && owner && owner !== 'root' && SAFE_USER.test(owner)
      ? `sudo -u ${owner} -H bash -lc ${shQuote(`cd ${shQuote(cwd)} && ${command}`)}`
      : command;
  const steps: string[] = [];
  if (project.git?.remote) steps.push(asOwner('git pull --ff-only'));
  const install = installStep(project);
  if (install) steps.push(asOwner(install));
  if (project.language === 'node' && project.scripts.includes('build')) {
    const pm = project.packageManager ?? 'npm';
    steps.push(asOwner(pm === 'npm' ? 'npm run build' : `${pm} run build`));
  }
  const restart = restartStep(service, loginUser);
  if (restart) steps.push(restart);
  if (steps.length === 0) return null;
  return { cwd, steps, updatedAt: now.toISOString() };
}

/** Problems that keep a scenario from running, in words for the user. */
export function validateScenario(scenario: DeployScenario): string | null {
  if (!scenario.cwd.startsWith('/') || /[\0\r\n]/.test(scenario.cwd)) return 'The folder must be an absolute path.';
  const steps = scenario.steps.map((s) => s.trim()).filter(Boolean);
  if (steps.length === 0) return 'Add at least one step.';
  if (steps.length > MAX_STEPS) return `A scenario can have up to ${MAX_STEPS} steps.`;
  if (steps.some((s) => s.length > MAX_STEP_LENGTH)) return `A step can be up to ${MAX_STEP_LENGTH} characters.`;
  if (steps.some((s) => s.includes('\0'))) return 'A step contains a NUL byte.';
  return null;
}

/** The loader reads the script up to this line from stdin and keeps stdin open to notice a cancel. */
export function deployRunner(nonce: string): string {
  return `sh -c 'IFS= read -r MT_PW; MT_S=$(sed -n "/^@@END_${nonce}$/q;p"); eval "$MT_S"'`;
}

export function deployInput(script: string, nonce: string): string {
  return `\n${script}\n@@END_${nonce}\n`;
}

/**
 * The deploy script. Markers it prints, each on its own line after "@@<nonce> ":
 * tmp <dir>, step <i>, step-end <i> <code>, ask <prompt>, done <code>, cancelled, fail <reason>.
 */
export function buildDeployScript(nonce: string, scenario: DeployScenario): string {
  const steps = scenario.steps.map((s) => s.trim()).filter(Boolean);
  const files = steps
    .map((step, i) => {
      const end = `MT_STEP_${nonce}_${i}`;
      return `cat > "$MT_T/s${i}" <<'${end}'
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
cd ${shQuote(scenario.cwd)} || exit 1
${step}
${end}`;
    })
    .join('\n');
  return `${prelude(nonce)}
MT_T=$(mktemp -d "\${TMPDIR:-/tmp}/mt-deploy.XXXXXX" 2>/dev/null) || { sec fail 'Could not create a temporary folder on the server.'; sec done 1; exit 0; }
chmod 700 "$MT_T"
trap 'rm -rf "$MT_T"' EXIT
if ! mkfifo "$MT_T/answer" 2>/dev/null; then sec fail 'mkfifo is not available, so MagicTerm cannot pass passwords safely.'; sec done 1; exit 0; fi
cat > "$MT_T/askpass" <<'MT_ASK_${nonce}'
#!/bin/sh
p=$(printf '%s' "$1" | tr -cd '[:print:]' | cut -c1-200)
printf '\\n@@${nonce} ask %s\\n' "$p" >&2
f="$(dirname "$0")/answer"
if command -v timeout >/dev/null 2>&1; then a=$(timeout 130 head -n 1 "$f"); else a=$(head -n 1 "$f"); fi
[ -n "$a" ] || exit 1
printf '%s\\n' "$a"
MT_ASK_${nonce}
chmod 700 "$MT_T/askpass"
mkdir "$MT_T/bin"
MT_SUDO=$(command -v sudo 2>/dev/null)
if [ -n "$MT_SUDO" ]; then
  printf '#!/bin/sh\\nexec %s -A "$@"\\n' "$MT_SUDO" > "$MT_T/bin/sudo"
  chmod 700 "$MT_T/bin/sudo"
fi
${files}
GIT_ASKPASS="$MT_T/askpass"
SUDO_ASKPASS="$MT_T/askpass"
GIT_TERMINAL_PROMPT=0
PATH="$MT_T/bin:$PATH"
export GIT_ASKPASS SUDO_ASKPASS GIT_TERMINAL_PROMPT PATH
[ -n "\${GIT_SSH_COMMAND:-}" ] || { GIT_SSH_COMMAND='ssh -o BatchMode=yes'; export GIT_SSH_COMMAND; }
unset SSH_ASKPASS DISPLAY MT_PW
MT_SH=sh
have bash && MT_SH='bash -l'
MT_TL=
have timeout && MT_TL='timeout ${STEP_TIMEOUT_SECONDS}'
sec tmp "$MT_T"
# A background list reads /dev/null, so the cancel watcher gets the real stdin as fd 3.
exec 3<&0
mt_run() {
  rc=0
  for i in ${steps.map((_, i) => i).join(' ')}; do
    sec step $i
    if have setsid; then setsid $MT_TL $MT_SH "$MT_T/s$i" </dev/null 2>&1 &
    else $MT_TL $MT_SH "$MT_T/s$i" </dev/null 2>&1 &
    fi
    echo $! > "$MT_T/pid"
    wait $!
    rc=$?
    sec step-end $i $rc
    [ $rc -eq 0 ] || break
  done
  touch "$MT_T/finished"
  sec done $rc
}
mt_run &
MT_RUN=$!
(
  cat <&3 >/dev/null
  if [ ! -f "$MT_T/finished" ]; then
    p=$(cat "$MT_T/pid" 2>/dev/null)
    sec cancelled
    [ -n "$p" ] && { kill -TERM -- "-$p" 2>/dev/null || kill -TERM "$p" 2>/dev/null; }
    kill $MT_RUN 2>/dev/null
  fi
) &
MT_WATCH=$!
wait $MT_RUN
touch "$MT_T/finished"
wait $MT_WATCH 2>/dev/null
`;
}

/** The second channel that hands an answer to the askpass helper. The answer goes on stdin. */
export function answerCommand(tmpDir: string): string | null {
  if (!/^\/[^\0\r\n]*\/mt-deploy\.[A-Za-z0-9]+$/.test(tmpDir) || /\/\.\.(\/|$)/.test(tmpDir)) return null;
  return `sh -c 'cat > "$1/answer"' mt ${shQuote(tmpDir)}`;
}

export type DeployEvent =
  | { type: 'output'; text: string }
  | { type: 'tmp'; dir: string }
  | { type: 'step'; index: number }
  | { type: 'step-end'; index: number; exitCode: number }
  | { type: 'ask'; prompt: string; secret: boolean }
  | { type: 'done'; exitCode: number }
  | { type: 'cancelled' }
  | { type: 'fail'; reason: string };

/** Events sent to the renderer for one run. `ask` carries an id the answer must quote. */
export type DeployRunEvent =
  | Exclude<DeployEvent, { type: 'ask' } | { type: 'tmp' }>
  | { type: 'ask'; askId: string; prompt: string; secret: boolean }
  | { type: 'closed'; error: string | null };

/** git asks for a user name in clear text; anything else is treated as a secret. */
export function isSecretPrompt(prompt: string): boolean {
  return !/^\s*username\b/i.test(prompt);
}

/**
 * Splits streamed output into events. Markers are whole lines; text is passed on as it
 * arrives, except a trailing piece that could be the start of a marker.
 */
export function createDeployParser(nonce: string): { push: (chunk: string) => DeployEvent[]; flush: () => DeployEvent[] } {
  const marker = `@@${nonce} `;
  let buffer = '';
  const parseLine = (line: string): DeployEvent | null => {
    const rest = line.slice(marker.length);
    const space = rest.indexOf(' ');
    const name = space === -1 ? rest : rest.slice(0, space);
    const args = space === -1 ? '' : rest.slice(space + 1);
    switch (name) {
      case 'tmp':
        return { type: 'tmp', dir: args };
      case 'step':
        return { type: 'step', index: Number(args) };
      case 'step-end': {
        const [index, code] = args.split(' ').map(Number);
        return { type: 'step-end', index, exitCode: code };
      }
      case 'ask':
        return { type: 'ask', prompt: args, secret: isSecretPrompt(args) };
      case 'done':
        return { type: 'done', exitCode: Number(args) };
      case 'cancelled':
        return { type: 'cancelled' };
      case 'fail':
        return { type: 'fail', reason: args };
      default:
        return null;
    }
  };
  // The script prints a newline before each marker. A trailing newline is held back until
  // the next chunk shows whether a marker follows, so that newline never reaches the text.
  let heldNewline = false;
  const take = (final: boolean): DeployEvent[] => {
    const events: DeployEvent[] = [];
    let text = heldNewline ? '\n' : '';
    heldNewline = false;
    const emitText = () => {
      if (text) events.push({ type: 'output', text });
      text = '';
    };
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (line.startsWith(marker)) {
        if (text.endsWith('\n')) text = text.slice(0, -1);
        emitText();
        const event = parseLine(line.replace(/\r$/, ''));
        if (event) events.push(event);
      } else {
        text += `${line}\n`;
      }
    }
    if (buffer && (final || (!marker.startsWith(buffer) && !buffer.startsWith(marker)))) {
      text += buffer;
      buffer = '';
    }
    if (!final && text.endsWith('\n')) {
      text = text.slice(0, -1);
      heldNewline = true;
    }
    emitText();
    return events;
  };
  return { push: (chunk) => {
    buffer += chunk;
    return take(false);
  }, flush: () => take(true) };
}
