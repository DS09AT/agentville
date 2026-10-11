// `agentville doctor`: what this computer has of what Agentville uses, and what is missing, in plain lines. It
// looks the way the collector looks (the same PATH, the same desktop), so what it finds is what the collector gets.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { answers } from './lib/ping.mjs';
import { makeDesktop } from './platform/desktop.mjs';
import { fullPath, pathKey, which } from './platform/tools.mjs';
import { serviceFor } from './service.mjs';
import { findAccounts } from './sources/accounts.mjs';

/** Prints the findings through `say`; true when nothing it needs is missing. */
export async function doctor({ dataDir, script, version, say, platform = process.platform, home = homedir() }) {
  let ok = true;
  const line = (mark, what, detail) => say(`${mark} ${what}${detail ? `: ${detail}` : ''}`);
  const good = (what, detail) => line('✓', what, detail), missing = (what, detail) => { ok = false; line('✗', what, detail); }, optional = (what, detail) => line('·', what, detail);

  say(`Agentville ${version} on ${platform} (${process.arch}), Node ${process.versions.node}`);
  say(`data: ${dataDir}`);
  let cfg;
  try { cfg = loadConfig(join(dataDir, 'config.json')); good('settings', existsSync(join(dataDir, 'config.json')) ? 'config.json' : 'defaults'); }
  catch (err) { cfg = loadConfig(join(dataDir, 'none')); missing('settings', `config.json is unreadable (${err.message}); defaults apply`); }

  const svc = await serviceFor({ script, dataDir });
  const state = await svc.state();
  ((await svc.installed()) ? good : optional)(svc.kind, `${(await svc.installed()) ? 'installed' : 'not installed (run agentville)'}, ${state.running ? `running${state.pid ? `, pid ${state.pid}` : ''}` : 'not running'}`);
  const up = await answers(cfg, 2000);
  (up ? good : optional)('dashboard', up ? `${cfg.https ? 'https' : 'http'}://localhost:${cfg.port}${cfg.lan ? `, network access on (${cfg.https ? 'HTTPS' : 'no HTTPS'}, ${cfg.guestPassword ? 'password' : 'no password'})` : ''}` : `not answering on port ${cfg.port}`);

  const env = { ...process.env, [pathKey()]: await fullPath({ platform, home }) };
  const find = name => which(name, { platform, env });
  const claude = cfg.claudeBin ? (existsSync(cfg.claudeBin) ? cfg.claudeBin : null) : find('claude');
  if (claude) good('claude', claude); else missing('claude', cfg.claudeBin ? `${cfg.claudeBin} not found (Settings › Sessions)` : 'not found. Install Claude Code or set its path in Settings › Sessions');
  (find('git') ? good : missing)('git', find('git') ?? 'not found; repos and branches are not shown');
  (find('gh') ? good : optional)('gh', find('gh') ?? 'not found; no deploys or pull requests (optional)');

  const desktop = makeDesktop({ platform, home, env });
  const terminals = desktop.terminals();
  if (terminals.length) good('terminal', `${desktop.terminalOf(cfg.terminal)}${terminals.length > 1 ? ` (also: ${terminals.filter(t => t !== desktop.terminalOf(cfg.terminal)).join(', ')})` : ''}`);
  else missing('terminal', 'none found; install a terminal emulator or tmux to start sessions from the dashboard');
  if (platform === 'linux') {
    (find('notify-send') ? good : optional)('notifications', find('notify-send') ? 'notify-send' : 'notify-send not found; no system notifications');
    (find('zenity') || find('kdialog') ? good : optional)('folder window', find('zenity') ?? find('kdialog') ?? 'zenity or kdialog not found; type folder paths instead');
  }
  if (platform !== 'darwin') (find('soffice') || find('libreoffice') ? good : optional)('documents', find('soffice') ?? find('libreoffice') ?? 'LibreOffice not found; Word and slide files are not shown (optional)');

  const require = createRequire(import.meta.url);
  const packages = ['@colyseus/core', '@colyseus/sdk/package.json', 'quickjs-emscripten-core'].filter(p => { try { require.resolve(p); return false; } catch { return true; } });
  if (packages.length) missing('live worlds', `missing packages (${packages.join(', ')}); reinstall Agentville`); else good('live worlds', 'packages installed');

  let accounts = [];
  try { accounts = findAccounts({ claudeDir: join(home, '.claude'), names: cfg.accounts, home, log: () => {} }); } catch { /* none to read */ }
  const modDir = join(dataDir, 'mod'), sep = platform === 'win32' ? ';' : ':';
  for (const a of accounts) {
    let dirs = [];
    try { dirs = String(JSON.parse(readFileSync(join(a.dir, 'settings.json'), 'utf8'))?.env?.CLAUDE_CODE_PLUGIN_DIRS ?? '').split(sep); } catch { /* no settings */ }
    const on = dirs.includes(modDir);
    (on ? good : optional)(`mod (${a.name})`, on ? 'registered' : cfg.mod === false ? 'off (Settings › Sessions)' : 'not registered yet; the collector adds it at start');
  }
  say(ok ? 'All required parts found.' : 'Required parts are missing (✗).');
  return ok;
}
