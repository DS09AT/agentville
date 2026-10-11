#!/usr/bin/env node
// agentville: the one command. It sets the collector up as something that runs by itself (at login, kept
// running), on macOS, Linux and Windows, with nothing to prepare: no environment, no config file, no path.
//   agentville            set it up if it is not, and say where the dashboard is
//   agentville run        the collector itself, in this terminal (what the service runs)
// Everything else it has is in `agentville help`. Settings are in the dashboard's Settings window.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [major] = process.versions.node.split('.').map(Number);
if (major < 22) { console.error(`Agentville needs Node.js 22 or newer (this is ${process.versions.node}).`); process.exit(1); }

const { CODE_ROOT, dataDirOf } = await import('../collector/paths.mjs');
const { loadConfig } = await import('../collector/config.mjs');
const SCRIPT = fileURLToPath(import.meta.url);
const dataDir = dataDirOf();
const version = JSON.parse(readFileSync(join(CODE_ROOT, 'package.json'), 'utf8')).version;
const say = line => console.log(line);

function config() { try { return loadConfig(join(dataDir, 'config.json')); } catch { return loadConfig(join(dataDir, 'none')); } }
const url = () => `${config().https ? 'https' : 'http'}://localhost:${config().port}`;
/** Does a collector answer on the port? */
const answers = async timeoutMs => (await import('../collector/lib/ping.mjs')).answers(config(), timeoutMs);
async function waitFor(want, ms = 15_000) { for (const until = Date.now() + ms; Date.now() < until;) { if ((await answers()) === want) return true; await new Promise(r => setTimeout(r, 300)); } return false; }
async function service() {
  const { serviceFor } = await import('../collector/service.mjs');
  return serviceFor({ script: SCRIPT, dataDir, env: process.env.AGENTVILLE_HOME ? { AGENTVILLE_HOME: dataDir } : {} });
}
function whereItIs() {
  const cfg = config();
  say(`Dashboard: ${url()}`);
  if (cfg.lan) say(`Network access: on (${cfg.https ? 'HTTPS' : 'no HTTPS'}, ${cfg.guestPassword ? 'password' : 'no password'})`);
}

const commands = {
  /** Set up if it is not, start if it does not run, and say where it is. */
  async up() {
    const svc = await service();
    if (!(await svc.installed())) return commands.install();
    if (!(await svc.state()).running) { await svc.start(); if (!(await waitFor(true))) return notAnswering(svc); }
    say(`Agentville ${version} is running (${svc.kind}).`);
    whereItIs();
  },
  async install() {
    const svc = await service();
    const note = await svc.install();
    if (!(await waitFor(true))) return notAnswering(svc);
    say(`Agentville ${version} installed as a ${svc.kind}.${svc.startsAtLogin ? ' It starts at login.' : ''}`);
    if (note) say(note);
    whereItIs();
    say(`Settings: ⚙ in the dashboard. Data: ${dataDir}`);
  },
  async uninstall() {
    const svc = await service();
    await svc.uninstall();
    if (config().mod !== false) await unlinkMod();
    say(`Uninstalled. Data stays in ${dataDir}.`);
  },
  async start() { const svc = await service(); await svc.start(); say((await waitFor(true)) ? `Started. ${url()}` : 'Started, but the dashboard is not answering. See: agentville logs'); },
  async stop() { const svc = await service(); await svc.stop(); await waitFor(false, 8000); say('Stopped.'); },
  async restart() { const svc = await service(); await svc.restart(); say((await waitFor(true)) ? `Restarted. ${url()}` : 'Restarted, but the dashboard is not answering. See: agentville logs'); },
  async status() {
    const svc = await service(), state = await svc.state(), up = await answers();
    say(`${svc.kind}: ${(await svc.installed()) ? 'installed' : 'not installed'}, ${state.running ? `running${state.pid ? ` (pid ${state.pid})` : ''}` : 'not running'}`);
    say(up ? `dashboard: ${url()}` : `dashboard: not answering at ${url()}${state.running ? '' : ' (agentville start)'}`);
    if (up && !state.running) say('(served by a collector started with "agentville run")');
    process.exitCode = up ? 0 : 1;
  },
  async open() {
    const { makeDesktop } = await import('../collector/platform/desktop.mjs');
    const r = await makeDesktop().openUrl(url());
    say(r.code === 0 ? `Opened ${url()}` : `Open ${url()} in your browser.`);
  },
  async logs() {
    for (const name of ['collector.log', 'service.log']) {
      const file = join(dataDir, 'logs', name);
      if (!existsSync(file)) continue;
      say(`==> ${file} <==`);
      say(readFileSync(file, 'utf8').trimEnd().split('\n').slice(-50).join('\n'));
    }
  },
  /** The collector itself, here, until it is stopped (Ctrl+C). */
  async run() {
    const { runCollector } = await import('../collector/index.mjs');
    const running = await runCollector({ dataDir });
    console.log(`Agentville ${version}: ${config().https ? 'https' : 'http'}://localhost:${running.port()} (Ctrl+C stops it)`);
    const shutdown = async () => { await running.stop(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  },
  /** Sharing on your network, on or off: the same switch as in Settings › Network. */
  async lan(arg) {
    if (!['on', 'off'].includes(arg)) { say(`Network access is ${config().lan ? 'on' : 'off'}. Usage: agentville lan on|off`); return; }
    const { saveSettings } = await import('../collector/settings.mjs');
    saveSettings(join(dataDir, 'config.json'), { lan: arg === 'on' });
    await new Promise(r => setTimeout(r, 1500)); // a running collector sees the change and starts again by itself
    await waitFor(true, 8000);
    say(arg === 'on' ? 'Network access on. Other devices can open the dashboard read-only:' : 'Network access off.');
    if (arg === 'on') await listAddresses();
  },
  /** Making a world of your own, and checking one (docs/worlds.md): the scripts a clone runs with `npm run`, for an installed copy. */
  'new-world': (...args) => script('new-world.mjs', args),
  'check-world': (...args) => script('check-world.mjs', args),
  async doctor() { const { doctor } = await import('../collector/doctor.mjs'); process.exitCode = (await doctor({ dataDir, script: SCRIPT, version, say })) ? 0 : 1; },
  async version() { say(version); },
  async help() {
    say(`Agentville ${version}

  agentville             install as a service if needed, start it, print the dashboard address
  agentville open        open the dashboard in your browser
  agentville status      show whether it runs and answers
  agentville start | stop | restart
  agentville logs        print the last log lines
  agentville lan on|off  allow other devices on your network (also in Settings)
  agentville doctor      list what was found on this computer and what is missing
  agentville uninstall   stop it and remove it from login (data stays)
  agentville run         run the collector in this terminal
  agentville new-world <name>     create a world from the starter (docs/worlds.md)
  agentville check-world <world>  run a world's test tour

Settings: ⚙ in the dashboard. Data: ${dataDir}`);
  },
};

async function script(name, args) {
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, [join(CODE_ROOT, 'scripts', name), ...args], { stdio: 'inherit' });
  process.exitCode = await new Promise(resolve => child.on('exit', code => resolve(code ?? 1)));
}
async function listAddresses() {
  const { networkInterfaces } = await import('node:os');
  for (const i of Object.values(networkInterfaces()).flat()) if (i?.family === 'IPv4' && !i.internal) say(`  ${config().https ? 'https' : 'http'}://${i.address}:${config().port}`);
}
async function unlinkMod() {
  try {
    const { syncMod } = await import('../collector/mod-link.mjs');
    const { findAccounts } = await import('../collector/sources/accounts.mjs');
    const { homedir } = await import('node:os');
    const accounts = findAccounts({ claudeDir: join(homedir(), '.claude'), names: config().accounts, home: homedir(), log: () => {} });
    const got = syncMod({ from: join(CODE_ROOT, 'mod'), modDir: join(dataDir, 'mod'), accountDirs: accounts.map(a => a.dir), on: false });
    for (const f of got.changed) say(`The mod was taken out of ${f}.`);
  } catch { /* nothing to take out */ }
}
async function notAnswering(svc) {
  say(`Started (${svc.kind}), but the dashboard is not answering at ${url()}.`);
  await commands.logs();
  process.exitCode = 1;
}

const [name = 'up', ...args] = process.argv.slice(2);
const command = { '--help': 'help', '-h': 'help', '--version': 'version', '-v': 'version' }[name] ?? name;
if (!Object.hasOwn(commands, command)) { console.error(`agentville: no command "${name}". Try: agentville help`); process.exit(2); }
try {
  await commands[command](...args);
} catch (err) {
  console.error(`agentville ${command}: ${err?.message ?? err}`);
  process.exit(1);
}
