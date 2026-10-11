import { readFileSync } from 'node:fs';

export const DEFAULTS = Object.freeze({
  port: 7777,
  pollMs: 3000,
  agentsCliPollMs: 30000,
  gitPollMs: 10000,
  deployPollMs: 60000,
  prPollMs: 120000, // pull requests, for the farm's market stall
  staleAfterHours: 24,
  collisionWindowMin: 30,
  permissionGuessSec: 20,
  permissionDashboardSec: 15,
  memoryAlertGb: 2,
  cpuAlertPct: 90,
  cpuAlertSustainSec: 120,
  notifications: true, // false: the collector sends no system notification at all, whatever `notify` says of each kind
  notify: Object.freeze({ waiting: true, collision: true, yourTurn: true, memory: true, cpu: true }),
  modToasts: true,
  deployRepos: Object.freeze({}),
  worldsDir: null, // your own worlds, a folder each (null: ~/.agentville/worlds)
  terminal: 'auto', // where New session / Resume open: 'auto' (the first terminal found), or one this system has ('Terminal', 'iTerm', 'gnome-terminal', 'Windows Terminal'…)
  lan: false, // true: other devices on your network may open the dashboard as guests (they see who works where, never what was said)
  https: false, // true: https is served too (on the same port), with a certificate the collector makes for itself; a guest is sent on to it
  guestPassword: null, // a password guests must give before they see anything, as scrypt keeps it ({ salt, hash }); set and removed in Settings, never written here in the clear
  guestAllow: Object.freeze([]), // addresses and ranges that may come as guests ("192.168.1.20", "192.168.1.0/24"); empty: any private address, never a public one
  guestBlock: Object.freeze([]), // addresses and ranges that may never
  claudeBin: null, // Claude Code's program, when it isn't found by itself (null: `claude`, by PATH)
  mod: true, // keep the mod's folder in CLAUDE_CODE_PLUGIN_DIRS in each account's settings.json, so sessions answer the dashboard
  accounts: Object.freeze({}), // your Claude accounts' names: { "~/.claude": "work", "~/.claude-home": "home" }
});

export function mergeConfig(user) {
  return {
    ...DEFAULTS,
    ...user,
    notify: { ...DEFAULTS.notify, ...(user.notify ?? {}) },
    deployRepos: { ...(user.deployRepos ?? DEFAULTS.deployRepos) },
    accounts: user.accounts && typeof user.accounts === 'object' && !Array.isArray(user.accounts) ? { ...user.accounts } : {},
    https: user.https !== undefined && user.https !== null && user.https !== false && user.https !== 'false' && user.https !== 0, // anything but a plain "off" is on: a slip in the file never means the clear
    guestAllow: addressList(user.guestAllow),
    guestBlock: addressList(user.guestBlock),
    guestPassword: keptPassword(user.guestPassword),
  };
}

/** A list of addresses as written: every entry kept, as text, so one that is no address is seen as that (access.mjs) and never just left out. */
const addressList = given => (given === undefined || given === null ? [] : (Array.isArray(given) ? given : [given]).map(e => (typeof e === 'string' ? e : JSON.stringify(e) ?? '')));

/**
 * The guests' password as the Settings window saved it ({ salt, hash }), or null for none. Anything else there (a
 * password typed into the file by hand) is not read as "none": it is a password nobody can give, until one is set
 * in the Settings window.
 */
function keptPassword(given) {
  if (given === undefined || given === null || given === false || given === '') return null;
  return typeof given.salt === 'string' && typeof given.hash === 'string' ? { salt: given.salt, hash: given.hash } : { salt: '', hash: '' };
}

/** Reads config.json. A missing file gives the defaults; malformed JSON throws. */
export function loadConfig(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return mergeConfig({});
    throw err;
  }
  const user = JSON.parse(text);
  if (user === null || typeof user !== 'object' || Array.isArray(user)) {
    throw new Error('config.json must be a JSON object');
  }
  return mergeConfig(user);
}
