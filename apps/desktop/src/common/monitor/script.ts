/**
 * Shell scripts the Services monitor runs on a server, and the splitter for their output.
 *
 * Every script is sent on stdin, never on the command line. The first stdin line is the
 * sudo password or an empty line; it stays in a shell variable of the outer shell, so it is
 * not in argv, the environment or shell history. The rest of stdin is the script itself.
 * Scripts print sections that start with a marker line holding a per-run nonce, so file
 * contents that happen to look like markers cannot break the parse.
 */

/** The exec command line. Constant: nothing secret and nothing server-specific in it. */
export const SCRIPT_RUNNER = `sh -c 'IFS= read -r MT_PW; eval "$(cat)"'`;

/** Stdin for SCRIPT_RUNNER. */
export function scriptInput(script: string, sudoPassword?: string): string {
  const password = sudoPassword ?? '';
  if (/[\r\n]/.test(password)) throw new Error('The password cannot contain a line break');
  return `${password}\n${script}\n`;
}

export function newNonce(): string {
  const bytes = new Uint8Array(9);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Quotes a value for POSIX sh. */
export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Shared prelude: PATH, timeouts, privilege detection and helpers. */
export function prelude(nonce: string): string {
  return `
PATH="$PATH:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
export PATH
LC_ALL=C
export LC_ALL
MT_N='@@${nonce}'
sec() { printf '\\n%s %s\\n' "$MT_N" "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
T=
have timeout && T='timeout 20'
ME=$(id -un 2>/dev/null)
sudo_run() {
  if [ -n "$MT_PW" ]; then printf '%s\\n' "$MT_PW" | sudo -S -p '' "$@"; else sudo -n "$@" </dev/null; fi
}
PRIV=limited
if [ "$(id -u 2>/dev/null)" = 0 ]; then PRIV=root
elif have sudo; then
  if sudo_run true >/dev/null 2>&1; then PRIV=sudo
  elif [ -n "$MT_PW" ]; then PRIV=wrong-password
  else
    case $(sudo -n true 2>&1 </dev/null) in *password*) PRIV=needs-password;; esac
  fi
fi
asroot() {
  case $PRIV in
    sudo) sudo_run "$@";;
    *) "$@";;
  esac
}
`;
}

/** Defines mt_pm2bin <home>: the pm2 command for a user, also when it comes from nvm, volta or pnpm. */
export const PM2_BIN_FN = `mt_pm2bin() {
  if have pm2; then command -v pm2; return; fi
  for b in "$1"/.nvm/versions/node/*/bin/pm2 "$1"/.volta/bin/pm2 "$1"/.npm-global/bin/pm2 "$1"/.local/share/pnpm/pm2 "$1"/.bun/bin/pm2 /usr/local/bin/pm2 /usr/bin/pm2; do
    [ -x "$b" ] && { printf '%s\\n' "$b"; return; }
  done
}
`;

/** Prints a pm2 section (jlist output) per user whose PM2 daemon is running. */
export const PM2_BLOCK = `${PM2_BIN_FN}
MT_PASSWD=$(getent passwd 2>/dev/null || cat /etc/passwd 2>/dev/null)
while IFS=: read -r u _ _ _ _ home _ <&3; do
  case $home in ''|/|/nonexistent|/dev/null) continue;; esac
  if [ "$u" = "$ME" ]; then
    [ -d "$home/.pm2" ] || continue
    pid=$(cat "$home/.pm2/pm2.pid" 2>/dev/null)
  else
    [ $PRIV = root ] || [ $PRIV = sudo ] || continue
    pid=$(asroot cat "$home/.pm2/pm2.pid" 2>/dev/null)
  fi
  case $pid in ''|*[!0-9]*) continue;; esac
  [ -d "/proc/$pid" ] || continue
  bin=$(mt_pm2bin "$home")
  if [ -z "$bin" ]; then sec pm2-skip "$u"; echo 'pm2 runs but its command was not found'; continue; fi
  d=\${bin%/*}
  sec pm2 "$u" "$home"
  if [ "$u" = "$ME" ]; then
    PM2_HOME="$home/.pm2" PATH="$d:$PATH" $T "$bin" jlist </dev/null 2>/dev/null
  elif [ $PRIV = root ] && have runuser; then
    runuser -u "$u" -- env PM2_HOME="$home/.pm2" PATH="$d:$PATH" $T "$bin" jlist </dev/null 2>/dev/null
  elif [ $PRIV = root ]; then
    su -s /bin/sh "$u" -c 'PM2_HOME="$1" PATH="$2:$PATH" "$3" jlist' mt "$home/.pm2" "$d" "$bin" </dev/null 2>/dev/null
  else
    sudo_run -u "$u" env PM2_HOME="$home/.pm2" PATH="$d:$PATH" $T "$bin" jlist 2>/dev/null
  fi
done 3<<MT_EOF
$MT_PASSWD
MT_EOF
`;

/** Sets MT_DK to plain or sudo when docker works, and defines dk(). */
export const DOCKER_INIT = `MT_DK=
  if $T docker ps -q >/dev/null 2>&1 </dev/null; then MT_DK=plain
  elif [ $PRIV = sudo ] && sudo_run $T docker ps -q >/dev/null 2>&1; then MT_DK=sudo
  fi
  dk() { if [ "$MT_DK" = sudo ]; then sudo_run $T docker "$@"; else $T docker "$@" </dev/null; fi; }`;

// .State is printed whole: newer Docker fails the template on .State.Health when a container has no health check.
const DOCKER_FORMAT = '{"id":{{json .Id}},"name":{{json .Name}},"image":{{json .Config.Image}},'
  + '"state":{{json .State}},'
  + '"restartCount":{{json .RestartCount}},"restartPolicy":{{json .HostConfig.RestartPolicy.Name}},'
  + '"labels":{{json .Config.Labels}},"ports":{{json .NetworkSettings.Ports}}}';

/**
 * Read-only discovery. Prints: meta, systemd or unitfile, pm2 / pm2-skip, docker / docker-skip,
 * nginx / nginx-files / nginx-error, listen, procs, pidinfo. Each probe is time-limited and
 * a missing tool or permission only removes its own section.
 */
export function buildDiscoveryScript(nonce: string): string {
  return `${prelude(nonce)}
sec meta
printf 'user=%s\\npriv=%s\\nhostname=%s\\nkernel=%s\\n' "$ME" "$PRIV" "$(hostname 2>/dev/null || cat /etc/hostname 2>/dev/null)" "$(uname -sr 2>/dev/null)"
[ -r /etc/os-release ] && printf 'os=%s\\n' "$(sed -n 's/^PRETTY_NAME=//p' /etc/os-release | tr -d '"')"
for t in systemctl pm2 docker nginx git ss; do have $t && printf 'tool=%s\\n' $t; done
[ -d /run/systemd/system ] && printf 'systemd=1\\n'

mt_units() {
  for f in /etc/systemd/system/*.service; do
    [ -f "$f" ] || continue
    if [ -L "$f" ]; then
      case $(readlink -f "$f") in /etc/systemd/system/*) ;; *) continue;; esac
    fi
    b=\${f##*/}
    case $b in *@.service) continue;; esac
    printf '%s\\n' "$b"
  done
}
MT_UNITS=$(mt_units)
if [ -n "$MT_UNITS" ]; then
  if have systemctl && [ -d /run/systemd/system ]; then
    sec systemd
    $T systemctl show --no-pager -p Id,Description,LoadState,ActiveState,SubState,MainPID,User,WorkingDirectory,ExecStart,UnitFileState,ActiveEnterTimestamp,StateChangeTimestamp,NRestarts,Result,CanReload $MT_UNITS 2>/dev/null
  else
    for u in $MT_UNITS; do
      sec unitfile "$u"
      head -c 16384 "/etc/systemd/system/$u" 2>/dev/null
    done
  fi
fi

${PM2_BLOCK}
if have docker; then
  ${DOCKER_INIT}
  if [ -n "$MT_DK" ]; then
    MT_IDS=$(dk ps -aq --no-trunc 2>/dev/null)
    sec docker
    [ -n "$MT_IDS" ] && dk inspect --format '${DOCKER_FORMAT}' $MT_IDS 2>/dev/null
  else
    sec docker-skip
    $T docker ps -q 2>&1 </dev/null | head -n 3
  fi
fi

if have nginx; then
  MT_NG=$(asroot $T nginx -T 2>&1)
  if [ $? -eq 0 ] && printf '%s' "$MT_NG" | grep -q '^# configuration file '; then
    sec nginx
    printf '%s\\n' "$MT_NG"
  else
    sec nginx-error
    printf '%s\\n' "$MT_NG" | grep -v '^#' | head -n 5
    sec nginx-files
    for f in /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf /etc/nginx/sites-enabled/*; do
      [ -f "$f" ] && [ -r "$f" ] || continue
      printf '# configuration file %s:\\n' "$f"
      head -c 262144 "$f"
      printf '\\n'
    done
  fi
fi

if have ss; then
  MT_SS=$(asroot $T ss -ltnp 2>/dev/null)
  [ -n "$MT_SS" ] || MT_SS=$($T ss -ltn 2>/dev/null)
  sec listen
  printf '%s\\n' "$MT_SS"
  MT_PIDS=$(printf '%s\\n' "$MT_SS" | sed -n 's/.*users:(("[^"]*",pid=\\([0-9]*\\),.*/\\1/p' | sort -un | head -n 200)
  if [ -n "$MT_PIDS" ]; then
    sec pidinfo
    asroot sh -c 'for p; do
      echo "== $p"
      head -n 5 "/proc/$p/cgroup" 2>/dev/null | sed "s/^/cgroup=/"
      echo "cwd=$(readlink "/proc/$p/cwd" 2>/dev/null)"
      echo "cmd=$(tr "\\000" " " < "/proc/$p/cmdline" 2>/dev/null | head -c 300)"
    done' mt $MT_PIDS 2>/dev/null
  fi
fi

sec procs
ps -eo pid=,ppid=,user=,comm= 2>/dev/null | head -n 5000
sec end
`;
}

const PROJECT_PROBE = `
cd "$1" 2>/dev/null || { echo 'missing=1'; exit 0; }
echo "files=$(ls -1A 2>/dev/null | head -n 200 | tr '\\n' '/')"
[ -f package.json ] && echo "package=$(head -c 16384 package.json | tr '\\n\\r' '  ')"
command -v git >/dev/null 2>&1 || exit 0
g() { git -c 'safe.directory=*' --no-optional-locks "$@" 2>/dev/null; }
top=$(g rev-parse --show-toplevel) || exit 0
[ -n "$top" ] || exit 0
echo "git.root=$top"
[ "$top" != "$(pwd -P)" ] && echo "topfiles=$(ls -1A "$top" 2>/dev/null | head -n 200 | tr '\\n' '/')"
echo "git.branch=$(g symbolic-ref --short -q HEAD)"
up=$(g rev-parse --abbrev-ref '@{u}')
echo "git.upstream=$up"
r=origin
[ -n "$up" ] && r=\${up%%/*}
echo "git.remote=$(g remote get-url "$r" | sed -E 's#(://)[^/@]*@#\\1#')"
[ -n "$up" ] && echo "git.counts=$(g rev-list --left-right --count '@{u}...HEAD')"
echo "git.dirty=$(g status --porcelain | wc -l | tr -d ' ')"
echo "git.last=$(g log -1 --format='%H%x09%ct%x09%s')"
gd=$(g rev-parse --absolute-git-dir)
[ -n "$gd" ] && echo "git.fetched=$(stat -c %Y "$gd/FETCH_HEAD" 2>/dev/null)"
exit 0
`;

/**
 * Second pass, for folders found by the first: marker files, package.json scripts and git.
 * Git runs with optional locks off, so it never rewrites the index, even as root.
 * Folders the login user cannot read are probed with sudo when that works without asking.
 */
export function buildProjectScript(nonce: string, paths: string[]): string {
  const list = paths.filter(isSafePath).map(shQuote).join(' ');
  return `${prelude(nonce)}
MT_PROBE=${shQuote(PROJECT_PROBE)}
for d in ${list || "''"}; do
  [ -n "$d" ] || continue
  sec project "$d"
  if [ -r "$d" ] && [ -x "$d" ]; then
    sh -c "$MT_PROBE" mt "$d" </dev/null
  elif [ $PRIV = sudo ] || [ $PRIV = root ]; then
    asroot sh -c "$MT_PROBE" mt "$d"
  else
    echo 'unreadable=1'
  fi
done
sec end
`;
}

/** Absolute, printable, no line breaks: anything else from a server is not used as a path. */
export function isSafePath(path: string): boolean {
  return path.startsWith('/') && path.length < 1024 && !/[\0\r\n]/.test(path);
}

export interface Section {
  name: string;
  args: string[];
  body: string;
}

/** Splits script output into sections. Text before the first marker is dropped. */
export function splitSections(output: string, nonce: string): Section[] {
  const marker = `@@${nonce} `;
  const sections: Section[] = [];
  let current: Section | null = null;
  let lines: string[] = [];
  const flush = () => {
    if (current) {
      // The marker is printed after a blank line; drop that line from the section before it.
      while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
      current.body = lines.join('\n');
      sections.push(current);
    }
  };
  for (const line of output.split('\n')) {
    if (line.startsWith(marker)) {
      flush();
      const [name = '', ...args] = line.slice(marker.length).trim().split(' ');
      current = { name, args, body: '' };
      lines = [];
    } else if (current) {
      lines.push(line.replace(/\r$/, ''));
    }
  }
  flush();
  return sections;
}
