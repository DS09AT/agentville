import { closeSync, openSync, readSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { parseEntry } from '../transcript/parse.mjs';
import { firstLine } from '../transcript/summarize.mjs';

// Past sessions to resume, from the transcripts in ~/.claude/projects, and the terminal window
// that starts or resumes one. A transcript can be hundreds of MB, so only its start (for the
// folder and the first message) and its end (for the title and the last message) are read.

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEAD_BYTES = 64 * 1024;
const TAIL_BYTES = 256 * 1024;

function readRange(path, start, length) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(length);
    return buf.subarray(0, readSync(fd, buf, 0, length, start)).toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/** The JSON entries in a piece of a transcript; a line cut at either end of the piece is dropped. */
function entriesOf(text, { cutStart, cutEnd }) {
  const lines = text.split('\n');
  if (cutStart) lines.shift();
  if (cutEnd) lines.pop();
  return lines.flatMap(line => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
}

const promptsOf = entries => entries.flatMap(e => parseEntry(e).events.filter(ev => ev.kind === 'prompt').map(ev => ev.text));
const titleOf = entries => entries.findLast(e => e?.type === 'ai-title' && typeof e.aiTitle === 'string')?.aiTitle ?? null;
const cwdOf = entries => entries.find(e => typeof e?.cwd === 'string' && e.cwd)?.cwd ?? null;
const timeOf = e => (typeof e?.timestamp === 'string' ? Date.parse(e.timestamp) : NaN);
const startOf = entries => entries.map(timeOf).find(Number.isFinite) ?? null;
const branchOf = entries => entries.findLast(e => typeof e?.gitBranch === 'string' && e.gitBranch)?.gitBranch ?? null;
const modelOf = entries => entries.findLast(e => e?.type === 'assistant' && typeof e.message?.model === 'string' && !e.message.model.startsWith('<'))?.message.model ?? null;

/** { cwd, title, firstPrompt, lastPrompt, startedAt, model, branch } of one transcript, or null when nobody said anything in it. */
function readSessionInfo(path, size) {
  let head, tail;
  if (size <= HEAD_BYTES + TAIL_BYTES) {
    head = tail = entriesOf(readRange(path, 0, size), { cutStart: false, cutEnd: false });
  } else {
    head = entriesOf(readRange(path, 0, HEAD_BYTES), { cutStart: false, cutEnd: true });
    tail = entriesOf(readRange(path, size - TAIL_BYTES, TAIL_BYTES), { cutStart: true, cutEnd: false });
  }
  const first = promptsOf(head), last = promptsOf(tail);
  if (!first.length && !last.length) return null;
  return {
    cwd: cwdOf(head) ?? cwdOf(tail),
    title: titleOf(tail) ?? titleOf(head),
    firstPrompt: firstLine(first[0] ?? last[0]),
    lastPrompt: firstLine(last.at(-1) ?? first.at(-1)),
    startedAt: startOf(head),
    model: modelOf(tail) ?? modelOf(head), // the model of its last reply
    branch: branchOf(tail) ?? branchOf(head), // the git branch it was last on
  };
}

/**
 * Sessions with a transcript changed in the last `maxAgeDays` (Infinity: all of them), newest first:
 * [{ id, cwd, title, firstPrompt, lastPrompt, startedAt, model, branch, size, at, projectsDir }],
 * from each projects folder (every account's that isn't shared). A session resumed elsewhere is
 * listed once, at its newest transcript. `cache` (path → { key, info }) skips files that have not
 * changed since they were last read.
 */
export function listSessions({ claudeDir, projectsDirs = [join(claudeDir, 'projects')], now = Date.now(), maxAgeDays = 30, limit = Infinity, cache = new Map() }) {
  const files = [];
  for (const projects of projectsDirs) {
    let dirs = [];
    try { dirs = readdirSync(projects); } catch { continue; }
    for (const dir of dirs) {
      let names = [];
      try { names = readdirSync(join(projects, dir)); } catch { continue; }
      for (const name of names) {
        if (!name.endsWith('.jsonl') || !SESSION_ID.test(name.slice(0, -6))) continue;
        const path = join(projects, dir, name);
        try {
          const st = statSync(path);
          if (st.isFile() && now - st.mtimeMs <= maxAgeDays * 86_400_000) files.push({ id: name.slice(0, -6), path, size: st.size, at: st.mtimeMs, projectsDir: projects });
        } catch {
          // gone since the listing
        }
      }
    }
  }
  files.sort((x, y) => y.at - x.at);
  const out = [], taken = new Set();
  for (const f of files) {
    if (taken.has(f.id)) continue; // an older copy of a session listed already
    if (out.length >= limit) break;
    const key = `${f.size}:${f.at}`;
    let hit = cache.get(f.path);
    if (hit?.key !== key) {
      let info = null;
      try { info = readSessionInfo(f.path, f.size); } catch { /* unreadable: skipped */ }
      hit = { key, info };
      cache.set(f.path, hit);
    }
    if (hit.info) { taken.add(f.id); out.push({ id: f.id, ...hit.info, size: f.size, at: f.at, projectsDir: f.projectsDir }); }
  }
  return out;
}

/** The folders sessions ran in, newest first, each once: [{ cwd, name, at, sessions }]. */
export function projectsOf(sessions) {
  const map = new Map();
  for (const s of sessions) {
    if (!s.cwd || dirname(s.cwd) === s.cwd) continue; // the disk's root
    const p = map.get(s.cwd);
    if (p) { p.sessions++; p.at = Math.max(p.at, s.at); } else map.set(s.cwd, { cwd: s.cwd, name: s.cwd.split(/[\\/]/).filter(Boolean).pop() ?? s.cwd, at: s.at, sessions: 1 });
  }
  return [...map.values()].sort((x, y) => y.at - x.at);
}

/**
 * A word for a shell's line, read the same by sh, bash, zsh, ksh and fish (macOS types the line into whichever is
 * yours): single quotes, with every quote and every backslash put outside them behind a backslash. Inside its
 * single quotes fish reads \' and \\ as escapes where the others read nothing, so no quoted part holds either.
 */
export const shellQuote = s => `'${String(s).replace(/['\\]/g, "'\\$&'")}'`;

// Models and effort levels a session can start with, or switch to (aliases, as --model and /model take them).
export const MODELS = ['default', 'opus', 'opus[1m]', 'sonnet', 'haiku', 'fable'];
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Permission modes a session can start in: their command-line flags. Bypass skips every permission check.
export const MODE_FLAGS = {
  default: '', acceptEdits: ' --permission-mode acceptEdits', plan: ' --permission-mode plan', auto: ' --permission-mode auto',
  bypassPermissions: ' --dangerously-skip-permissions',
};

/** A word for PowerShell: single quotes, in which only a quote itself needs doubling. PowerShell reads ‘ ’ ‚ ‛ as that quote too. */
export const psQuote = s => `'${String(s).replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`;
const quoteFor = shell => (shell === 'powershell' ? psQuote : shellQuote);

// What a terminal acts on instead of showing (Ctrl-C, Escape, a line's end). Terminal and iTerm are typed the
// line, so one of these inside a quoted word would still be obeyed: a line never holds one.
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
/** A folder or file as it goes into a terminal's line: refused when it holds a control character. */
function plain(path, what) {
  if (CONTROL.test(String(path))) throw new Error(`${what} has a control character in its name`);
  return String(path);
}
// What cmd.exe reads as its own. Where `claude` is a batch file (some installers leave only a claude.cmd), PowerShell
// passes its words on through cmd.exe.
const CMD_READS = /[&|<>^%!]/;
/**
 * A word a program (claude) is given, for the shell: one starting with a dash would be read as an option. Windows
 * PowerShell also hands a program a double quote as it is (the program reads it as the word's end), drops an
 * empty word, and lets a backslash at the end take the closing quote with it: such a word is refused, never
 * escaped, and so is one with a character of cmd.exe's, unless it is `ours` (a path the collector made itself).
 */
function programWord(word, what, shell, { ours = false } = {}) {
  const w = plain(word, what);
  if (w.startsWith('-') || (shell === 'powershell' && (w === '' || /"|\\$/.test(w) || (!ours && CMD_READS.test(w))))) throw new Error(`${what} can't be passed to Claude Code safely`);
  return quoteFor(shell)(w);
}
/** A session's name as a word for the shell, without what a terminal or PowerShell would act on; '' when nothing is left. */
function nameWord(name, shell) {
  let n = String(name ?? '').replace(new RegExp(CONTROL.source, 'g'), ' ');
  if (shell === 'powershell') n = n.replace(/"/g, "'").replace(new RegExp(CMD_READS.source, 'g'), ' ').replace(/[\\\s]+$/, '');
  n = n.replace(/^[-\s]+/, '').trim(); // never an option's look, whatever stood before the dash
  return n ? quoteFor(shell)(n) : '';
}

/**
 * What goes before `claude` so it runs on an account (config folder): nothing with one account
 * (null); with several, CLAUDE_CONFIG_DIR unset for the first and set to its folder for the others.
 * `shell`: 'sh' (a Unix shell's line) or 'powershell' (Windows).
 */
export function accountPrefix(account, shell = 'sh') {
  if (!account) return '';
  if (account.first) return shell === 'powershell' ? 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue; ' : 'env -u CLAUDE_CONFIG_DIR ';
  if (!isAbsolute(account.dir) || /[\\/]$/.test(account.dir)) throw new Error('not an account folder');
  const dir = plain(account.dir, "The account's folder");
  return shell === 'powershell' ? `$env:CLAUDE_CONFIG_DIR = ${psQuote(dir)}; ` : `env CLAUDE_CONFIG_DIR=${shellQuote(dir)} `;
}

// PowerShell, before `claude`. Where claude is a batch file (some installers leave only a claude.cmd), PowerShell
// passes its words on through cmd.exe: $avBatch says so for what follows, and cmd.exe is told not to look in the
// session's folder for the programs that batch file starts (node). Anything that is not plainly a program
// (.exe) or a PowerShell script counts as one: an alias or a function of yours may lead to a batch file too.
const PS_CLAUDE = "$avClaude = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1; $avBatch = -not ($avClaude -and ($avClaude.CommandType -eq 'ExternalScript' -or ($avClaude.CommandType -eq 'Application' -and $avClaude.Path -match '\\.exe$'))); if ($avBatch) { $env:NoDefaultCurrentDirectoryInExePath = '1' }; ";
/**
 * PowerShell, before `claude`: the text for the prompt box, read from its file into $avFill (the words `--prefill`
 * and the text, or none). Windows PowerShell hands a program its arguments with their quotes as they are: the
 * text's own are escaped the way a Windows program reads them back (a backslash before each, and before each
 * backslash that precedes one). cmd.exe reads them another way, so a batch file is given the text only when it
 * holds nothing cmd.exe acts on; else the session opens without it, and says so.
 */
const psPrefill = file => (!file ? '' : `$avFill = @(); $avText = Get-Content -Raw -Encoding UTF8 -LiteralPath ${psQuote(plain(file, 'The file'))}; `
  + `if ($avText -and -not ($avBatch -and $avText -match '[&|<>^%!"\\r\\n]')) { $avFill = @('--prefill', ($avText -replace '(\\\\*)"', '$1$1\\"' -replace '(\\\\+)$', '$1$1')) } `
  + "elseif ($avText) { Write-Warning 'The text for the prompt box was left out: claude is a batch file here, which can not be given it safely.' }; ");

/** A line's start: into the folder, then Claude in the shell's place (so its window closes when it ends; PowerShell's does when its line is done). */
const lineStart = (cwd, account, shell, prefillFile) => (shell === 'powershell'
  ? `Set-Location -LiteralPath ${psQuote(plain(cwd, 'The folder'))}; ${accountPrefix(account, shell)}${PS_CLAUDE}${psPrefill(prefillFile)}claude`
  : `cd ${shellQuote(plain(cwd, 'The folder'))} && exec ${accountPrefix(account)}claude`);

/**
 * The shell line that starts Claude Code in a folder (or resumes a session there) in a permission
 * mode, with a model and effort for this session only (flags, not your saved defaults), on `account`
 * (see accountPrefix). `exec` puts Claude in the shell's place, so its window closes when it ends.
 * `shell`: 'sh' or 'powershell', whichever the terminal on this system runs (platform/desktop.mjs).
 */
export function claudeCommand(cwd, resume, mode = 'default', { model = 'default', effort, prefillFile, account = null, shell = 'sh' } = {}) {
  if (resume !== undefined && !SESSION_ID.test(resume)) throw new Error('not a session id');
  return `${lineStart(cwd, account, shell, prefillFile)}${resume ? ` --resume ${resume}` : ''}${startFlags(mode, { model, effort, shell })}${prefillFlag(prefillFile, shell)}`;
}

/**
 * The shell line that forks a conversation: Claude Code resumes the cut copy of its transcript at
 * `copy` as a new session of its own (--fork-session), in the folder, under `name`, in a permission
 * mode with a model and effort for it alone, on `account` (see accountPrefix). `prefillFile` holds the
 * text for its prompt box, read by the shell (--prefill), so the text never goes into the command line.
 */
export function forkCommand(cwd, copy, mode = 'default', { model = 'default', effort, name, prefillFile, sessionId, account = null, shell = 'sh' } = {}) {
  if (!isAbsolute(copy) || !copy.endsWith('.jsonl')) throw new Error('not a transcript copy');
  if (sessionId !== undefined && !SESSION_ID.test(sessionId)) throw new Error('not a session id');
  const named = nameWord(name, shell);
  return `${lineStart(cwd, account, shell, prefillFile)} --resume ${programWord(copy, 'The transcript', shell, { ours: true })} --fork-session${sessionId ? ` --session-id ${sessionId}` : ''}${named ? ` --name ${named}` : ''}${startFlags(mode, { model, effort, shell })}${prefillFlag(prefillFile, shell)}`;
}

/** The line that signs in to an MCP server (claude mcp login), from your home folder. */
export const mcpLoginCommand = (name, shell = 'sh') => (shell === 'powershell' ? `Set-Location -LiteralPath $HOME; ${PS_CLAUDE}claude mcp login ${programWord(name, "The server's name", shell)}` : `cd ~ && exec claude mcp login ${programWord(name, "The server's name", shell)}`);
/** The line that attaches to a background session (its id is [A-Za-z0-9-] only: the caller checks). */
export const attachCommand = (cliId, account = null, shell = 'sh') => `${accountPrefix(account, shell)}${shell === 'powershell' ? PS_CLAUDE : ''}claude attach ${cliId}`;

/** Text for the prompt box (--prefill), read from a file by the shell, so it never goes into the command line (PowerShell: psPrefill has read it). */
const prefillFlag = (file, shell = 'sh') => (!file ? '' : shell === 'powershell' ? ' @avFill' : ` --prefill "$(cat ${shellQuote(plain(file, 'The file'))})"`);

/** A session's permission mode, model and effort, as flags (checked: these go into a shell line). */
function startFlags(mode, { model = 'default', effort, shell = 'sh' } = {}) {
  if (!Object.hasOwn(MODE_FLAGS, mode)) throw new Error('not a permission mode');
  if (!MODELS.includes(model)) throw new Error('not a model');
  if (effort !== undefined && !EFFORTS.includes(effort)) throw new Error('not an effort level');
  return `${MODE_FLAGS[mode]}${model !== 'default' ? ` --model ${quoteFor(shell)(model)}` : ''}${effort ? ` --effort ${effort}` : ''}`;
}

/**
 * osascript arguments that close the iTerm session or Terminal window on a tty (/dev/ttys012),
 * only if that app is running already (never starts it); prints "closed" or "none".
 */
export function closeTerminalScript(app, tty) {
  if (!/^\/dev\/ttys\d{1,4}$/.test(tty)) throw new Error('not a tty');
  const lines = app === 'iTerm'
    ? ['on run argv', 'set t to item 1 of argv', 'if application "iTerm" is running then', 'tell application "iTerm"', 'repeat with w in windows', 'repeat with tb in tabs of w', 'repeat with s in sessions of tb',
      'if (tty of s) is t then', 'close s', 'return "closed"', 'end if', 'end repeat', 'end repeat', 'end repeat', 'end tell', 'end if', 'return "none"', 'end run']
    : ['on run argv', 'set t to item 1 of argv', 'if application "Terminal" is running then', 'tell application "Terminal"', 'repeat with w in windows', 'repeat with tb in tabs of w',
      'if (tty of tb) is t then', 'close w', 'return "closed"', 'end if', 'end repeat', 'end repeat', 'end tell', 'end if', 'return "none"', 'end run'];
  return [...lines.flatMap(line => ['-e', line]), '--', tty];
}

/**
 * osascript arguments that open a new window of the terminal app (iTerm, else Terminal) and run
 * `command` in it. The command goes in as an argument, never into the script's text.
 */
export function terminalScript(app, command) {
  const lines = app === 'iTerm'
    ? ['on run argv', 'tell application "iTerm"', 'activate', 'set w to (create window with default profile)', 'tell current session of w to write text (item 1 of argv)', 'end tell', 'end run']
    : ['on run argv', 'tell application "Terminal"', 'activate', 'do script (item 1 of argv)', 'end tell', 'end run'];
  return [...lines.flatMap(line => ['-e', line]), '--', command];
}
