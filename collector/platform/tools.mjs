// Finding the programs the collector runs (claude, gh, git, a terminal), on any system, with nothing set up
// beforehand: a service is started with a bare PATH (launchd, systemd), so the collector asks your login shell
// for the PATH your terminal has, and adds the folders these tools are usually installed in.
import { existsSync, lstatSync, statSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { dirname, posix, win32 } from 'node:path';
import { run } from '../lib/exec.mjs';

const isFile = p => {
  try {
    return statSync(p).isFile();
  } catch {
    if (process.platform !== 'win32') return false;
    // App execution aliases such as wt.exe are reparse points that stat cannot open.
    try { const s = lstatSync(p); return s.isFile() || s.isSymbolicLink(); } catch { return false; }
  }
};

/** On Windows, a path on another machine (\\host\share\…, //host/share/…) or a device (\\?\, \\.\): to look at it, Windows signs in there as you. */
export const isNetworkPath = (path, platform = process.platform) => platform === 'win32' && /^[\\/]{2}/.test(String(path ?? ''));
/**
 * May a path an agent named be looked at? Not one on another machine (a page an agent read could name any host,
 * and Windows would hand that host your sign-in), unless the session itself runs on that very share.
 */
export function mayLookAt(path, cwd, platform = process.platform) {
  if (!isNetworkPath(path, platform)) return true;
  const share = p => /^[\\/]{2}([^\\/?.][^\\/]*)[\\/]+([^\\/]+)/.exec(String(p ?? ''))?.slice(1, 3).join('\\').toLowerCase() ?? null;
  const mine = share(cwd);
  return mine !== null && share(path) === mine;
}

/** PATH's name in an environment: Windows spells it Path, and a child must get the one it reads. */
export const pathKey = (env = process.env) => Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';

/** The folders these tools are usually in, whether or not they exist here. */
export function usualDirs({ platform = process.platform, home = homedir(), env = process.env } = {}) {
  if (platform === 'win32') {
    const j = win32.join, local = env.LOCALAPPDATA ?? j(home, 'AppData', 'Local'), roaming = env.APPDATA ?? j(home, 'AppData', 'Roaming'), programs = env.ProgramFiles ?? 'C:\\Program Files';
    return [j(home, '.local', 'bin'), j(roaming, 'npm'), j(local, 'Microsoft', 'WinGet', 'Links'), j(local, 'Microsoft', 'WindowsApps'), j(programs, 'Git', 'cmd'), j(programs, 'GitHub CLI'), j(programs, 'LibreOffice', 'program'), j(home, '.bun', 'bin'), j(local, 'Volta', 'bin')];
  }
  const j = posix.join;
  return [j(home, '.local', 'bin'), j(home, '.claude', 'local'), j(home, 'bin'), j(home, '.npm-global', 'bin'), j(home, '.bun', 'bin'), j(home, '.volta', 'bin'),
    ...(platform === 'darwin' ? ['/opt/homebrew/bin', '/opt/local/bin'] : ['/home/linuxbrew/.linuxbrew/bin', '/snap/bin']),
    '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];
}

/** The PATH your login shell has (as a terminal's would be), or null where it can't be asked (Windows, an unusual shell, a slow one). */
export async function shellPath({ platform = process.platform, shell = safeShell(), runner = run } = {}) {
  if (platform === 'win32' || !shell || !/(?:^|\/)(?:bash|zsh|fish|ksh|sh|dash)$/.test(shell)) return null;
  // Between two marks: a shell's start-up files may print lines of their own.
  const r = await runner(shell, ['-ilc', 'printf "\\n__AGENTVILLE_PATH__%s__END__\\n" "$PATH"'], { timeoutMs: 5000 });
  const m = /__AGENTVILLE_PATH__(.*?)__END__/.exec(r.stdout ?? '');
  return m?.[1] || null;
}
function safeShell() { try { return userInfo().shell; } catch { return null; } }

/**
 * The PATH the collector runs with: Node's own folder (npm's commands live beside it), what it was started
 * with, what your login shell has, and the usual folders that exist. Each folder once, in that order.
 */
export async function fullPath({ platform = process.platform, env = process.env, home = homedir(), exists = existsSync, node = process.execPath, ...rest } = {}) {
  const sep = platform === 'win32' ? ';' : ':';
  const fromShell = await shellPath({ platform, ...rest }).catch(() => null);
  const dirs = [dirname(node), ...String(env[pathKey(env)] ?? '').split(sep), ...String(fromShell ?? '').split(sep), ...usualDirs({ platform, home, env }).filter(d => exists(d))];
  const seen = new Set();
  return dirs.filter(d => d && !seen.has(platform === 'win32' ? d.toLowerCase() : d) && seen.add(platform === 'win32' ? d.toLowerCase() : d)).join(sep);
}

/**
 * Where a program is, by PATH (and PATHEXT on Windows): its full path, or null. A name with a folder in it is
 * checked as it is. On Windows a file counts only by one of PATHEXT's endings: npm puts a `claude` beside its
 * `claude.cmd` that is a script for another shell, and Windows can't start it.
 */
export function which(name, { platform = process.platform, env = process.env, isFileAt = isFile } = {}) {
  const win = platform === 'win32', p = win ? win32 : posix;
  const known = win ? String(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [];
  const exts = !win || known.some(ext => name.toLowerCase().endsWith(ext.toLowerCase())) ? [''] : known;
  const tryAt = base => exts.map(ext => base + ext).find(full => isFileAt(full)) ?? null;
  if (p.isAbsolute(name) || /[\\/]/.test(name)) return tryAt(name);
  for (const dir of String(env[pathKey(env)] ?? '').split(win ? ';' : ':')) {
    if (!dir) continue;
    const found = tryAt(p.join(dir, name));
    if (found) return found;
  }
  return null;
}
