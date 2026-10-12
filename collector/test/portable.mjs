// What the tests need from the system, written so one test runs the same on macOS, Linux and Windows.
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const WINDOWS = process.platform === 'win32';

/** A path as this system writes it: '/p/backend' is 'C:\\p\\backend' on Windows (the drive of the working folder). */
export const native = p => (WINDOWS ? resolve(p) : p);

/** Whether this process may make a link to a file: a plain Windows account may not (Developer Mode or an administrator may). */
function fileLinksWork() {
  if (!WINDOWS) return true;
  const dir = mkdtempSync(join(tmpdir(), 'probe-link-'));
  try {
    writeFileSync(join(dir, 'a'), '');
    symlinkSync(join(dir, 'a'), join(dir, 'b'));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
export const FILE_LINKS = fileLinksWork();

/** For `{ skip }` of a test that needs a link to a file (or one that points nowhere): why it is left out here, or false. */
export const NEEDS_FILE_LINKS = FILE_LINKS ? false : 'needs the right to make symbolic links (Windows: Developer Mode)';

// Works like symlinkSync. Where Windows allows no file links, a folder link is a junction and a dangling link is a junction
// to a folder that is removed again; a link to an existing file throws EPERM there.
export function link(target, path) {
  if (!WINDOWS || FILE_LINKS) return symlinkSync(target, path);
  const abs = resolve(dirname(path), target);
  let kind = 'none';
  try { kind = statSync(abs).isDirectory() ? 'folder' : 'file'; } catch { /* not there */ }
  if (kind === 'folder') return symlinkSync(abs, path, 'junction');
  if (kind === 'none') {
    const gone = mkdtempSync(join(tmpdir(), 'dangling-'));
    symlinkSync(gone, path, 'junction');
    rmSync(gone, { recursive: true, force: true });
    return undefined;
  }
  throw Object.assign(new Error(`a link to ${target} needs the right to make symbolic links`), { code: 'EPERM' });
}

/** A file every system has, outside any folder a test makes (what '/etc/hosts' stands for), and the folder it is in. */
export const SYSTEM_FILE = WINDOWS ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts';
export const SYSTEM_DIR = dirname(SYSTEM_FILE);

/** A command that is not found, the way `/usr/bin/false` stands for one that fails. */
export const NOT_A_PROGRAM = WINDOWS ? 'C:\\no-such-folder\\program.exe' : '/usr/bin/false';

/** A program that runs for `seconds` (what `sleep` is on a system that has one). */
export const sleeper = (seconds = 60, options = {}) => spawn(process.execPath, ['-e', `setTimeout(() => {}, ${seconds * 1000})`], options);

/**
 * A stand-in for the claude command: Node runs `source` (CommonJS; its arguments are process.argv.slice(2)). On Windows it is a
 * .cmd, as npm installs claude there, so the collector runs it the way it runs the real one. Returns its path.
 */
export function scriptCli(dir, name, source) {
  const js = join(dir, `${name}.cjs`);
  if (WINDOWS) {
    writeFileSync(js, source);
    const cmd = join(dir, `${name}.cmd`);
    writeFileSync(cmd, `@"${process.execPath}" "${js}" %*\r\n`);
    return cmd;
  }
  const file = join(dir, name);
  writeFileSync(file, `#!${process.execPath}\n${source}`, { mode: 0o755 });
  return file;
}

/** Undoes shellQuote: the word a POSIX shell reads from `'a'\\''b'` style quoting. */
export function shellWord(quoted) {
  let out = '';
  for (let i = 0; i < quoted.length; i++) {
    const c = quoted[i];
    if (c === "'") {
      const end = quoted.indexOf("'", i + 1);
      out += quoted.slice(i + 1, end);
      i = end;
    } else if (c === '\\') {
      out += quoted[++i];
    } else {
      out += c;
    }
  }
  return out;
}
