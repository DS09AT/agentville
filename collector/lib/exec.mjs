import { execFile } from 'node:child_process';
import { which } from '../platform/tools.mjs';

// What cmd.exe reads as its own inside a line: an argument holding one of these is refused, never escaped.
const CMD_UNSAFE = /["%!^&|<>\r\n]/;

/**
 * How a command is started here: as it is, except on Windows, where a program is found by PATHEXT and a
 * .cmd or .bat (npm's commands are these) can only be run by cmd.exe. Its arguments then go into a command
 * line, so one that cmd.exe would read as more than a word is refused: { file, args, options, env? } or { error }
 * (`env`: what the program's environment gets besides).
 */
export function spawnSpec(cmd, args, { platform = process.platform, env = process.env, find = which } = {}) {
  if (platform !== 'win32') return { file: cmd, args, options: {} };
  // By its full path, or not at all: Windows looks for a bare name in the folder the program starts in (a repo) before PATH.
  const full = find(cmd, { platform, env });
  if (!full) return { error: `"${cmd}" was not found` };
  if (!/\.(cmd|bat)$/i.test(full)) return { file: full, args, options: { windowsHide: true } };
  const words = [full, ...args.map(String)];
  if (words.some(w => CMD_UNSAFE.test(w))) return { error: `"${cmd}" is a batch file here, and one of its arguments can't be passed to it safely` };
  const shell = env.ComSpec ?? find('cmd.exe', { platform, env });
  if (!shell) return { error: 'cmd.exe was not found' };
  // The batch file's own lines (npm's start `node`) are kept from the folder it runs in as well: cmd.exe looks there first unless told not to.
  return { file: shell, args: ['/d', '/s', '/c', `"${words.map(w => (/[\s()]/.test(w) || w === '' ? `"${w}"` : w)).join(' ')}"`], options: { windowsHide: true, windowsVerbatimArguments: true }, env: { NoDefaultCurrentDirectoryInExePath: '1' } };
}

/** Runs a command without a shell. Never rejects: failures resolve with a non-zero code. */
// With verbatim, Windows gets the arguments exactly as given, for programs that parse their own command line.
export function run(cmd, args, { timeoutMs = 15000, cwd, env, verbatim = false } = {}) {
  return new Promise(resolve => {
    const given = env ? { ...process.env, ...env } : process.env;
    const spec = spawnSpec(cmd, args, { env: given });
    if (spec.error) { resolve({ code: 1, stdout: '', stderr: spec.error }); return; }
    execFile(
      spec.file,
      spec.args,
      { timeout: timeoutMs, cwd, env: spec.env ? { ...given, ...spec.env } : given, maxBuffer: 32 * 1024 * 1024, ...spec.options, ...(verbatim ? { windowsVerbatimArguments: true } : {}) },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ code: typeof err.code === 'number' ? err.code : 1, stdout: String(stdout ?? ''), stderr: String(stderr || err.message) });
        } else {
          resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
        }
      },
    );
  });
}
