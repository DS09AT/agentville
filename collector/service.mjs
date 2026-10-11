// The collector as something that runs by itself: started at login and kept running, by whatever each system
// has for that. macOS: a launchd agent. Linux: a systemd user service (kept running without a login session where
// the system allows it). Windows, and a Linux without systemd: a process of its own in the background, on
// Windows started again at each login (a value under the user's own Run key: no administrator is asked).
// All are made here from what is known at install time (this Node, this script): no template, nothing to edit.
import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, openSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, userInfo } from 'node:os';
import { join } from 'node:path';
import { run } from './lib/exec.mjs';

export const LABEL = 'local.agentville', UNIT = 'agentville.service', RUN_VALUE = 'Agentville';
const LEGACY_LABEL = 'local.agent-tracker'; // the service's name while the command was agent-tracker
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
const xml = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A word in a systemd unit's ExecStart or Environment: quoted, with what systemd reads as its own doubled or escaped. */
export const unitQuote = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === 'EPERM'; } };

/** The launchd agent's file: this Node running `agentville run`, at login and again whenever it ends. */
export function launchdPlist({ node, script, logFile, env = {} }) {
  const vars = Object.entries(env).map(([k, v]) => `    <key>${xml(k)}</key><string>${xml(v)}</string>\n`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(node)}</string><string>${xml(script)}</string><string>run</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(logFile)}</string>
  <key>StandardErrorPath</key><string>${xml(logFile)}</string>
${vars ? `  <key>EnvironmentVariables</key>\n  <dict>\n${vars}  </dict>\n` : ''}</dict>
</plist>
`;
}

/** The systemd user unit: the same, for Linux. */
export function systemdUnit({ node, script, logFile, env = {} }) {
  return `[Unit]
Description=Agentville: dashboard for Claude Code and Codex sessions

[Service]
ExecStart=${unitQuote(node)} ${unitQuote(script)} run
Restart=always
RestartSec=10
StandardOutput=append:${logFile}
StandardError=append:${logFile}
${Object.entries(env).map(([k, v]) => `Environment=${unitQuote(`${k}=${v}`)}\n`).join('')}
[Install]
WantedBy=default.target
`;
}

/**
 * This system's way of keeping the collector running. `node` and `script` are what it starts (`<node> <script> run`);
 * `dataDir` is where its log and its pid file are; `env`: what it must be started with (AGENTVILLE_HOME, when the
 * data folder is not the usual one). Every call resolves to a line or two to print, or throws with one.
 */
export async function serviceFor({ platform = process.platform, home = homedir(), node = process.execPath, script, dataDir, env = {}, runner = run } = {}) {
  const logFile = join(dataDir, 'logs', 'service.log'), pidFile = join(dataDir, 'collector.pid');
  const made = { node, script, logFile, env };
  const ensureLogs = () => mkdirSync(join(dataDir, 'logs'), { recursive: true });

  if (platform === 'darwin') {
    const domain = `gui/${process.getuid()}`, plist = join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const loaded = async () => (await runner('launchctl', ['print', `${domain}/${LABEL}`], { timeoutMs: 10_000 }));
    const legacy = async () => { // the agent-tracker service, and its command's link when that leads nowhere now
      const old = join(home, 'Library', 'LaunchAgents', `${LEGACY_LABEL}.plist`);
      await runner('launchctl', ['bootout', `${domain}/${LEGACY_LABEL}`], { timeoutMs: 10_000 });
      rmSync(old, { force: true });
      const link = join(home, '.local', 'bin', 'agent-tracker');
      try { if (lstatSync(link).isSymbolicLink() && !existsSync(link)) unlinkSync(link); } catch { /* none */ }
    };
    return {
      kind: 'launchd agent', startsAtLogin: true,
      installed: async () => existsSync(plist),
      async install() {
        ensureLogs();
        await legacy();
        mkdirSync(join(home, 'Library', 'LaunchAgents'), { recursive: true });
        writeFileSync(plist, launchdPlist(made));
        await runner('launchctl', ['bootout', `${domain}/${LABEL}`], { timeoutMs: 10_000 });
        for (let i = 0; i < 20 && (await loaded()).code === 0; i++) await sleep(150); // a service just put out takes a moment to be gone
        const r = await runner('launchctl', ['bootstrap', domain, plist], { timeoutMs: 15_000 });
        if (r.code !== 0) throw new Error(`launchd did not take the service (${r.stderr.trim() || `exit ${r.code}`}).`);
      },
      async uninstall() { await runner('launchctl', ['bootout', `${domain}/${LABEL}`], { timeoutMs: 10_000 }); rmSync(plist, { force: true }); },
      async start() {
        if ((await loaded()).code !== 0) { const r = await runner('launchctl', ['bootstrap', domain, plist], { timeoutMs: 15_000 }); if (r.code !== 0) throw new Error(`launchd did not start it (${r.stderr.trim() || `exit ${r.code}`}).`); return; }
        await runner('launchctl', ['kickstart', `${domain}/${LABEL}`], { timeoutMs: 15_000 });
      },
      async stop() { await runner('launchctl', ['bootout', `${domain}/${LABEL}`], { timeoutMs: 10_000 }); },
      async restart() {
        if ((await loaded()).code !== 0) return this.start();
        const r = await runner('launchctl', ['kickstart', '-k', `${domain}/${LABEL}`], { timeoutMs: 15_000 });
        if (r.code !== 0) throw new Error(`launchd did not restart it (${r.stderr.trim() || `exit ${r.code}`}).`);
      },
      async state() {
        const r = await loaded();
        if (r.code !== 0) return { running: false };
        const pid = Number(/^\s*pid = (\d+)/m.exec(r.stdout)?.[1]);
        return { running: /^\s*state = running/m.test(r.stdout), pid: pid || null };
      },
    };
  }

  // systemd's user manager is reached through the user's runtime folder. A shell that was not started by a login
  // (su, a container's exec) has no XDG_RUNTIME_DIR, though the manager runs: the folder is named for it then.
  const runtime = platform === 'linux' && !process.env.XDG_RUNTIME_DIR && existsSync(`/run/user/${process.getuid()}/systemd`) ? { XDG_RUNTIME_DIR: `/run/user/${process.getuid()}` } : undefined;
  const ctl = (...args) => runner('systemctl', ['--user', ...args], { timeoutMs: 30_000, ...(runtime ? { env: runtime } : {}) });
  const systemd = platform === 'linux' && (await ctl('show-environment')).code === 0;
  if (systemd) {
    const unit = join(process.env.XDG_CONFIG_HOME || join(home, '.config'), 'systemd', 'user', UNIT);
    const must = async (what, ...args) => { const r = await ctl(...args); if (r.code !== 0) throw new Error(`systemd did not ${what} (${r.stderr.trim().split('\n')[0] || `exit ${r.code}`}).`); };
    return {
      kind: 'systemd user service', startsAtLogin: true,
      installed: async () => existsSync(unit),
      async install() {
        ensureLogs();
        mkdirSync(join(unit, '..'), { recursive: true });
        writeFileSync(unit, systemdUnit(made));
        await must('read the service', 'daemon-reload');
        await must('start the service', 'enable', '--now', UNIT);
        await ctl('restart', UNIT); // one that ran already runs the new code
        // Without a login session (a server, a machine reached over ssh) user services stop: lingering keeps them. Asked for, not insisted on.
        const linger = await runner('loginctl', ['enable-linger', userInfo().username], { timeoutMs: 10_000 });
        return linger.code === 0 ? null : 'It runs while you are logged in. To keep it running after you log out: sudo loginctl enable-linger $USER';
      },
      async uninstall() { await ctl('disable', '--now', UNIT); rmSync(unit, { force: true }); await ctl('daemon-reload'); },
      start: () => must('start it', 'start', UNIT),
      stop: () => must('stop it', 'stop', UNIT),
      restart: () => must('restart it', 'restart', UNIT),
      async state() {
        const active = (await ctl('is-active', UNIT)).stdout.trim() === 'active';
        const pid = Number((await ctl('show', '-p', 'MainPID', '--value', UNIT)).stdout.trim());
        return { running: active, pid: active && pid ? pid : null };
      },
    };
  }

  // A process of its own in the background. The collector writes its pid file itself (index.mjs), so it is found however it was started.
  const win = platform === 'win32';
  const pidNow = () => { try { const pid = Number(readFileSync(pidFile, 'utf8').trim()); return Number.isInteger(pid) && pid > 0 && alive(pid) ? pid : null; } catch { return null; } };
  const startLine = `"${node}" "${script}" start`;
  const background = {
    kind: win ? 'background process, started at login' : 'background process', startsAtLogin: win,
    installed: async () => (win ? (await runner('reg.exe', ['query', RUN_KEY, '/v', RUN_VALUE], { timeoutMs: 15_000 })).code === 0 : Boolean(pidNow())),
    async install() {
      if (win) {
        const r = await runner('reg.exe', ['add', RUN_KEY, '/v', RUN_VALUE, '/t', 'REG_SZ', '/d', startLine, '/f'], { timeoutMs: 15_000 });
        if (r.code !== 0) throw new Error(`Windows did not take the login entry (${r.stderr.trim() || `exit ${r.code}`}).`);
      }
      await this.restart();
      return win ? null : 'There is no systemd user session here, so nothing starts it at login: run "agentville start" after a restart.';
    },
    async uninstall() {
      if (win) await runner('reg.exe', ['delete', RUN_KEY, '/v', RUN_VALUE, '/f'], { timeoutMs: 15_000 });
      await this.stop();
    },
    async start() {
      if (pidNow()) return;
      ensureLogs();
      const out = openSync(logFile, 'a');
      const child = spawn(node, [script, 'run'], { detached: true, stdio: ['ignore', out, out], windowsHide: true, env: { ...process.env, ...env } });
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('spawn', resolve); });
      child.unref();
    },
    async stop() {
      const pid = pidNow();
      if (!pid) return;
      try { process.kill(pid); } catch { /* gone already */ }
      for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
      if (alive(pid)) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
    },
    async restart() { await this.stop(); await this.start(); },
    async state() { const pid = pidNow(); return { running: Boolean(pid), pid }; },
  };
  return background;
}
