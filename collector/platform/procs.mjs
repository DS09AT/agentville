// The machine's processes, read the way each system offers them: ps on macOS (and any other Unix), /proc on
// Linux, one PowerShell kept open on Windows. All give the same map: pid → { pid, ppid, pgid, ageSec, cpu, rssKb,
// command }, cpu in percent of one core. Where the system has no process groups (Windows), a process is its own.
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { run } from '../lib/exec.mjs';
import { readPs } from '../sources/ps.mjs';
import { which } from './tools.mjs';

const round1 = n => Math.round(n * 10) / 10;

/**
 * Linux: /proc/<pid>/stat and cmdline, read directly (no ps, whose %cpu there is a process's average over its
 * whole life). CPU is what it used since the last reading; the first reading has only that average.
 */
export function makeProcReader({ procDir = '/proc', clkTck = 100, pageKb = 4, now = Date.now, read = readFileSync, list = readdirSync } = {}) {
  let prev = new Map(), prevAt = 0;
  return async function readProc() {
    const at = now(), uptime = Number(String(read(`${procDir}/uptime`, 'utf8')).split(' ')[0]) || 0;
    const procs = new Map(), ticksNow = new Map();
    for (const name of list(procDir)) {
      if (!/^\d+$/.test(name)) continue;
      let stat, cmdline;
      try { stat = String(read(`${procDir}/${name}/stat`, 'utf8')); cmdline = String(read(`${procDir}/${name}/cmdline`, 'utf8')); } catch { continue; } // gone since the listing
      const open = stat.indexOf('('), close = stat.lastIndexOf(')'); // its name may hold spaces and brackets of its own
      const f = stat.slice(close + 2).split(' '); // from the state on: state ppid pgrp … utime(11) stime(12) … starttime(19) vsize rss(21)
      const pid = Number(name), ticks = Number(f[11]) + Number(f[12]), lived = Math.max(0, uptime - Number(f[19]) / clkTck);
      ticksNow.set(pid, ticks);
      const was = prev.get(pid), secs = (at - prevAt) / 1000;
      const cpu = was !== undefined && secs > 0 && ticks >= was ? (ticks - was) / clkTck / secs * 100 : lived > 0 ? ticks / clkTck / lived * 100 : 0;
      const command = cmdline.replace(/\0+$/, '').replaceAll('\0', ' ') || `[${stat.slice(open + 1, close)}]`;
      procs.set(pid, { pid, ppid: Number(f[1]), pgid: Number(f[2]), ageSec: Math.round(lived), cpu: round1(cpu), rssKb: Math.max(0, Number(f[21])) * pageKb, command });
    }
    prev = ticksNow;
    prevAt = at;
    return procs;
  };
}

// Windows: every process with its parent, CPU time, memory, start and command line, as one line of JSON each
// time a line comes in. One PowerShell stays open for it (starting one takes longer than a reading should).
export const WIN_PROCS_SCRIPT = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$epoch = [DateTime]::new(1970, 1, 1, 0, 0, 0, [DateTimeKind]::Utc)
while ($null -ne [Console]::In.ReadLine()) {
  try {
    $rows = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, KernelModeTime, UserModeTime, WorkingSetSize, CreationDate, CommandLine, Name | ForEach-Object {
      $started = 0
      if ($_.CreationDate) { $started = [long]($_.CreationDate.ToUniversalTime() - $epoch).TotalMilliseconds }
      $line = $_.CommandLine
      if (-not $line) { $line = $_.Name }
      @{ p = [long]$_.ProcessId; pp = [long]$_.ParentProcessId; t = [long]($_.KernelModeTime + $_.UserModeTime); m = [long]$_.WorkingSetSize; s = $started; c = [string]$line }
    })
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -Depth 3 -InputObject $rows))
  } catch {
    [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @{ error = [string]$_ }))
  }
}`;

/** Rows from the script ({ p: pid, pp: parent, t: CPU time in 100 ns, m: bytes, s: started (ms), c: command line }) as the map, with CPU since the last reading. */
export function makeWinRows({ now = Date.now } = {}) {
  let prev = new Map(), prevAt = 0;
  return function rowsToProcs(rows) {
    const at = now(), procs = new Map(), used = new Map(), secs = (at - prevAt) / 1000;
    for (const r of rows) {
      if (!Number.isInteger(r?.p)) continue;
      const { p: pid, pp: ppid, t: time, m: bytes, s: started, c: command } = r;
      const key = `${pid}:${started}`; // a pid is used again: only the same process's time counts
      used.set(key, time);
      const was = prev.get(key), lived = started > 0 ? Math.max(0, (at - started) / 1000) : 0;
      const cpu = was !== undefined && secs > 0 && time >= was ? (time - was) / 1e7 / secs * 100 : lived > 0 ? time / 1e7 / lived * 100 : 0;
      procs.set(pid, { pid, ppid, pgid: pid, ageSec: Math.round(lived), cpu: round1(cpu), rssKb: Math.round(bytes / 1024), command: String(command ?? '') });
    }
    prev = used;
    prevAt = at;
    return procs;
  };
}

/** Windows' reader: asks the open PowerShell for a line, starts it when there is none. `close()` ends it. `shell`: PowerShell's full path (found by PATH when none is given). */
export function makeWinReader({ shell = null, script = WIN_PROCS_SCRIPT, timeoutMs = 15_000, start = spawn, now = Date.now } = {}) {
  const toProcs = makeWinRows({ now });
  let child = null, buffer = '', waiting = null, busy = Promise.resolve();
  const drop = err => { const w = waiting; waiting = null; try { child?.kill(); } catch { /* gone */ } child = null; buffer = ''; w?.reject(err); };
  function open() {
    const exe = shell ?? which('powershell', { platform: 'win32' }); // never by its bare name: Windows would look in the folder the collector was started in first
    if (!exe) throw new Error('the process list could not be read (PowerShell was not found)');
    child = start(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    const mine = child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      const end = buffer.indexOf('\n');
      if (end < 0 || mine !== child) return;
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      const w = waiting;
      waiting = null;
      w?.resolve(line);
    });
    child.on('error', err => { if (mine === child) drop(err); });
    child.on('exit', () => { if (mine === child) drop(new Error('the process list could not be read (PowerShell ended)')); });
    child.stdin.on('error', () => {});
  }
  const once = () => new Promise((resolve, reject) => {
    if (!child) open();
    const timer = setTimeout(() => drop(new Error('the process list took too long to read')), timeoutMs);
    waiting = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
    child.stdin.write('\n');
  });
  const readProcs = () => (busy = busy.catch(() => {}).then(async () => {
    const got = JSON.parse(await once());
    if (!Array.isArray(got)) throw new Error(`the process list could not be read: ${String(got?.error ?? 'no rows').slice(0, 200)}`);
    return toProcs(got);
  }));
  readProcs.close = () => { const c = child; child = null; try { c?.stdin.end(); c?.kill(); } catch { /* gone */ } };
  return readProcs;
}

/** A number the system knows (getconf), or what it is nearly everywhere. */
async function sysconf(name, fallback, runner) {
  const r = await runner('getconf', [name], { timeoutMs: 3000 });
  const n = Number(r.stdout.trim());
  return r.code === 0 && Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The reader for this system: a function giving the map (it may have a close()). */
export function makeReadProcs({ platform = process.platform, runner = run } = {}) {
  if (platform === 'win32') return makeWinReader();
  if (platform !== 'linux') return () => readPs(runner);
  let reader = null;
  return async () => (reader ??= makeProcReader({ clkTck: await sysconf('CLK_TCK', 100, runner), pageKb: (await sysconf('PAGESIZE', 4096, runner)) / 1024 }))();
}

/** Is this a command line of Claude Code itself? (claude, a path to it, claude.exe.) */
export const isClaudeCommand = command => /(^|[\\/\s"])claude(\.exe)?("|\s|$)/i.test(command ?? '');

/** A session's process, for ending it: its command line, its terminal (macOS), a signal, whether it still runs. */
export function makeSessionProcs({ platform = process.platform, runner = run, readProcs } = {}) {
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };
  const posix = {
    commandOf: async pid => { const r = await runner('ps', ['-o', 'command=', '-p', String(pid)], { timeoutMs: 5000 }); return r.code === 0 ? r.stdout.trim() : null; },
    ttyOf: async pid => { const r = await runner('ps', ['-o', 'tty=', '-p', String(pid)], { timeoutMs: 5000 }); const t = r.code === 0 ? r.stdout.trim() : ''; return /^ttys\d+$/.test(t) ? t : null; },
    kill: (pid, sig) => process.kill(pid, sig),
    alive,
    killGroup: (pgid, sig) => process.kill(-pgid, sig), // a shell command and everything it started
    groupAlive: pgid => { try { process.kill(-pgid, 0); return true; } catch { return false; } },
  };
  if (platform === 'darwin') return posix;
  const commandOf = async pid => (await readProcs()).get(pid)?.command ?? null;
  if (platform !== 'win32') return { ...posix, commandOf, ttyOf: async () => null }; // its window closes by itself when Claude ends
  return {
    commandOf,
    ttyOf: async () => null,
    kill: pid => process.kill(pid), // Windows has no signals: the process is ended
    alive,
    killGroup: pid => { void runner('taskkill', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 10_000 }); }, // the command and everything it started
    groupAlive: alive,
  };
}
