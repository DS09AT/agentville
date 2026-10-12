// The mod (mod/, a Claude Code plugin) where sessions load it from, with nothing to set by hand. It is kept as a
// copy in the data folder (~/.agentville/mod), beside state/: the mod finds the collector's state next to its
// own folder, and the copy stays where it is when the code is updated or moved. Each account's settings.json
// names that folder in CLAUDE_CODE_PLUGIN_DIRS (a list of folders Claude Code loads plugins from).
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { renameOver } from './lib/replace.mjs';

const PARTS = ['.claude-plugin/plugin.json', 'hooks', 'types']; // what a session loads (never its tests, or the types Claude Code writes beside it)
const MOD_NAME = 'agent-tracker';

function filesUnder(dir, rel = '') {
  const at = join(dir, rel);
  if (!existsSync(at)) return [];
  if (!statSync(at).isDirectory()) return [rel];
  return readdirSync(at).flatMap(name => filesUnder(dir, rel ? `${rel}/${name}` : name));
}

/** Copies the mod into the data folder, only the files that differ: [the files written]. */
export function installMod({ from, to }) {
  const written = [];
  if (resolve(from) === resolve(to)) return written;
  for (const rel of PARTS.flatMap(part => filesUnder(from, part))) {
    const want = readFileSync(join(from, rel));
    let have = null;
    try { have = readFileSync(join(to, rel)); } catch { /* not there yet */ }
    if (have && want.equals(have)) continue;
    mkdirSync(join(to, rel, '..'), { recursive: true });
    writeFileSync(join(to, rel), want);
    written.push(rel);
  }
  return written;
}

/** Is this folder a copy of the mod (an earlier one, in a clone)? */
function isMod(dir) {
  try { return JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))?.name === MOD_NAME; } catch { return false; }
}

/**
 * Puts the mod's folder into (or takes it out of) CLAUDE_CODE_PLUGIN_DIRS in one settings.json, leaving every
 * other folder and setting as it is. A file that isn't JSON is left alone. Returns 'changed', 'same', or 'unreadable'.
 */
export function linkMod({ settingsFile, modDir, on, platform = process.platform }) {
  const sep = platform === 'win32' ? ';' : ':';
  let settings = {};
  if (existsSync(settingsFile)) {
    try { settings = JSON.parse(readFileSync(settingsFile, 'utf8')); } catch { return 'unreadable'; }
    if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) return 'unreadable';
  } else if (!on) return 'same';
  const had = typeof settings.env?.CLAUDE_CODE_PLUGIN_DIRS === 'string' ? settings.env.CLAUDE_CODE_PLUGIN_DIRS : '';
  // Switched on, any other copy of the mod goes (a clone's, from before): a session must not load two. Switched off, only this one does.
  const others = had.split(sep).filter(d => d && resolve(d) !== resolve(modDir) && !(on && isMod(d)));
  const now = [...others, ...(on ? [modDir] : [])].join(sep);
  if (now === had) return 'same';
  const env = { ...(settings.env && typeof settings.env === 'object' ? settings.env : {}) };
  if (now) env.CLAUDE_CODE_PLUGIN_DIRS = now; else delete env.CLAUDE_CODE_PLUGIN_DIRS;
  const next = { ...settings, env };
  if (!Object.keys(env).length) delete next.env;
  mkdirSync(join(settingsFile, '..'), { recursive: true });
  // Written beside the file itself and moved over it. A settings.json that is a link (a second account sharing the first's) stays one: the file it leads to is the one written.
  const target = existsSync(settingsFile) ? realpathSync(settingsFile) : settingsFile;
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`);
  renameOver(temp, target);
  return 'changed';
}

/** The mod copied and named in every account's settings.json (or taken out of them): { written, changed: [files], unreadable: [files] }. */
export function syncMod({ from, modDir, accountDirs, on, platform, log = () => {} }) {
  const written = on ? installMod({ from, to: modDir }) : [];
  const changed = [], unreadable = [];
  for (const dir of accountDirs) {
    const settingsFile = join(dir, 'settings.json');
    const got = linkMod({ settingsFile, modDir, on, platform });
    if (got === 'changed') changed.push(settingsFile);
    if (got === 'unreadable') unreadable.push(settingsFile);
  }
  if (written.length) log(`mod: ${written.length} file(s) copied to ${modDir}`);
  for (const f of changed) log(`mod: ${on ? 'named in' : 'taken out of'} ${f} (CLAUDE_CODE_PLUGIN_DIRS)`);
  for (const f of unreadable) log(`mod: ${f} is not JSON, left as it is`);
  return { written, changed, unreadable };
}
