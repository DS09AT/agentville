// What the collector asks of the desktop it runs on, each the way that system does it: a notification, a
// terminal window running a line, the system's folder window, a file shown in the file manager, a page opened
// in the browser. macOS: osascript and open. Linux: notify-send, the terminal emulator that is installed (tmux
// where there is no screen), zenity or kdialog, xdg-open. Windows: PowerShell and Explorer.
// Words from outside (a title, a path, a shell line) travel as arguments, never inside a script's text.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { basename, join, win32 } from 'node:path';
import { run, spawnSpec } from '../lib/exec.mjs';
import { closeTerminalScript, shellQuote, terminalScript } from '../sources/sessions.mjs';
import { which } from './tools.mjs';

/** osascript's arguments for a script: its lines, then `--`, so a word that follows (a title starting with a dash) is never read as an option. */
const osa = lines => [...lines.flatMap(line => ['-e', line]), '--'];
/** A script for Windows PowerShell, as the one argument that needs no quoting. */
export const psArgs = script => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];

// A toast from Windows' own notifier, under PowerShell's name (an app must be named, and PowerShell is one every Windows has).
const WIN_TOAST = `
$ErrorActionPreference = 'Stop'
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
$xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$text = $xml.GetElementsByTagName('text')
$text.Item(0).AppendChild($xml.CreateTextNode($env:AGENTVILLE_TITLE)) | Out-Null
$text.Item(1).AppendChild($xml.CreateTextNode($env:AGENTVILLE_TEXT)) | Out-Null
$app = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($app).Show([Windows.UI.Notifications.ToastNotification]::new($xml))`;

// Windows' folder window, in front; prints the folder picked, nothing when it was closed.
const WIN_CHOOSE = `
Add-Type -AssemblyName System.Windows.Forms
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = $env:AGENTVILLE_TEXT
$d.SelectedPath = $env:AGENTVILLE_START
$d.ShowNewFolderButton = $true
$top = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
if ($d.ShowDialog($top) -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }`;

// macOS's own "Choose a folder" window (it has New Folder), asked of System Events so it comes up in
// front of the browser; the app that was in front gets the focus back after. 5 minutes to pick.
const MAC_CHOOSE = ['on run argv', 'set prev to path to frontmost application as text', 'try', 'with timeout of 300 seconds',
  'tell application "System Events"', 'activate', 'set f to choose folder with prompt (item 2 of argv) default location (POSIX file (item 1 of argv))', 'end tell',
  'end timeout', 'on error number n', 'try', 'tell application prev to activate', 'end try', 'if n is -128 then return "cancelled"', 'error number n', 'end try',
  'try', 'tell application prev to activate', 'end try', 'return POSIX path of f', 'end run'];

// Linux terminal emulators, in the order they are tried, each with how it takes a command: its arguments after
// a flag, or (kgx) one line. x-terminal-emulator is the one a Debian system has chosen.
const LINUX_TERMINALS = [
  ['x-terminal-emulator', argv => ['-e', ...argv]], ['gnome-terminal', argv => ['--', ...argv]], ['ptyxis', argv => ['--', ...argv]],
  ['kgx', argv => ['-e', argv.map(shellQuote).join(' ')]], ['konsole', argv => ['-e', ...argv]], ['xfce4-terminal', argv => ['-x', ...argv]],
  ['kitty', argv => argv], ['alacritty', argv => ['-e', ...argv]], ['wezterm', argv => ['start', '--', ...argv]], ['foot', argv => argv],
  ['tilix', argv => ['-e', ...argv]], ['mate-terminal', argv => ['-x', ...argv]], ['lxterminal', argv => ['-e', ...argv]], ['xterm', argv => ['-e', ...argv]],
];

/** A word for fish: in its single quotes a backslash and a quote are escaped by a backslash, and nothing else is read. */
export const fishQuote = s => `'${String(s).replace(/[\\']/g, '\\$&')}'`;

/** Starts a program that stays (a terminal's window) and lets it go: { code: 0 } once it runs, { code: 1, stderr } when it could not start. */
export function startDetached(cmd, args, { cwd, env } = {}) {
  return new Promise(resolve => {
    const given = env ? { ...process.env, ...env } : process.env;
    const spec = spawnSpec(cmd, args, { env: given }); // on Windows: by its full path, never a bare name looked up in `cwd`
    if (spec.error) { resolve({ code: 1, stdout: '', stderr: spec.error }); return; }
    let child;
    try { child = spawn(spec.file, spec.args, { detached: true, stdio: 'ignore', cwd, env: spec.env ? { ...given, ...spec.env } : given, ...spec.options, windowsHide: false }); } catch (err) { resolve({ code: 1, stdout: '', stderr: String(err?.message ?? err) }); return; }
    child.once('error', err => resolve({ code: 1, stdout: '', stderr: String(err?.message ?? err) }));
    child.once('spawn', () => { child.unref(); resolve({ code: 0, stdout: '', stderr: '' }); });
  });
}

/**
 * This system's desktop. `runner` runs a program and waits for it (lib/exec.mjs), `starter` starts one that
 * stays; `find` gives a program's full path and `has` says whether it is installed. A test passes its own and a
 * platform's name.
 */
export function makeDesktop({ platform = process.platform, env = process.env, home = homedir(), runner = run, starter = startDetached, find = name => which(name, { platform, env }), has = name => Boolean(find(name)), shell = loginShell(platform), exists = existsSync } = {}) {
  const mac = platform === 'darwin', win = platform === 'win32';
  const screen = mac || win || Boolean(env.DISPLAY || env.WAYLAND_DISPLAY);
  const linuxTerminals = () => (screen ? LINUX_TERMINALS.filter(([name]) => has(name)).map(([name]) => name) : []);
  const hasTmux = () => !mac && !win && has('tmux');

  /** The terminals a session can open in here, the first being the one used when none is chosen ('auto'). */
  const terminals = () => (mac ? ['Terminal', 'iTerm'] : win ? [...(has('wt') ? ['Windows Terminal'] : []), 'PowerShell'] : [...linuxTerminals(), ...(hasTmux() ? ['tmux'] : [])]);
  const terminalOf = chosen => { const all = terminals(); return all.includes(chosen) ? chosen : all[0] ?? null; };

  return {
    platform,
    /** 'sh' or 'powershell': the kind of line a terminal here runs (sessions.mjs builds it). */
    shell: win ? 'powershell' : 'sh',
    terminals,
    terminalOf,

    /** A notification from the system: resolves once it was handed over ({ code }), never rejects. */
    notify(title, message) {
      if (mac) return runner('osascript', [...osa(['on run argv', 'display notification (item 2 of argv) with title (item 1 of argv)', 'end run']), String(title), String(message)], { timeoutMs: 5000 });
      if (win) return runner('powershell.exe', psArgs(WIN_TOAST), { timeoutMs: 15_000, env: { AGENTVILLE_TITLE: String(title), AGENTVILLE_TEXT: String(message) } });
      if (!has('notify-send')) return Promise.resolve({ code: 1, stdout: '', stderr: 'notify-send is not installed' });
      return runner('notify-send', ['--app-name=Agentville', '--', String(title), String(message)], { timeoutMs: 5000 });
    },

    /**
     * Opens a terminal window that runs `command` (a line for this system's shell), in `cwd`. `launch` is how a
     * program is run (the collector's, so a test can stand in for it): launch(args, { cmd, detached, cwd }).
     * Gives { ok, terminal, note? } or { ok: false, error }.
     */
    async openTerminal(chosen, command, { cwd, launch }) {
      const app = terminalOf(chosen);
      if (!app) return { ok: false, error: win ? 'No terminal found.' : screen ? 'No terminal found. Install a terminal emulator or tmux.' : 'No display. Install tmux to start sessions.' };
      if (mac) {
        const res = await launch(terminalScript(app, command), { cmd: 'osascript' });
        if (res.code === 0) return { ok: true, terminal: app };
        if (/-1743|not authori[sz]ed/i.test(res.stderr)) return { ok: false, error: `macOS stopped the tracker from opening ${app}. Allow it in System Settings › Privacy & Security › Automation, then try again.` };
        return { ok: false, error: res.stderr.trim().slice(0, 200) || 'The terminal did not open.' };
      }
      if (win) {
        // The line runs in Windows PowerShell (its policy on scripts set aside, or npm's claude.ps1 would be refused), in a console of its own.
        // Both by their full paths and from your home folder, never the session's: Windows looks for a program, and for
        // what it loads, in the folder it starts in, and a repo could hold a powershell.exe of its own. The line goes there itself.
        const exe = find('powershell'), wt = app === 'Windows Terminal' ? find('wt') : null;
        if (!exe || (app === 'Windows Terminal' && !wt)) return { ok: false, error: `${wt === null && exe ? 'Windows Terminal' : 'PowerShell'} was not found.` };
        const ps = ['-NoLogo', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')];
        const res = wt ? await launch(['-w', 'new', exe, ...ps], { cmd: wt, detached: true, cwd: home }) : await launch(ps, { cmd: exe, detached: true, cwd: home });
        return res.code === 0 ? { ok: true, terminal: app } : { ok: false, error: res.stderr.trim().slice(0, 200) || 'The terminal did not open.' };
      }
      // In your login shell, as a terminal you open yourself would run it (its start-up files set PATH and the rest).
      // The line is written for sh: fish quotes its own way, so fish hands it to sh as one word.
      const argv = shell === '/bin/sh' ? [shell, '-c', command] : /(?:^|\/)fish$/.test(shell) ? [shell, '-lic', `exec /bin/sh -c ${fishQuote(command)}`] : [shell, '-lic', command];
      if (app === 'tmux') {
        const name = `agentville-${Date.now().toString(36)}`;
        // No -c for the folder: tmux reads it as a format and runs a #(…) in it. It starts in `cwd` as it is, and the line goes there itself.
        const res = await launch(['new-session', '-d', '-s', name, ...argv], { cmd: 'tmux', cwd });
        return res.code === 0 ? { ok: true, terminal: 'tmux', note: `Running in tmux. Attach with: tmux attach -t ${name}` } : { ok: false, error: res.stderr.trim().slice(0, 200) || 'tmux could not start it.' };
      }
      const res = await launch(LINUX_TERMINALS.find(([name]) => name === app)[1](argv), { cmd: app, detached: true, cwd });
      return res.code === 0 ? { ok: true, terminal: app } : { ok: false, error: res.stderr.trim().slice(0, 200) || 'The terminal did not open.' };
    },

    /** Closes the window a session ran in, by its tty: macOS only (elsewhere it closes when Claude ends). True when one was closed. */
    async closeTerminal(chosen, tty, { launch }) {
      if (!mac || !tty) return false;
      const first = terminalOf(chosen);
      for (const app of [first, first === 'iTerm' ? 'Terminal' : 'iTerm']) {
        const res = await launch(closeTerminalScript(app, `/dev/${tty}`), { cmd: 'osascript' }).catch(() => ({ code: 1, stdout: '' }));
        if (res.code === 0 && res.stdout.trim() === 'closed') return true;
      }
      return false;
    },

    /** The system's folder window: { path } picked, { cancelled }, or { error }. 5 minutes to pick. */
    async chooseFolder({ start, prompt }) {
      if (mac) {
        const r = await runner('osascript', [...osa(MAC_CHOOSE), start, prompt], { timeoutMs: 310_000 });
        const out = r.stdout.trim();
        if (r.code === 0 && out === 'cancelled') return { cancelled: true };
        if (r.code === 0 && out.startsWith('/')) return { path: out };
        return { error: /-1743|not allowed|Not authorized/i.test(r.stderr) ? 'macOS did not let the tracker open the folder window: allow it to control System Events under System Settings → Privacy & Security → Automation.' : `The folder window could not open (${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}).` };
      }
      if (win) {
        const r = await runner('powershell.exe', ['-STA', ...psArgs(WIN_CHOOSE)], { timeoutMs: 310_000, env: { AGENTVILLE_TEXT: prompt, AGENTVILLE_START: start } });
        const out = r.stdout.trim();
        return r.code !== 0 ? { error: `The folder window could not open (${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}).` } : out ? { path: out } : { cancelled: true };
      }
      const tool = !screen ? null : has('zenity') ? ['zenity', ['--file-selection', '--directory', `--title=${prompt}`, `--filename=${start.replace(/\/*$/, '/')}`]] : has('kdialog') ? ['kdialog', ['--title', prompt, '--getexistingdirectory', start]] : null;
      if (!tool) return { error: screen ? 'No folder dialog (needs zenity or kdialog). Type the path.' : 'No display for a folder dialog. Type the path.' };
      const r = await runner(tool[0], tool[1], { timeoutMs: 310_000 });
      const out = r.stdout.trim();
      if (r.code === 0 && out.startsWith('/')) return { path: out };
      return r.code === 1 ? { cancelled: true } : { error: `The folder window could not open (${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}).` };
    },

    /** Shows a file in the file manager (only shows it: never opens or runs it). Linux has no one way to select a file: its folder is shown. */
    revealFile(real) {
      if (mac) return runner('open', ['-R', real], { timeoutMs: 10_000 });
      if (win) return runner('explorer.exe', [`/select,${real}`], { timeoutMs: 10_000 }).then(() => ({ code: 0, stdout: '', stderr: '' })); // Explorer's exit code says nothing
      return has('xdg-open') ? starter('xdg-open', [real.replace(/\/[^/]*$/, '') || '/']) : Promise.resolve({ code: 1, stdout: '', stderr: 'no file manager' });
    },
    /** A folder in the file manager, by the file manager's own name: a folder that names an app is shown, never launched. */
    openFolder(dir) {
      if (mac) return runner('open', ['-a', 'Finder', dir], { timeoutMs: 10_000 });
      if (win) return runner('explorer.exe', [dir], { timeoutMs: 10_000 }).then(() => ({ code: 0, stdout: '', stderr: '' }));
      return has('xdg-open') ? starter('xdg-open', [dir]) : Promise.resolve({ code: 1, stdout: '', stderr: 'no file manager' });
    },
    /** A page in your browser. */
    openUrl(url) {
      if (mac) return runner('open', [url], { timeoutMs: 10_000 });
      if (win) return runner('rundll32.exe', ['url.dll,FileProtocolHandler', url], { timeoutMs: 10_000 });
      return has('xdg-open') ? starter('xdg-open', [url]) : Promise.resolve({ code: 1, stdout: '', stderr: 'no browser to open' });
    },
    /** The file manager's name, for the page's words. */
    fileManager: mac ? 'Finder' : win ? 'Explorer' : 'The file manager',

    /** Where folders to start a session in may be: your home, and where drives are mounted. */
    folderRoots() {
      if (mac) return [home, '/Volumes'];
      if (win) return [home, ...'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `${l}:\\`).filter(d => exists(d) && !isUnder(home, d))];
      return [home, '/media', '/mnt', '/run/media'];
    },
    /** Where Claude Code keeps its sessions' scratch folders. */
    scratchBase() {
      if (mac) return `/private/tmp/claude-${process.getuid?.() ?? 0}`;
      if (win) return win32.join(env.TEMP ?? env.TMP ?? tmpdir(), 'claude');
      return `${env.TMPDIR?.replace(/\/+$/, '') || '/tmp'}/claude-${process.getuid?.() ?? 0}`;
    },
    /** A Word document as a page and as plain text to quote from: { html, text } or { error }. macOS reads it itself (textutil); elsewhere LibreOffice does, where it is installed. */
    async readWord(real) {
      if (mac) {
        const [html, text] = await Promise.all(['html', 'txt'].map(as => runner('textutil', ['-convert', as, '-stdout', real], { timeoutMs: 30_000 })));
        if (html.code !== 0) return { error: `macOS could not read this document (${html.stderr.trim().split('\n')[0] || `exit ${html.code}`}).` };
        return { html: html.stdout, text: text.code === 0 ? text.stdout : '' };
      }
      try {
        const html = (await viaOffice(real, 'html')).toString('utf8');
        const text = await viaOffice(real, 'txt:Text (encoded):UTF8').then(b => b.toString('utf8'), () => '');
        return { html, text };
      } catch (err) {
        return { error: err.message };
      }
    },
    /** A picture of a document's first page, as PNG bytes (Quick Look on macOS, LibreOffice elsewhere); throws when none can be made. */
    async firstPage(real) {
      if (!mac) return viaOffice(real, 'png');
      const dir = mkdtempSync(join(tmpdir(), 'agentville-ql-'));
      try {
        const r = await runner('qlmanage', ['-t', '-s', '1600', '-o', dir, real], { timeoutMs: 30_000 });
        const png = join(dir, `${basename(real)}.png`);
        if (!existsSync(png)) throw new Error(r.stderr.trim().split('\n')[0] || 'no picture');
        return readFileSync(png);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  };

  /** LibreOffice, run with no window, turns a document into another kind in a folder of its own: that file's bytes. */
  async function viaOffice(real, to) {
    const office = ['soffice', 'libreoffice'].find(has);
    if (!office) throw new Error('LibreOffice is needed to read this document.');
    const dir = mkdtempSync(join(tmpdir(), 'agentville-doc-'));
    try {
      const r = await runner(office, ['--headless', '--norestore', `-env:UserInstallation=file://${win ? '/' : ''}${join(dir, 'profile').replaceAll('\\', '/')}`, '--convert-to', to, '--outdir', join(dir, 'out'), real], { timeoutMs: 60_000 });
      const made = existsSync(join(dir, 'out')) ? readdirSync(join(dir, 'out')).find(n => n.toLowerCase().endsWith(`.${to.split(':')[0]}`)) : null;
      if (!made) throw new Error(`LibreOffice could not read this document (${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}).`);
      return readFileSync(join(dir, 'out', made));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

const isUnder = (path, root) => path.toLowerCase().startsWith(root.toLowerCase());

/** Your login shell where sessions should run in it (a Unix); /bin/sh for a shell that takes no `-lic` line. */
function loginShell(platform) {
  if (platform === 'win32') return null;
  let shell = null;
  try { shell = userInfo().shell; } catch { /* no entry */ }
  return shell && /(?:^|\/)(?:bash|zsh|fish|ksh)$/.test(shell) ? shell : '/bin/sh';
}
