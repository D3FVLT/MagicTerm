/**
 * Start, stop, restart and reload for each manager, and nginx test and reload. Each action is
 * one script on the background connection. Root is used only when the script can get it:
 * as root, through sudo without a password, or with a password the user typed in MagicTerm;
 * when sudo needs a password and none was given, the script stops and says so, instead of
 * waiting for a prompt nobody can answer.
 */
import { DOCKER_INIT, PM2_BIN_FN, prelude, shQuote, splitSections } from './script.js';
import type { DiscoveredService } from './types.js';

export type ServiceAction = 'start' | 'stop' | 'restart' | 'reload';
export type NginxAction = 'test' | 'reload';

export type ActionRequest =
  | { kind: 'service'; service: DiscoveredService; action: ServiceAction }
  | { kind: 'nginx'; action: NginxAction; systemd: boolean };

export interface ActionResult {
  /** Exit code of the action itself; null when it did not run or was killed. */
  exitCode: number | null;
  /** stdout and stderr together, as the action printed them. */
  output: string;
  /** Unit status after a systemd action, to show why it failed. */
  status: string;
  /** sudo needs a password and none was given; ask the user and run again with it. */
  needsSudo: boolean;
  wrongPassword: boolean;
  /** No root and no sudo for this user at all. */
  noRoot: boolean;
  timedOut: boolean;
}

const SAFE_UNIT = /^[\w@.:-]+\.service$/;
const SAFE_ID = /^[0-9a-f]{12,64}$/;
const SAFE_USER = /^[a-z_][a-z0-9_.-]{0,31}$/i;

export const ACTION_LABELS: Record<ServiceAction, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
  reload: 'Reload',
};

/**
 * Actions that make sense for a service in its current state. Hand-started processes get
 * none, and systemd units none where systemd is not running.
 */
export function availableActions(service: DiscoveredService, state = service.state, systemdRunning = true): ServiceAction[] {
  if (service.kind === 'process') return [];
  if (service.kind === 'systemd' && !systemdRunning) return [];
  const running = state === 'running' || state === 'starting' || state === 'restarting';
  const list: ServiceAction[] = [];
  if (!running) list.push('start');
  if (running || state === 'unknown') list.push('restart', 'stop');
  if ((running || state === 'unknown') && (service.kind === 'pm2' || (service.kind === 'systemd' && service.canReload))) {
    list.push('reload');
  }
  if (state === 'unknown' && !list.includes('start')) list.unshift('start');
  return list;
}

/** Everything but starting a stopped service and testing nginx is confirmed first. */
export function isRiskyAction(request: ActionRequest): boolean {
  if (request.kind === 'nginx') return request.action === 'reload';
  return request.action !== 'start';
}

function pm2User(service: DiscoveredService): string | null {
  const user = service.id.split(':')[1] ?? service.user ?? '';
  return SAFE_USER.test(user) ? user : null;
}

/** The command as a person would type it, for confirmations and approvals. */
export function describeAction(request: ActionRequest, loginUser: string): string {
  const sudo = loginUser === 'root' ? '' : 'sudo ';
  if (request.kind === 'nginx') {
    if (request.action === 'test') return `${sudo}nginx -t`;
    return `${sudo}nginx -t && ${request.systemd ? `${sudo}systemctl reload nginx` : `${sudo}nginx -s reload`}`;
  }
  const { service, action } = request;
  if (service.kind === 'systemd') return `${sudo}systemctl ${action} ${service.id.slice('systemd:'.length)}`;
  if (service.kind === 'docker') return `docker ${action === 'reload' ? 'restart' : action} ${service.name}`;
  if (service.kind === 'pm2') {
    const user = pm2User(service) ?? '?';
    const as = user === loginUser ? '' : loginUser === 'root' ? `runuser -u ${user} -- ` : `sudo -u ${user} `;
    return `${as}pm2 ${action} ${service.name}`;
  }
  return '';
}

/** Says why root is missing and stops the script, or returns so the action runs. */
const NEED_ROOT = `mt_need_root() {
  case $PRIV in
    root|sudo) return 0;;
    needs-password) sec needs-sudo; sec end; exit 0;;
    wrong-password) sec wrong-password; sec end; exit 0;;
    *) sec no-root; sec end; exit 0;;
  esac
}`;

function serviceBody(service: DiscoveredService, action: ServiceAction): string | null {
  if (service.kind === 'systemd') {
    const unit = service.id.slice('systemd:'.length);
    if (!SAFE_UNIT.test(unit)) return null;
    return `mt_need_root
sec output
( asroot $TL systemctl ${action} ${shQuote(unit)} ) 2>&1 </dev/null
rc=$?
sec result $rc
sec status
asroot systemctl status ${shQuote(unit)} --no-pager -n 15 2>&1 </dev/null | head -n 40`;
  }
  if (service.kind === 'docker') {
    const id = service.docker?.id;
    if (!id || !SAFE_ID.test(id)) return null;
    const verb = action === 'reload' ? 'restart' : action;
    return `${DOCKER_INIT}
if [ -z "$MT_DK" ]; then mt_need_root; fi
sec output
( dk ${verb} ${id} ) 2>&1
rc=$?
sec result $rc`;
  }
  if (service.kind === 'pm2') {
    const user = pm2User(service);
    if (!user) return null;
    // As the login user directly; for another user through runuser as root or sudo -u.
    return `${PM2_BIN_FN}
u=${shQuote(user)}
home=$(getent passwd "$u" 2>/dev/null | cut -d: -f6)
[ -n "$home" ] || home=$(awk -F: -v u="$u" '$1 == u { print $6 }' /etc/passwd)
bin=$(mt_pm2bin "$home")
if [ -z "$bin" ]; then sec output; echo "pm2 was not found for $u."; sec result 127; sec end; exit 0; fi
d=\${bin%/*}
[ "$u" = "$ME" ] || mt_need_root
sec output
if [ "$u" = "$ME" ]; then
  ( PM2_HOME="$home/.pm2" PATH="$d:$PATH" $TL "$bin" ${action} ${shQuote(service.name)} ) 2>&1 </dev/null
elif [ $PRIV = root ] && have runuser; then
  ( runuser -u "$u" -- env PM2_HOME="$home/.pm2" PATH="$d:$PATH" $TL "$bin" ${action} ${shQuote(service.name)} ) 2>&1 </dev/null
elif [ $PRIV = root ]; then
  ( su -s /bin/sh "$u" -c 'PM2_HOME="$1" PATH="$2:$PATH" "$3" "$4" "$5"' mt "$home/.pm2" "$d" "$bin" ${action} ${shQuote(service.name)} ) 2>&1 </dev/null
else
  ( sudo_run -u "$u" env PM2_HOME="$home/.pm2" PATH="$d:$PATH" $TL "$bin" ${action} ${shQuote(service.name)} ) 2>&1
fi
rc=$?
sec result $rc`;
  }
  return null;
}

function nginxBody(action: NginxAction, systemd: boolean): string {
  const reload = systemd ? 'asroot $TL systemctl reload nginx' : 'asroot $TL nginx -s reload';
  return `mt_need_root
sec output
( asroot $TL nginx -t ) 2>&1 </dev/null
rc=$?
${action === 'reload' ? `if [ $rc -eq 0 ]; then
  echo '--- nginx -t passed, reloading'
  ( ${reload} ) 2>&1 </dev/null
  rc=$?
else
  echo '--- nginx -t failed, nginx was not reloaded'
fi` : ''}
sec result $rc`;
}

/** null when the request names something MagicTerm will not put in a command line. */
export function buildActionScript(nonce: string, request: ActionRequest): string | null {
  const body = request.kind === 'nginx' ? nginxBody(request.action, request.systemd) : serviceBody(request.service, request.action);
  if (!body) return null;
  return `${prelude(nonce)}
TL=
have timeout && TL='timeout 120'
${NEED_ROOT}
${body}
sec end
`;
}

const MAX_OUTPUT = 64 * 1024;

export function parseActionOutput(output: string, nonce: string, timedOut = false): ActionResult {
  const sections = splitSections(output, nonce);
  const one = (name: string) => sections.find((s) => s.name === name);
  const result = one('result');
  const code = result ? Number(result.args[0]) : NaN;
  const text = one('output')?.body ?? '';
  return {
    exitCode: Number.isInteger(code) ? code : null,
    output: text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text,
    status: (one('status')?.body ?? '').slice(0, 16 * 1024),
    needsSudo: Boolean(one('needs-sudo')),
    wrongPassword: Boolean(one('wrong-password')),
    noRoot: Boolean(one('no-root')),
    timedOut: timedOut || !one('end'),
  };
}

/** One line for logs and MCP replies. */
export function summarizeActionResult(result: ActionResult): string {
  if (result.needsSudo) return 'sudo needs a password.';
  if (result.wrongPassword) return 'sudo did not accept the password.';
  if (result.noRoot) return 'This needs root, and the login user cannot use sudo.';
  if (result.timedOut && result.exitCode === null) return 'Timed out before the server answered.';
  if (result.exitCode === 0) return 'Done, exit code 0.';
  return `Failed, exit code ${result.exitCode ?? 'unknown'}.`;
}
