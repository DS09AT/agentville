// The settings, as the dashboard's Settings window shows and saves them: one list says what each is, what it may
// be and what the page calls it, so config.json never has to be edited by hand. What the page sends is checked
// against the list (nothing else is written), and saved into config.json beside whatever else is there.
import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { DEFAULTS } from './config.mjs';
import { hashPassword, parseEntry } from './access.mjs';

const REPO = /^[\w.-]{1,100}\/[\w.-]{1,100}$/;

/**
 * kind: 'bool', 'int', 'number', 'choice', 'text' (may be empty: saved as null), 'map' (folder → a word), 'list' (addresses
 * and ranges), 'secret' (a password: the page is only ever told whether one is set; a new one is kept as scrypt makes it).
 * restart: the collector starts again when it changes (the page is told, and goes to the new address).
 * scale: what the page shows is the value divided by it (milliseconds shown as seconds).
 */
export const FIELDS = Object.freeze([
  { key: 'lan', group: 'Network', kind: 'bool', restart: true, label: 'Network access', help: 'Other devices on your network can open the dashboard, read-only.' },
  { key: 'port', group: 'Network', kind: 'int', min: 1024, max: 65535, restart: true, label: 'Port' },
  { key: 'https', group: 'Network', kind: 'bool', restart: true, label: 'HTTPS', help: 'Encrypts the connection. http:// addresses redirect to https://.' },
  { key: 'guestPassword', group: 'Network', kind: 'secret', min: 8, max: 200, label: 'Password', help: 'Other devices must enter this password to open the dashboard.' },
  { key: 'guestAllow', group: 'Network', kind: 'list', label: 'Allowed addresses', help: 'Only these IPs or ranges can connect, e.g. 192.168.1.20, 192.168.1.0/24. Empty allows every private network address.' },
  { key: 'guestBlock', group: 'Network', kind: 'list', label: 'Blocked addresses', help: 'These IPs or ranges can never connect.' },

  { key: 'terminal', group: 'Sessions', kind: 'choice', label: 'Terminal', help: 'Where sessions started from the dashboard open.' },
  { key: 'claudeBin', group: 'Sessions', kind: 'text', max: 400, restart: true, label: 'Claude Code path', help: 'Only needed if claude is not on your PATH.' },
  { key: 'mod', group: 'Sessions', kind: 'bool', label: 'Claude Code mod', help: 'Loads the mod in Claude Code, so you can answer and message sessions from the dashboard.' },
  { key: 'modToasts', group: 'Sessions', kind: 'bool', label: 'Toasts in Claude Code', help: 'Shows a toast in a session when another agent needs you.' },
  { key: 'staleAfterHours', group: 'Sessions', kind: 'int', min: 1, max: 8760, unit: 'hours', label: 'Stale after' },
  { key: 'collisionWindowMin', group: 'Sessions', kind: 'int', min: 1, max: 1440, unit: 'minutes', label: 'Collision window', help: 'How far back writes to the same files count as a collision.' },
  { key: 'permissionDashboardSec', group: 'Sessions', kind: 'int', min: 0, max: 600, unit: 'seconds', label: 'Permission prompt on dashboard', help: 'Time before the terminal asks instead. 0 turns it off.' },
  { key: 'permissionGuessSec', group: 'Sessions', kind: 'int', min: 5, max: 600, unit: 'seconds', label: 'Assume a permission prompt after', help: 'A tool call with no result for this long counts as a probable prompt.' },

  { key: 'notifications', group: 'Notifications', kind: 'bool', label: 'System notifications', help: 'Turns all kinds below on or off.' },
  { key: 'notify.waiting', group: 'Notifications', kind: 'bool', label: 'Agent needs you' },
  { key: 'notify.yourTurn', group: 'Notifications', kind: 'bool', label: 'Agent finished' },
  { key: 'notify.collision', group: 'Notifications', kind: 'bool', label: 'Collision' },
  { key: 'notify.memory', group: 'Notifications', kind: 'bool', label: 'High memory' },
  { key: 'notify.cpu', group: 'Notifications', kind: 'bool', label: 'High CPU' },
  { key: 'memoryAlertGb', group: 'Notifications', kind: 'number', min: 0.1, max: 1024, unit: 'GB', label: 'Memory threshold' },
  { key: 'cpuAlertPct', group: 'Notifications', kind: 'int', min: 1, max: 6400, unit: '% of a core', label: 'CPU threshold' },
  { key: 'cpuAlertSustainSec', group: 'Notifications', kind: 'int', min: 5, max: 3600, unit: 'seconds', label: 'CPU sustained for' },

  { key: 'worldsDir', group: 'Worlds', kind: 'text', max: 400, restart: true, label: 'Worlds folder', help: 'Folder with your own worlds. Empty uses ~/.agentville/worlds.' },

  { key: 'deployRepos', group: 'GitHub', kind: 'map', valueLabel: 'owner/repo', label: 'Deploy repos', help: 'Checkout folder and the GitHub repo whose latest Actions run is shown. Needs gh.' },

  { key: 'accounts', group: 'Claude accounts', kind: 'map', valueLabel: 'name', label: 'Account names', help: 'Claude config folder and its display name.' },

  { key: 'pollMs', group: 'Polling intervals', kind: 'int', min: 1000, max: 60_000, scale: 1000, unit: 'seconds', label: 'Sessions' },
  { key: 'agentsCliPollMs', group: 'Polling intervals', kind: 'int', min: 5000, max: 600_000, scale: 1000, unit: 'seconds', label: 'Background sessions' },
  { key: 'gitPollMs', group: 'Polling intervals', kind: 'int', min: 2000, max: 600_000, scale: 1000, unit: 'seconds', label: 'Git' },
  { key: 'deployPollMs', group: 'Polling intervals', kind: 'int', min: 10_000, max: 3_600_000, scale: 1000, unit: 'seconds', label: 'Deploys' },
  { key: 'prPollMs', group: 'Polling intervals', kind: 'int', min: 30_000, max: 3_600_000, scale: 1000, unit: 'seconds', label: 'Pull requests' },
]);

const get = (obj, key) => key.split('.').reduce((o, k) => o?.[k], obj);
function set(obj, key, value) {
  const keys = key.split('.'), last = keys.pop();
  let at = obj;
  for (const k of keys) at = at[k] = at[k] && typeof at[k] === 'object' && !Array.isArray(at[k]) ? at[k] : {};
  at[last] = value;
}

/** One value as it may be saved: { value } or { error }. `terminals`: the ones this system has. */
function checkOne(field, value, { terminals = [] } = {}) {
  const { kind, min, max } = field;
  if (kind === 'bool') return typeof value === 'boolean' ? { value } : { error: 'Must be on or off.' };
  if (kind === 'int' || kind === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (kind === 'int' && !Number.isInteger(value))) return { error: `Enter a ${kind === 'int' ? 'whole ' : ''}number.` };
    return value < min || value > max ? { error: `Must be between ${min / (field.scale ?? 1)} and ${max / (field.scale ?? 1)}.` } : { value };
  }
  if (kind === 'choice') return value === 'auto' || terminals.includes(value) ? { value } : { error: 'Not a terminal found on this computer.' };
  if (kind === 'text') {
    if (value === null || value === '') return { value: null };
    return typeof value === 'string' && value.length <= max && !/[\0\r\n]/.test(value) ? { value: value.trim() || null } : { error: `One line, at most ${max} characters.` };
  }
  if (kind === 'secret') { // a new password (kept as its hash), or null to remove it; the page never sends the one that is set
    if (value === null || value === '') return { value: null };
    if (typeof value !== 'string' || value.length < min || value.length > max) return { error: `At least ${min} characters.` };
    return { value: hashPassword(value) };
  }
  if (kind === 'list') {
    if (!Array.isArray(value) || value.length > 100) return { error: 'Enter a list of addresses.' };
    const bad = value.find(e => !parseEntry(e));
    if (bad !== undefined) return { error: `"${String(bad).slice(0, 40)}" is not an IP or range.` };
    return { value: [...new Set(value.map(e => String(e).trim()))] };
  }
  if (kind === 'map') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { error: 'Enter folder and value pairs.' };
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      const folder = String(k).trim(), word = typeof v === 'string' ? v.trim() : '';
      if (!folder || folder.length > 400 || /[\0\r\n]/.test(folder)) return { error: 'A folder is missing or too long.' };
      if (!word || word.length > 100 || /[\0\r\n]/.test(word)) return { error: `"${folder.slice(0, 60)}" needs a ${field.valueLabel}.` };
      if (field.key === 'deployRepos' && !REPO.test(word)) return { error: `"${word.slice(0, 60)}" is not owner/repo.` };
      out[folder] = word;
    }
    return Object.keys(out).length > 50 ? { error: 'At most 50 entries.' } : { value: out };
  }
  return { error: 'Not a setting.' };
}

/**
 * What the page sent ({ key: value }, any of the settings), checked: { values } to save, or { errors } by key.
 * A key that is no setting is an error, so nothing unknown is ever written.
 */
export function checkSettings(input, opts = {}) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return { errors: { '': 'Nothing to save.' } };
  const values = {}, errors = {};
  for (const [key, value] of Object.entries(input)) {
    const field = FIELDS.find(f => f.key === key);
    const got = field ? checkOne(field, value, opts) : { error: 'Not a setting.' };
    if (got.error) errors[key] = got.error; else values[key] = got.value;
  }
  return Object.keys(errors).length ? { errors } : { values };
}

/** config.json as it is written: {} when there is none; throws when it is not a JSON object (it is never overwritten then). */
export function readSaved(path) {
  if (!existsSync(path)) return {};
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  if (saved === null || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('config.json must be a JSON object');
  return saved;
}

/** Saves checked values into config.json, beside what else is there, in one step (written beside it, then moved over it). */
export function saveSettings(path, values) {
  const saved = readSaved(path);
  for (const [key, value] of Object.entries(values)) set(saved, key, value);
  const target = existsSync(path) ? realpathSync(path) : path; // a config.json that is a link (kept with your dotfiles) stays one
  const temp = `${target}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(saved, null, 2)}\n`);
  renameSync(temp, target);
  return saved;
}

/** The settings for the page: each field with its value now and its default; a choice with the terminals this system has. */
export function describeSettings(cfg, { terminals = [] } = {}) {
  return FIELDS.map(f => ({ ...f, value: f.kind === 'secret' ? Boolean(get(cfg, f.key)) : get(cfg, f.key) ?? null, default: get(DEFAULTS, f.key) ?? null, ...(f.kind === 'choice' ? { choices: ['auto', ...terminals] } : {}) })); // (a password is never sent: only that one is set)
}

/** Does saving these values mean the collector starts again? (One of them is marked so, and differs from what is in force.) */
export const needsRestart = (cfg, values) => FIELDS.some(f => f.restart && Object.hasOwn(values, f.key) && (values[f.key] ?? null) !== (get(cfg, f.key) ?? null));
