// Setting Agentville up with nothing prepared: where its data is, how each system keeps the collector running
// (collector/service.mjs), the mod where sessions load it from (collector/mod-link.mjs), and the one command.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { adoptLegacyData, dataDirOf } from '../paths.mjs';
import { installMod, linkMod, syncMod } from '../mod-link.mjs';
import { LABEL, launchdPlist, serviceFor, systemdUnit, unitQuote } from '../service.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CLI = join(ROOT, 'bin', 'agentville.mjs');
const temp = () => mkdtempSync(join(tmpdir(), 'tracker-install-'));
const ok = (stdout = '') => ({ code: 0, stdout, stderr: '' }), no = (stderr = 'no') => ({ code: 1, stdout: '', stderr });

test('the data folder is ~/.agentville on every system; a clone’s old state and settings are brought over once, never over newer ones', () => {
  assert.equal(dataDirOf({}, '/home/me'), join('/home/me', '.agentville'));
  assert.equal(dataDirOf({ AGENTVILLE_HOME: join(tmpdir(), 'second') }, '/home/me'), join(tmpdir(), 'second'));
  const clone = temp(), data = join(temp(), 'data');
  mkdirSync(join(clone, 'state', 'notes'), { recursive: true });
  mkdirSync(join(clone, 'collector'));
  writeFileSync(join(clone, 'collector', 'index.mjs'), '');
  writeFileSync(join(clone, 'state', 'token'), 'a'.repeat(64), { mode: 0o600 });
  writeFileSync(join(clone, 'state', 'notes', 'n.json'), '{}');
  writeFileSync(join(clone, 'config.json'), '{"port":7001}');
  const logged = [];
  assert.deepEqual(adoptLegacyData({ codeRoot: clone, dataDir: data, log: m => logged.push(m) }), ['state', 'config.json']);
  assert.equal(readFileSync(join(data, 'state', 'token'), 'utf8'), 'a'.repeat(64), 'the token: open pages and sessions keep working');
  if (process.platform !== 'win32') assert.equal(statSync(join(data, 'state', 'token')).mode & 0o777, 0o600);
  assert.ok(existsSync(join(data, 'state', 'notes', 'n.json')) && existsSync(join(clone, 'state', 'token')), 'copied: the clone keeps its own');
  assert.match(logged[0], /brought over/);
  writeFileSync(join(data, 'config.json'), '{"port":7002}');
  writeFileSync(join(clone, 'state', 'token'), 'b'.repeat(64));
  assert.deepEqual(adoptLegacyData({ codeRoot: clone, dataDir: data }), [], 'once: what is there now is never replaced');
  assert.equal(readFileSync(join(data, 'config.json'), 'utf8'), '{"port":7002}');
  assert.deepEqual(adoptLegacyData({ codeRoot: temp(), dataDir: join(temp(), 'fresh') }), [], 'a fresh install has nothing to bring');
});

test('macOS: the launchd agent runs this Node with `agentville run`, at login and again when it ends; nothing in it is a template', () => {
  const plist = launchdPlist({ node: '/opt/node & co/bin/node', script: '/lib/<agentville>/bin/agentville.mjs', logFile: '/Users/me/.agentville/logs/service.log' });
  assert.match(plist, new RegExp(`<key>Label</key><string>${LABEL}</string>`));
  assert.match(plist, /<array><string>\/opt\/node &amp; co\/bin\/node<\/string><string>\/lib\/&lt;agentville&gt;\/bin\/agentville\.mjs<\/string><string>run<\/string><\/array>/, 'paths are escaped');
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>\s*<key>KeepAlive<\/key><true\/>/);
  assert.doesNotMatch(plist, /EnvironmentVariables|__ROOT__|bash/, 'no environment is needed, and no shell script in between');
  assert.match(launchdPlist({ node: 'n', script: 's', logFile: 'l', env: { AGENTVILLE_HOME: '/tmp/second' } }), /<key>EnvironmentVariables<\/key>\s*<dict>\s*<key>AGENTVILLE_HOME<\/key><string>\/tmp\/second<\/string>/, 'only a second copy’s data folder is named');
});

test('Linux: the systemd user unit, its words quoted as systemd reads them', () => {
  const unit = systemdUnit({ node: '/home/me/my node/bin/node', script: '/home/me/100%/a"b/$x/agentville.mjs', logFile: '/home/me/.agentville/logs/service.log' });
  assert.match(unit, /^ExecStart="\/home\/me\/my node\/bin\/node" "\/home\/me\/100%%\/a\\"b\/\$\$x\/agentville\.mjs" run$/m);
  assert.match(unit, /^Restart=always$/m);
  assert.match(unit, /^WantedBy=default\.target$/m);
  assert.match(unit, /^StandardOutput=append:\/home\/me\/\.agentville\/logs\/service\.log$/m);
  assert.doesNotMatch(unit, /^Environment=/m);
  assert.equal(unitQuote('a\\b'), '"a\\\\b"');
});

test('each system’s way to keep it running: launchd, systemd (with lingering asked for), a background process with a login entry on Windows', async () => {
  const home = temp(), dataDir = join(home, '.agentville');
  // macOS
  const ran = [];
  let loaded = false;
  const mac = await serviceFor({ platform: 'darwin', home, node: '/n/node', script: '/s/agentville.mjs', dataDir, runner: async (cmd, args) => {
    ran.push([cmd, ...args]);
    if (args[0] === 'print') return loaded ? ok('\tstate = running\n\tpid = 4242\n') : no();
    if (args[0] === 'bootstrap') loaded = true;
    if (args[0] === 'bootout') loaded = false;
    return ok();
  } });
  assert.equal(await mac.installed(), false);
  await mac.install();
  assert.ok(existsSync(join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`)));
  assert.ok(ran.some(r => r[1] === 'bootout' && r[2].endsWith('/local.agent-tracker')), 'the service under its first name is taken out');
  assert.deepEqual(await mac.state(), { running: true, pid: 4242 });
  await mac.restart();
  assert.deepEqual(ran.at(-1).slice(0, 3), ['launchctl', 'kickstart', '-k']);
  await mac.uninstall();
  assert.equal(await mac.installed(), false);
  // Linux with systemd
  const sys = [];
  const linux = await serviceFor({ platform: 'linux', home, node: '/n/node', script: '/s/agentville.mjs', dataDir, runner: async (cmd, args) => {
    sys.push([cmd, ...args].join(' '));
    if (cmd === 'loginctl') return no('Interactive authentication required');
    if (args.includes('is-active')) return ok('active\n');
    if (args.includes('MainPID')) return ok('777\n');
    return ok();
  } });
  assert.equal(linux.kind, 'systemd user service');
  const note = await linux.install();
  assert.match(note, /enable-linger/, 'where lingering can’t be switched on, it says how');
  assert.ok(sys.includes('systemctl --user enable --now agentville.service'));
  assert.ok(sys.some(l => l.startsWith('loginctl enable-linger ')));
  assert.deepEqual(await linux.state(), { running: true, pid: 777 });
  // Linux without systemd, and Windows: a process of its own; Windows also starts it at login, from the user's own Run key
  const bare = await serviceFor({ platform: 'linux', home, node: '/n/node', script: '/s/agentville.mjs', dataDir, runner: async () => no() });
  assert.equal(bare.kind, 'background process');
  assert.equal(bare.startsAtLogin, false);
  assert.deepEqual(await bare.state(), { running: false, pid: null });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(dataDir, 'collector.pid'), `${process.pid}\n`);
  assert.deepEqual(await bare.state(), { running: true, pid: process.pid }, 'found by the pid file the collector writes');
  writeFileSync(join(dataDir, 'collector.pid'), '999999999\n');
  assert.equal((await bare.state()).running, false, 'a pid file left behind is not a running collector');
  const reg = [];
  const win = await serviceFor({ platform: 'win32', home, node: 'C:\\n\\node.exe', script: 'C:\\s\\agentville.mjs', dataDir, runner: async (cmd, args) => { reg.push([cmd, ...args]); return args[0] === 'query' ? no() : ok(); } });
  assert.equal(win.startsAtLogin, true);
  assert.equal(await win.installed(), false);
  await win.uninstall();
  assert.deepEqual(reg.at(-1), ['reg.exe', 'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'Agentville', '/f']);
  // The login entry runs headless through conhost where it exists.
  const entry = async conhost => (await serviceFor({ platform: 'win32', home, node: 'C:\\Program Files\\nodejs\\node.exe', script: 'C:\\s\\agentville.mjs', dataDir, conhost, runner: async () => ok() })).loginLine;
  assert.equal(await entry('C:\\Windows\\System32\\conhost.exe'), '"C:\\Windows\\System32\\conhost.exe" --headless "C:\\Program Files\\nodejs\\node.exe" "C:\\s\\agentville.mjs" start');
  assert.equal(await entry(null), '"C:\\Program Files\\nodejs\\node.exe" "C:\\s\\agentville.mjs" start');
});

test('the mod: copied beside the state it reads, and named in settings.json without touching anything else there', () => {
  const dir = temp(), from = join(ROOT, 'mod'), modDir = join(dir, 'data', 'mod'), settingsFile = join(dir, 'claude', 'settings.json');
  const LIST = process.platform === 'win32' ? ';' : ':'; // what separates the folders on this system
  const written = installMod({ from, to: modDir });
  assert.ok(written.includes('.claude-plugin/plugin.json') && written.includes('hooks/register.tsx') && written.includes('hooks/hooks.json'));
  assert.ok(!written.some(f => f.startsWith('tests/') || f.includes('.claude-plugin/types')), 'only what a session loads');
  assert.deepEqual(installMod({ from, to: modDir }), [], 'again: nothing differs, nothing is written');
  assert.equal(linkMod({ settingsFile, modDir, on: false }), 'same', 'off, and no settings file: none is made');
  assert.equal(existsSync(settingsFile), false);
  assert.equal(linkMod({ settingsFile, modDir, on: true }), 'changed');
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { env: { CLAUDE_CODE_PLUGIN_DIRS: modDir } });
  // an earlier copy in a clone is replaced (a session must not load two), other plugin folders and settings stay
  const clone = join(dir, 'clone', 'mod');
  installMod({ from, to: clone });
  writeFileSync(settingsFile, JSON.stringify({ model: 'opus', env: { OTHER: '1', CLAUDE_CODE_PLUGIN_DIRS: `/plugins/mine${LIST}${clone}` } }));
  assert.equal(linkMod({ settingsFile, modDir, on: true }), 'changed');
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { model: 'opus', env: { OTHER: '1', CLAUDE_CODE_PLUGIN_DIRS: `/plugins/mine${LIST}${modDir}` } });
  assert.equal(linkMod({ settingsFile, modDir, on: true }), 'same');
  assert.equal(linkMod({ settingsFile, modDir, on: false }), 'changed');
  assert.deepEqual(JSON.parse(readFileSync(settingsFile, 'utf8')), { model: 'opus', env: { OTHER: '1', CLAUDE_CODE_PLUGIN_DIRS: '/plugins/mine' } });
  // switched off, another copy is not this one's to take out (a second collector beside the first)
  writeFileSync(settingsFile, JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: clone } }));
  assert.equal(linkMod({ settingsFile, modDir, on: false }), 'same');
  // Windows separates the folders with ;
  writeFileSync(settingsFile, JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: 'C:\\plugins\\mine' } }));
  linkMod({ settingsFile, modDir, on: true, platform: 'win32' });
  assert.equal(JSON.parse(readFileSync(settingsFile, 'utf8')).env.CLAUDE_CODE_PLUGIN_DIRS, `C:\\plugins\\mine;${modDir}`);
  // a second account that shares the first's settings.json by a link: the link stays, the shared file is written, once
  if (process.platform !== 'win32') {
    const shared = join(dir, 'shared'), other = join(dir, 'claude-home');
    mkdirSync(shared); mkdirSync(other);
    writeFileSync(join(shared, 'settings.json'), JSON.stringify({ model: 'opus' }));
    symlinkSync(join(shared, 'settings.json'), join(other, 'settings.json'));
    assert.deepEqual(syncMod({ from, modDir, accountDirs: [shared, other], on: true, platform: 'linux' }).changed, [join(shared, 'settings.json')]);
    assert.ok(lstatSync(join(other, 'settings.json')).isSymbolicLink(), 'still a link');
    assert.equal(JSON.parse(readFileSync(join(other, 'settings.json'), 'utf8')).env.CLAUDE_CODE_PLUGIN_DIRS, modDir);
  }
  writeFileSync(settingsFile, '{ not json');
  const logged = [];
  assert.deepEqual(syncMod({ from, modDir, accountDirs: [join(dir, 'claude'), join(dir, 'second')], on: true, platform: 'linux', log: m => logged.push(m) }).unreadable, [settingsFile]);
  assert.equal(readFileSync(settingsFile, 'utf8'), '{ not json', 'a file that is not JSON is left as it is');
  assert.ok(existsSync(join(dir, 'second', 'settings.json')), 'each account gets it');
  assert.ok(logged.some(l => /not JSON/.test(l)) && logged.some(l => /named in/.test(l)));
});

const cli = (args, env) => new Promise(resolve => execFile(process.execPath, [CLI, ...args], { env: { ...process.env, ...env }, timeout: 20_000 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr })));

test('the one command: nothing but `agentville run` is needed to have a dashboard, with no environment, no config file and no path set', async t => {
  const data = temp(), home = temp(), port = 20_000 + (process.pid % 20_000);
  mkdirSync(join(home, '.claude', 'sessions'), { recursive: true });
  writeFileSync(join(data, 'config.json'), JSON.stringify({ port }));
  // a bare environment, as a service gets: no PATH of yours, no variables of Agentville's but where its data is (a second copy)
  const env = { PATH: '/usr/bin:/bin', HOME: home, USERPROFILE: home, AGENTVILLE_HOME: data, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  const child = spawn(process.execPath, [CLI, 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  let out = '';
  child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { out += d; });
  const until = Date.now() + 20_000;
  let state = null;
  while (Date.now() < until && !state) {
    try { state = await (await fetch(`http://127.0.0.1:${port}/api/state`)).json(); } catch { await new Promise(r => setTimeout(r, 200)); }
  }
  assert.ok(Array.isArray(state?.agents), `it answers (${out})`);
  assert.match(out, new RegExp(`http://localhost:${port}`));
  assert.ok(existsSync(join(data, 'state', 'token')) && existsSync(join(data, 'logs', 'collector.log')) && existsSync(join(data, 'collector.pid')), 'its data is all in the one folder');
  assert.ok(existsSync(join(data, 'mod', '.claude-plugin', 'plugin.json')), 'the mod is beside its state');
  assert.equal(JSON.parse(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).env.CLAUDE_CODE_PLUGIN_DIRS, join(data, 'mod'), 'and named where sessions load it from');
  const status = await cli(['status'], env);
  assert.match(status.stdout, new RegExp(`dashboard: http://localhost:${port}`));
  const lan = await cli(['lan'], env);
  assert.match(lan.stdout, /Network access is off/);
  child.kill('SIGTERM');
  await new Promise(r => child.once('exit', r));
  if (process.platform !== 'win32') assert.equal(existsSync(join(data, 'collector.pid')), false, 'stopped: its pid file is gone');
});

test('the command’s other words: help, version, an unknown one', async () => {
  const env = { AGENTVILLE_HOME: temp() };
  const help = await cli(['help'], env);
  assert.match(help.stdout, /agentville run/);
  assert.match(help.stdout, /Settings: ⚙ in the dashboard/);
  assert.equal((await cli(['--version'], env)).stdout.trim(), JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version);
  const bad = await cli(['frobnicate'], env);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /no command "frobnicate"/);
});
