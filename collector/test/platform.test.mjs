// What the collector asks of the system it runs on (collector/platform/): the processes, the desktop, where its
// programs are. Each system's way is tried here with stand-ins, so macOS, Linux and Windows are all checked on
// whichever of them runs the tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawnSpec } from '../lib/exec.mjs';
import { fishQuote, makeDesktop, windowsLine } from '../platform/desktop.mjs';
import { isClaudeCommand, makeProcReader, makeSessionProcs, makeWinReader, makeWinRows } from '../platform/procs.mjs';
import { fullPath, isNetworkPath, mayLookAt, shellPath, usualDirs, which } from '../platform/tools.mjs';
import { isShellCommand, typedCommand } from '../sources/ps.mjs';
import { attachCommand, claudeCommand, closeTerminalScript, forkCommand, mcpLoginCommand, psQuote, shellQuote, terminalScript } from '../sources/sessions.mjs';

const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' });
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.EXE';

test('Linux: the processes are read from /proc, with CPU as what was used since the last reading', async () => {
  let now = 1_000_000;
  const files = {
    '/proc/uptime': '1000.00 900.00\n',
    '/proc/42/stat': '42 (my (odd) name) S 1 42 42 0 -1 4194304 100 0 0 0 250 50 0 0 20 0 1 0 90000 1000000 2048 18446744073709551615 0 0 0\n',
    '/proc/42/cmdline': '/usr/bin/bash\0-c\0echo hi\0',
    '/proc/7/stat': '7 (kthreadd) S 0 0 0 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 5 0 0 0\n',
    '/proc/7/cmdline': '',
  };
  const read = makeProcReader({ procDir: '/proc', clkTck: 100, pageKb: 4, now: () => now, read: p => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; }, list: () => ['1', '42', '7', 'cpuinfo', 'self'] });
  const first = await read();
  assert.deepEqual([...first.keys()], [42, 7], 'a process gone since the listing (1) is left out');
  assert.deepEqual(first.get(42), { pid: 42, ppid: 1, pgid: 42, ageSec: 100, cpu: 3, rssKb: 8192, command: '/usr/bin/bash -c echo hi' }, 'its name may hold brackets; the first reading has its average (3 s of CPU in 100 s)');
  assert.equal(first.get(7).command, '[kthreadd]', 'a kernel thread has no command line: its name');
  now += 2000;
  files['/proc/42/stat'] = files['/proc/42/stat'].replace(' 250 50 ', ' 350 50 '); // one more second of CPU in two seconds
  assert.equal((await read()).get(42).cpu, 50);
});

test('Windows: rows from PowerShell become the same map; CPU counts only for the same process (a pid is used again)', () => {
  let now = 50_000;
  const rows = makeWinRows({ now: () => now });
  const a = rows([{ p: 4, pp: 0, t: 10_000_000, m: 2_048_000, s: 0, c: 'System' }, { p: 812, pp: 4, t: 20_000_000, m: 104_857_600, s: 40_000, c: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "x"' }, 'junk', { p: 'x' }]);
  assert.deepEqual(a.get(812), { pid: 812, ppid: 4, pgid: 812, ageSec: 10, cpu: 20, rssKb: 102_400, command: '"C:\\Program Files\\Git\\bin\\bash.exe" -c "x"' });
  assert.equal(a.size, 2);
  now += 1000;
  const b = rows([{ p: 812, pp: 4, t: 25_000_000, m: 1024, s: 40_000, c: 'bash' }, { p: 4, pp: 0, t: 99, m: 0, s: 49_000, c: 'another, with the old pid' }]);
  assert.equal(b.get(812).cpu, 50, 'half a second of CPU in one second');
  assert.equal(b.get(4).ageSec, 2, 'a new process under an old pid is read afresh');
});

test('Windows: one PowerShell stays open for the process list; a line asks, a line answers; one that says nothing is ended', async () => {
  const started = [];
  const start = (cmd, args) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), killed: false, kill() { this.killed = true; this.emit('exit'); } });
    child.stdin.on('data', () => { if (!child.mute) child.stdout.write(`${JSON.stringify([{ p: 1, pp: 0, t: 0, m: 4096, s: 0, c: 'init' }])}\r\n`); });
    started.push({ cmd, args, child });
    return child;
  };
  const read = makeWinReader({ shell: POWERSHELL, start, timeoutMs: 80 });
  assert.equal((await read()).get(1).command, 'init');
  assert.equal((await read()).size, 1);
  assert.equal(started.length, 1, 'the same PowerShell answers again');
  assert.equal(started[0].cmd, POWERSHELL, 'by its full path');
  assert.match(Buffer.from(started[0].args.at(-1), 'base64').toString('utf16le'), /Get-CimInstance Win32_Process/, 'its script goes as one encoded argument');
  started[0].child.mute = true;
  await assert.rejects(read(), /took too long/);
  assert.equal(started[0].child.killed, true);
  assert.equal((await read()).size, 1, 'the next reading starts a new one');
  assert.equal(started.length, 2);
  read.close();
});

test("a session's shell commands are known whatever shell runs them, and Claude Code by its command line", () => {
  const shell = command => isShellCommand({ pid: 5, ppid: 1, pgid: 5, command }, 1);
  assert.ok(shell("/bin/zsh -c source /x/.claude/shell-snapshots/snapshot-zsh-1-a.sh 2>/dev/null || true && eval 'npm test' < /dev/null && pwd -P >| /tmp/c"));
  assert.ok(shell("/opt/homebrew/bin/bash -c source /Users/me/.claude/shell-snapshots/snapshot-bash-1.sh && eval 'x'"), 'a shell installed elsewhere (Homebrew)');
  assert.ok(shell('/usr/bin/bash -l -c source /home/me/.claude/shell-snapshots/snapshot-bash-1.sh'), 'Linux');
  assert.ok(shell('"C:\\Program Files\\Git\\bin\\bash.exe" -c "source C:\\Users\\me\\.claude\\shell-snapshots\\snapshot-bash-1.sh && eval x"'), "Windows: Git's bash, its path in quotes");
  assert.equal(shell('/bin/zsh -c echo hi'), false);
  assert.equal(shell('node /x/shell-snapshots/snapshot-1'), false);
  assert.equal(typedCommand("/opt/homebrew/bin/bash -c source /s/shell-snapshots/snapshot-bash-1.sh && eval 'npm test' < /dev/null && pwd -P >| /tmp/c"), 'npm test');
  for (const c of ['claude', '/Users/me/.local/bin/claude --resume x', 'C:\\Users\\me\\.local\\bin\\claude.exe', '"C:\\Users\\me\\.local\\bin\\claude.exe" --resume x', 'node /x/bin/claude']) assert.ok(isClaudeCommand(c), c);
  for (const c of ['', null, 'claudette', '/usr/bin/vim claude.md', 'node server.js']) assert.equal(isClaudeCommand(c), false, String(c));
});

test('ending a session and stopping a command: by signals where the system has them, by taskkill on Windows', async () => {
  const ran = [];
  const runner = async (cmd, args) => { ran.push([cmd, ...args]); return ok(cmd === 'ps' ? (args[1] === 'tty=' ? 'ttys004\n' : '/bin/claude\n') : ''); };
  const procs = new Map([[9, { pid: 9, command: 'claude --resume x' }]]);
  const mac = makeSessionProcs({ platform: 'darwin', runner });
  assert.equal(await mac.commandOf(9), '/bin/claude');
  assert.equal(await mac.ttyOf(9), 'ttys004');
  const linux = makeSessionProcs({ platform: 'linux', runner, readProcs: async () => procs });
  assert.equal(await linux.commandOf(9), 'claude --resume x', 'from the process list: no ps');
  assert.equal(await linux.ttyOf(9), null, 'its window closes by itself there');
  const win = makeSessionProcs({ platform: 'win32', runner, readProcs: async () => procs });
  assert.equal(await win.commandOf(7), null);
  win.killGroup(4321, 'SIGTERM');
  assert.deepEqual(ran.at(-1), ['taskkill', '/PID', '4321', '/T', '/F'], 'the command and everything it started');
  assert.equal(win.alive(process.pid), true);
  assert.equal(win.groupAlive(2 ** 30), false);
});

test('a program is found by PATH (and PATHEXT on Windows); the usual folders are added to a service’s bare PATH', async () => {
  const files = new Set(['/usr/bin/git', '/home/me/.local/bin/claude', 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd', 'C:\\Program Files\\Git\\cmd\\git.exe']);
  const isFileAt = p => files.has(p);
  assert.equal(which('claude', { platform: 'linux', env: { PATH: '/usr/bin:/home/me/.local/bin' }, isFileAt }), '/home/me/.local/bin/claude');
  assert.equal(which('gh', { platform: 'linux', env: { PATH: '/usr/bin' }, isFileAt }), null);
  assert.equal(which('/usr/bin/git', { platform: 'linux', env: {}, isFileAt }), '/usr/bin/git');
  const winEnv = { Path: 'C:\\Windows;C:\\Users\\me\\AppData\\Roaming\\npm;C:\\Program Files\\Git\\cmd', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const onWindows = p => [...files].some(f => f.toLowerCase() === p.toLowerCase()); // its file names ignore case
  assert.equal(which('claude', { platform: 'win32', env: winEnv, isFileAt: onWindows }), 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.CMD', 'Windows names its PATH "Path", and a program by an extension');
  assert.equal(which('git', { platform: 'win32', env: winEnv, isFileAt: onWindows }), 'C:\\Program Files\\Git\\cmd\\git.EXE');
  files.add('C:\\Users\\me\\AppData\\Roaming\\npm\\claude'); // npm's script for another shell, beside its claude.cmd
  assert.equal(which('claude', { platform: 'win32', env: winEnv, isFileAt: onWindows }), 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.CMD', 'a file with none of PATHEXT’s endings is not a program there');
  assert.equal(which('git.exe', { platform: 'win32', env: winEnv, isFileAt: onWindows }), 'C:\\Program Files\\Git\\cmd\\git.exe', 'a name that has its ending is taken as it is');
  assert.ok(usualDirs({ platform: 'linux', home: '/home/me', env: {} }).includes('/home/me/.local/bin'));
  assert.ok(usualDirs({ platform: 'darwin', home: '/Users/me', env: {} }).includes('/opt/homebrew/bin'));
  assert.ok(usualDirs({ platform: 'win32', home: 'C:\\Users\\me', env: {} }).includes('C:\\Users\\me\\.local\\bin'));
  // the login shell is asked for its PATH, between marks (its start-up files may print lines of their own)
  const runner = async (cmd, args) => { assert.deepEqual([cmd, args[0]], ['/bin/zsh', '-ilc']); return ok('Welcome!\n\n__AGENTVILLE_PATH__/custom/bin:/usr/bin__END__\n'); };
  assert.equal(await shellPath({ platform: 'darwin', shell: '/bin/zsh', runner }), '/custom/bin:/usr/bin');
  assert.equal(await shellPath({ platform: 'win32', shell: '/bin/zsh', runner }), null);
  assert.equal(await shellPath({ platform: 'linux', shell: '/usr/bin/nushell', runner }), null, 'a shell that takes no such line is not asked');
  const path = await fullPath({ platform: 'linux', env: { PATH: '/usr/bin:/bin' }, home: '/home/me', node: '/opt/node/bin/node', shell: '/bin/bash', runner: async () => ok('__AGENTVILLE_PATH__/custom/bin:/usr/bin__END__'), exists: d => d === '/home/me/.local/bin' || d === '/usr/bin' });
  assert.equal(path, '/opt/node/bin:/usr/bin:/bin:/custom/bin:/home/me/.local/bin', "Node's own folder first, each folder once");
});

test('Windows: a .cmd is run by cmd.exe, and an argument cmd.exe would read as more than a word is refused', () => {
  const find = name => ({ claude: 'C:\\npm\\claude.cmd', git: 'C:\\Git\\git.exe' }[name] ?? null);
  const env = { ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
  assert.deepEqual(spawnSpec('git', ['status'], { platform: 'linux' }), { file: 'git', args: ['status'], options: {} });
  assert.deepEqual(spawnSpec('git', ['status'], { platform: 'win32', env, find }), { file: 'C:\\Git\\git.exe', args: ['status'], options: { windowsHide: true } });
  const cmd = spawnSpec('claude', ['plugin', 'details', 'my plugin'], { platform: 'win32', env, find });
  assert.equal(cmd.file, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(cmd.args, ['/d', '/s', '/c', '"C:\\npm\\claude.cmd plugin details "my plugin""']);
  assert.equal(cmd.options.windowsVerbatimArguments, true);
  assert.deepEqual(cmd.env, { NoDefaultCurrentDirectoryInExePath: '1' }, "nor does the batch file's own `node` come from the folder it runs in");
  for (const bad of ['a&calc', 'x|y', '%PATH%', '"q"', 'a^b', 'line\nbreak', '<in', '>out', '!v!']) assert.match(spawnSpec('claude', ['rm', bad], { platform: 'win32', env, find }).error ?? '', /can't be passed/, bad);
  assert.deepEqual(spawnSpec('gh', ['pr', 'list'], { platform: 'win32', env, find }), { error: '"gh" was not found' }, 'never by its bare name: Windows would look in the folder it starts in (a repo) before PATH');
  assert.deepEqual(spawnSpec('claude', [], { platform: 'win32', env: {}, find }), { error: 'cmd.exe was not found' });
});

test('the line a terminal runs: a Unix shell’s, or PowerShell’s on Windows, with every word from outside quoted', () => {
  assert.equal(claudeCommand("/a b/it's", undefined, 'plan', { model: 'sonnet', effort: 'high' }), "cd '/a b/it'\\''s' && exec claude --permission-mode plan --model 'sonnet' --effort high");
  // PowerShell's line first finds out whether claude is a batch file here (its words then pass through cmd.exe): the same words every time.
  const SETUP = "$avClaude = Get-Command claude -ErrorAction SilentlyContinue | Select-Object -First 1; $avBatch = -not ($avClaude -and ($avClaude.CommandType -eq 'ExternalScript' -or ($avClaude.CommandType -eq 'Application' -and $avClaude.Path -match '\\.exe$'))); if ($avBatch) { $env:NoDefaultCurrentDirectoryInExePath = '1' }; ";
  const rest = line => { assert.equal(line.split(SETUP).length, 2, line); return line.replace(SETUP, ''); };
  assert.equal(rest(claudeCommand("C:\\Users\\o'x", undefined, 'plan', { model: 'opus[1m]', shell: 'powershell' })), "Set-Location -LiteralPath 'C:\\Users\\o''x'; claude --permission-mode plan --model 'opus[1m]'");
  const account = { dir: process.platform === 'win32' ? 'C:\\Users\\me\\.claude-home' : '/Users/me/.claude-home' };
  assert.match(rest(claudeCommand('/w', '0123abcd-0000-4000-8000-000000000000', 'default', { account, shell: 'powershell' })), /; \$env:CLAUDE_CONFIG_DIR = '[^']+\.claude-home'; claude --resume 0123abcd-/);
  assert.match(rest(claudeCommand('/w', undefined, 'default', { account: { first: true }, shell: 'powershell' })), /; Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue; claude$/);
  const prefill = rest(claudeCommand('/w', undefined, 'default', { prefillFile: "C:\\t\\it's.txt", shell: 'powershell' }));
  assert.equal(prefill, "Set-Location -LiteralPath '/w'; $avFill = @(); $avText = Get-Content -Raw -Encoding UTF8 -LiteralPath 'C:\\t\\it''s.txt'; "
    + `if ($avText -and -not ($avBatch -and $avText -match '[&|<>^%!"\\r\\n]')) { $avFill = @('--prefill', ($avText -replace '(\\\\*)"', '$1$1\\"' -replace '(\\\\+)$', '$1$1')) } `
    + "elseif ($avText) { Write-Warning 'The text for the prompt box was left out: claude is a batch file here, which can not be given it safely.' }; claude @avFill",
  "the text is read from its file, its quotes escaped the way a Windows program reads them back; a batch file gets it only when cmd.exe would act on nothing in it");
  assert.equal(rest(forkCommand('/w', process.platform === 'win32' ? 'C:\\f\\c.jsonl' : '/f/c.jsonl', 'default', { name: "it's", shell: 'powershell' })).replace(/'[^']*c\.jsonl'/, "'COPY'"), "Set-Location -LiteralPath '/w'; claude --resume 'COPY' --fork-session --name 'it''s'");
  assert.equal(mcpLoginCommand("git'hub"), "cd ~ && exec claude mcp login 'git'\\''hub'");
  assert.equal(rest(mcpLoginCommand("git'hub", 'powershell')), "Set-Location -LiteralPath $HOME; claude mcp login 'git''hub'");
  assert.equal(attachCommand('abc-1'), 'claude attach abc-1');
  assert.equal(rest(attachCommand('abc-1', null, 'powershell')), 'claude attach abc-1');
  assert.throws(() => claudeCommand('/w', 'not-an-id', 'default', { shell: 'powershell' }), /not a session id/);
  // PowerShell reads the typographic quotes as its own: each is doubled, or a folder's name could end the word and run what follows.
  assert.equal(psQuote('x\u2019;calc;\u2018y\u201a\u201b'), "'x\u2019\u2019;calc;\u2018\u2018y\u201a\u201a\u201b\u201b'");
  assert.equal(rest(claudeCommand('C:\\w\\x\u2019;calc;\u2018', undefined, 'default', { shell: 'powershell' })), "Set-Location -LiteralPath 'C:\\w\\x\u2019\u2019;calc;\u2018\u2018'; claude");
  // Windows PowerShell hands a program a double quote as it is: a name loses them, a word that must stay as it is is refused.
  const copy = process.platform === 'win32' ? 'C:\\f\\c.jsonl' : '/f/c.jsonl';
  const named = name => / --name (.*)$/.exec(forkCommand('/w', copy, 'default', { name, shell: 'powershell' }))?.[1] ?? null;
  assert.equal(named('a" --dangerously-skip-permissions "b (fork)'), "'a'' --dangerously-skip-permissions ''b (fork)'", 'one word still');
  assert.equal(named('ends in a backslash\\'), "'ends in a backslash'");
  assert.equal(named('--help'), "'help'");
  assert.equal(named(' -x'), "'x'", 'nor behind a space');
  assert.equal(named('\u0003\n'), null, 'nothing left: no --name at all');
  assert.throws(() => mcpLoginCommand('a" --flag "b', 'powershell'), /can't be passed/);
  assert.throws(() => mcpLoginCommand('--help', 'powershell'), /can't be passed/);
  // Where claude is a batch file, PowerShell passes its words through cmd.exe: a name never holds what that reads as its own.
  assert.throws(() => mcpLoginCommand('a&calc', 'powershell'), /can't be passed/);
  assert.equal(named('50% & more (fork)'), "'50    more (fork)'");
  assert.equal(mcpLoginCommand('a&b'), "cd ~ && exec claude mcp login 'a&b'", 'a Unix shell passes it as it is');
});

test('a word for a Unix shell is read the same by sh and by fish, which macOS may type the line into', () => {
  // In fish's single quotes \' and \\ are escapes: no quoted part holds a quote or a backslash, both stand outside behind a backslash.
  assert.equal(shellQuote("it's"), "'it'\\''s'");
  assert.equal(shellQuote('a\\b'), "'a'\\\\'b'");
  assert.equal(shellQuote("x\\'; touch /tmp/p #"), "'x'\\\\''\\''; touch /tmp/p #'");
  for (const part of shellQuote("a\\'b\\\\c''d").split(/\\./)) assert.doesNotMatch(part.replace(/^'|'$/g, ''), /['\\]/, part);
});

test('Windows: a path an agent named on another machine is never looked at, unless the session runs on that share', () => {
  for (const p of ['\\\\evil\\share\\spec.md', '//evil/share/spec.md', '\\\\?\\C:\\x', '\\\\.\\pipe\\x']) {
    assert.equal(isNetworkPath(p, 'win32'), true, p);
    assert.equal(mayLookAt(p, 'C:\\code\\api', 'win32'), false, p);
    assert.equal(mayLookAt(p, null, 'win32'), false, p);
    assert.equal(mayLookAt(p, '/code/api', 'linux'), true, 'elsewhere two slashes are a folder here');
  }
  assert.equal(mayLookAt('C:\\code\\api\\a.md', 'C:\\code\\api', 'win32'), true);
  assert.equal(mayLookAt('\\\\NAS\\code\\api\\a.md', '//nas/code/api', 'win32'), true, "the session's own share, however it is spelled");
  assert.equal(mayLookAt('\\\\nas\\other\\a.md', '\\\\nas\\code\\api', 'win32'), false, 'another share of the same machine');
  assert.equal(mayLookAt('\\\\nas.evil.example\\code\\a.md', '\\\\nas\\code', 'win32'), false);
  assert.equal(mayLookAt('\\\\?\\UNC\\evil\\share\\a', '\\\\?\\UNC\\evil\\share', 'win32'), false, 'a device path is never a share');
});

test('a line for a terminal never holds a control character, and a word after a script is never read as an option', () => {
  // Terminal and iTerm are typed the line: a Ctrl-C inside a quoted folder name would end the line being typed and start another.
  for (const cwd of ['/w/a\u0003b', '/w/a\nb', '/w/a\u001b[2Jb', '/w/a\u007fb', '/w/a\u2028b']) {
    assert.throws(() => claudeCommand(cwd), /control character/, JSON.stringify(cwd));
    assert.throws(() => forkCommand(cwd, '/f/c.jsonl'), /control character/);
  }
  assert.throws(() => claudeCommand('/w', undefined, 'default', { prefillFile: '/t/a\nb' }), /control character/);
  assert.throws(() => claudeCommand('/w', undefined, 'default', { account: { dir: '/h/.claude-a\u0003' } }), /control character/);
  assert.equal(forkCommand('/w', '/f/c.jsonl', 'default', { name: 'a\u0003b\nc' }), "cd '/w' && exec claude --resume '/f/c.jsonl' --fork-session --name 'a b c'", 'a name loses them');
  assert.throws(() => mcpLoginCommand('--help'), /can't be passed/, 'a server named like an option');
  assert.throws(() => mcpLoginCommand('a\nb'), /control character/);
  assert.equal(mcpLoginCommand("it's"), "cd ~ && exec claude mcp login 'it'\\''s'");
  assert.deepEqual(terminalScript('Terminal', '-e x').slice(-2), ['--', '-e x']);
  assert.deepEqual(closeTerminalScript('iTerm', '/dev/ttys004').slice(-2), ['--', '/dev/ttys004']);
});

/** A desktop with stand-ins: what was run or started, and which programs it "has". */
function desktop(platform, { has = [], env = {}, answer = () => ok(), shell = '/bin/bash' } = {}) {
  const ran = [];
  const find = name => (platform !== 'win32' ? (has.includes(name) ? `/usr/bin/${name}` : null) : name === 'powershell' ? POWERSHELL : has.includes(name) ? `C:\\bin\\${name}.EXE` : null);
  const d = makeDesktop({ platform, env, home: platform === 'win32' ? 'C:\\Users\\me' : '/home/me', shell: platform === 'win32' ? null : shell, find, exists: p => ['D:\\', 'C:\\'].includes(p),
    runner: async (cmd, args, opts) => { ran.push({ cmd, args, opts }); return answer(cmd, args); }, starter: async (cmd, args) => { ran.push({ cmd, args, started: true }); return ok(); } });
  const launched = [];
  const launch = async (args, how = {}) => { launched.push({ args, ...how }); return ok(); };
  return { d, ran, launched, launch };
}

test('macOS: Terminal or iTerm through osascript, the command as an argument; the window is closed by its tty', async () => {
  const { d, launched, launch } = desktop('darwin');
  assert.deepEqual(d.terminals(), ['Terminal', 'iTerm']);
  assert.equal(d.shell, 'sh');
  for (const legacy of ['auto', 'Terminal', undefined, 'nonsense']) assert.equal(d.terminalOf(legacy), 'Terminal');
  assert.deepEqual(await d.openTerminal('iTerm', "cd '/w' && exec claude", { launch }), { ok: true, terminal: 'iTerm' });
  assert.equal(launched[0].cmd, 'osascript');
  assert.equal(launched[0].args.at(-1), "cd '/w' && exec claude");
  assert.ok(launched[0].args.includes('tell application "iTerm"'));
  const closing = desktop('darwin');
  const launchClose = async (args, how) => { closing.launched.push({ args, ...how }); return ok(args.includes('tell application "Terminal"') ? 'closed\n' : 'none\n'); };
  assert.equal(await closing.d.closeTerminal('iTerm', 'ttys042', { launch: launchClose }), true);
  assert.deepEqual(closing.launched.map(l => l.args.at(-1)), ['/dev/ttys042', '/dev/ttys042'], 'the chosen app first, then the other');
  assert.equal(await closing.d.closeTerminal('auto', null, { launch: launchClose }), false);
});

test('Linux: the terminal emulator that is installed runs the line in your login shell; with no screen, tmux; with neither, it says so', async () => {
  const gui = desktop('linux', { has: ['gnome-terminal', 'xterm', 'tmux'], env: { DISPLAY: ':0' } });
  assert.deepEqual(gui.d.terminals(), ['gnome-terminal', 'xterm', 'tmux']);
  assert.deepEqual(await gui.d.openTerminal('auto', "cd '/w' && exec claude", { cwd: '/w', launch: gui.launch }), { ok: true, terminal: 'gnome-terminal' });
  assert.deepEqual(gui.launched[0], { args: ['--', '/bin/bash', '-lic', "cd '/w' && exec claude"], cmd: 'gnome-terminal', detached: true, cwd: '/w' });
  await gui.d.openTerminal('xterm', 'x', { launch: gui.launch });
  assert.deepEqual(gui.launched[1].args, ['-e', '/bin/bash', '-lic', 'x']);
  assert.equal(await gui.d.closeTerminal('auto', 'pts/3', { launch: gui.launch }), false, 'its window closes when Claude ends');
  const kgx = desktop('linux', { has: ['kgx'], env: { WAYLAND_DISPLAY: 'wayland-0' } });
  await kgx.d.openTerminal('auto', "cd '/a b' && exec claude", { launch: kgx.launch });
  assert.deepEqual(kgx.launched[0].args, ['-e', `'/bin/bash' '-lic' 'cd '\\''/a b'\\'' && exec claude'`], 'one that takes a single line gets it quoted');
  const headless = desktop('linux', { has: ['gnome-terminal', 'tmux'], env: {} });
  assert.deepEqual(headless.d.terminals(), ['tmux'], 'no screen: an emulator could not open');
  const opened = await headless.d.openTerminal('auto', 'exec claude', { cwd: '/w', launch: headless.launch });
  assert.equal(opened.terminal, 'tmux');
  assert.match(opened.note, /^Running in tmux\. Attach with: tmux attach -t agentville-/);
  assert.deepEqual(headless.launched[0].args.toSpliced(3, 1), ['new-session', '-d', '-s', '/bin/bash', '-lic', 'exec claude'], 'the folder is never an argument of tmux, which would run a #(…) in it');
  assert.equal(headless.launched[0].cwd, '/w', 'it starts there instead');
  const fish = desktop('linux', { has: ['xterm'], env: { DISPLAY: ':0' }, shell: '/usr/bin/fish' });
  const line = "cd '/w/it'\\''s \\' && exec claude";
  await fish.d.openTerminal('auto', line, { launch: fish.launch });
  assert.deepEqual(fish.launched[0].args, ['-e', '/usr/bin/fish', '-lic', `exec /bin/sh -c ${fishQuote(line)}`], "fish quotes its own way: it hands the line, written for sh, to sh as one word");
  assert.equal(fishQuote("a\\'b"), "'a\\\\\\'b'", 'a backslash and a quote, each behind a backslash');
  const bare = desktop('linux', { env: {} });
  assert.match((await bare.d.openTerminal('auto', 'x', { launch: bare.launch })).error, /No display.*tmux/);
  assert.match((await bare.d.chooseFolder({ start: '/home/me', prompt: 'Pick' })).error, /Type the path/);
  assert.equal((await bare.d.notify('a', 'b')).code, 1, 'no notify-send: nothing is sent, nothing breaks');
});

test('Linux: notify-send, zenity’s folder window, the file manager through xdg-open', async () => {
  const { d, ran } = desktop('linux', { has: ['notify-send', 'zenity', 'xdg-open'], env: { DISPLAY: ':0' }, answer: cmd => (cmd === 'zenity' ? ok('/home/me/code\n') : ok()) });
  await d.notify('--title', '$(rm -rf ~)');
  assert.deepEqual(ran[0].args, ['--app-name=Agentville', '--', '--title', '$(rm -rf ~)'], 'words are arguments after --, never options or a script');
  assert.deepEqual(await d.chooseFolder({ start: '/home/me', prompt: 'Pick' }), { path: '/home/me/code' });
  await d.revealFile('/home/me/code/a b.txt');
  assert.deepEqual([ran.at(-1).cmd, ran.at(-1).args], ['xdg-open', ['/home/me/code']], 'a file is never opened: its folder is shown');
  await d.openUrl('http://localhost:7777');
  assert.deepEqual(ran.at(-1).args, ['http://localhost:7777']);
  assert.deepEqual(d.folderRoots(), ['/home/me', '/media', '/mnt', '/run/media']);
  assert.match(d.scratchBase(), /^\/tmp\/claude-\d+$/);
});

test('Windows: PowerShell in a console of its own (or Windows Terminal), its line encoded; toasts and the folder window get their words by environment', async () => {
  const plain = desktop('win32', { env: { TEMP: 'C:\\Users\\me\\AppData\\Local\\Temp' } });
  assert.deepEqual(plain.d.terminals(), ['PowerShell']);
  assert.equal(plain.d.shell, 'powershell');
  const line = "Set-Location -LiteralPath 'C:\\w'; claude";
  assert.deepEqual(await plain.d.openTerminal('auto', line, { cwd: 'C:\\w', launch: plain.launch }), { ok: true, terminal: 'PowerShell' });
  assert.equal(plain.launched[0].cmd, POWERSHELL, 'by its full path: a bare name would be looked for in the folder first');
  assert.equal(plain.launched[0].cwd, 'C:\\Users\\me', "and from your home, not the session's folder (the line goes there itself)");
  assert.equal(plain.launched[0].detached, true);
  const sent = Buffer.from(plain.launched[0].args.at(-1), 'base64').toString('utf16le');
  assert.equal(sent, windowsLine(line), 'the line needs no quoting on its way');
  assert.ok(sent.includes(`${line}; $avCode = $LASTEXITCODE;`) && sent.endsWith('; exit 0'), "the shell ends with 0, so a window that Claude's end leaves behind closes by itself");
  assert.deepEqual(plain.launched[0].args.slice(0, 3), ['-NoLogo', '-ExecutionPolicy', 'Bypass']);
  const wt = desktop('win32', { has: ['wt'] });
  assert.deepEqual(wt.d.terminals(), ['Windows Terminal', 'PowerShell']);
  await wt.d.openTerminal('auto', line, { cwd: 'C:\\w', launch: wt.launch });
  assert.deepEqual([wt.launched[0].cmd, ...wt.launched[0].args.slice(0, 3), wt.launched[0].cwd], ['C:\\bin\\wt.EXE', '-w', 'new', POWERSHELL, 'C:\\Users\\me']);
  await plain.d.notify('Title "x"', "It's `done` $(now)");
  assert.equal(plain.ran[0].cmd, 'powershell.exe', 'the runner finds it by PATH (spawnSpec)');
  assert.deepEqual(plain.ran[0].opts.env, { AGENTVILLE_TITLE: 'Title "x"', AGENTVILLE_TEXT: "It's `done` $(now)" });
  assert.doesNotMatch(Buffer.from(plain.ran[0].args.at(-1), 'base64').toString('utf16le'), /Title|done/, 'never inside the script');
  const picked = desktop('win32', { answer: () => ok('D:\\code\\api') });
  assert.deepEqual(await picked.d.chooseFolder({ start: 'C:\\Users\\me', prompt: 'Pick' }), { path: 'D:\\code\\api' });
  assert.deepEqual(await plain.d.chooseFolder({ start: 'C:\\Users\\me', prompt: 'Pick' }), { cancelled: true });
  assert.deepEqual(plain.d.folderRoots(), ['C:\\Users\\me', 'D:\\'], 'your home, and the other drives');
  assert.equal(plain.d.scratchBase(), 'C:\\Users\\me\\AppData\\Local\\Temp\\claude');
  await plain.d.revealFile('C:\\w\\a b.txt');
  assert.deepEqual([plain.ran.at(-1).cmd, plain.ran.at(-1).args, plain.ran.at(-1).opts.verbatim], ['explorer.exe', ['/select,"C:\\w\\a b.txt"'], true], 'in quotes, given as they are: Explorer reads its own line, and a comma in a name ends the path otherwise');
  await plain.d.revealFile('C:\\w\\a,b.txt');
  assert.deepEqual(plain.ran.at(-1).args, ['/select,"C:\\w\\a,b.txt"']);
  assert.equal((await plain.d.revealFile('C:\\w\\x"y')).code, 1, 'a quote is in no file name: refused, never put into the line');
  await plain.d.openFolder('C:\\w\\a,b');
  assert.deepEqual([plain.ran.at(-1).cmd, plain.ran.at(-1).args], ['explorer.exe', ['"C:\\w\\a,b"']]);
});

test('a Word document or a slide deck: macOS reads it itself, elsewhere LibreOffice does, and without it the reader says so', async () => {
  const mac = desktop('darwin', { answer: (cmd, args) => ok(args[1] === 'html' ? '<p>hi</p>' : 'hi') });
  assert.deepEqual(await mac.d.readWord('/w/a.docx'), { html: '<p>hi</p>', text: 'hi' });
  const none = desktop('linux', { env: { DISPLAY: ':0' } });
  assert.match((await none.d.readWord('/w/a.docx')).error, /LibreOffice is needed/);
  await assert.rejects(none.d.firstPage('/w/a.pptx'), /LibreOffice is needed/);
});
