// The settings as the dashboard saves them (collector/settings.mjs), and the collector's side of the Settings
// window: only this computer's own page reads or saves them, and a change that needs the collector started
// again does that by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPassword, makePasses } from '../access.mjs';
import { DEFAULTS, loadConfig } from '../config.mjs';
import { startCollector } from '../collector.mjs';
import { FIELDS, checkSettings, describeSettings, needsRestart, readSaved, saveSettings } from '../settings.mjs';

const WEB = fileURLToPath(new URL('../../web', import.meta.url));
const temp = () => mkdtempSync(join(tmpdir(), 'tracker-settings-'));

test('every setting config.json has is one the Settings window shows, with a default that passes its own check', () => {
  const flat = Object.entries(DEFAULTS).flatMap(([k, v]) => (k === 'notify' ? Object.keys(v).map(n => `notify.${n}`) : [k])); // (notifications, the switch for all of them, is a setting of its own)
  assert.deepEqual(FIELDS.map(f => f.key).sort(), flat.sort(), 'no setting is left to be edited by hand');
  const terminals = ['Terminal', 'iTerm'];
  for (const f of describeSettings(loadConfig('/nowhere/config.json'), { terminals })) {
    const got = checkSettings({ [f.key]: f.kind === 'text' ? '' : f.default }, { terminals });
    assert.deepEqual(got.errors, undefined, `${f.key}: ${JSON.stringify(got.errors)}`);
    assert.ok(f.label && f.group, `${f.key} has words`);
  }
  assert.deepEqual(describeSettings(loadConfig('/nowhere/config.json'), { terminals }).find(f => f.key === 'terminal').choices, ['auto', 'Terminal', 'iTerm']);
});

test('what the page sends is checked: kinds, limits, the terminals this system has, pairs; a key that is no setting is refused', () => {
  const check = input => checkSettings(input, { terminals: ['gnome-terminal', 'tmux'] });
  assert.deepEqual(check({ lan: true, port: 8080, terminal: 'tmux', 'notify.cpu': false, memoryAlertGb: 1.5, claudeBin: ' /opt/claude ', worldsDir: '' }).values,
    { lan: true, port: 8080, terminal: 'tmux', 'notify.cpu': false, memoryAlertGb: 1.5, claudeBin: '/opt/claude', worldsDir: null });
  assert.deepEqual(check({ deployRepos: { ' /code/api ': ' me/api ' }, accounts: { '~/.claude-home': 'home' } }).values, { deployRepos: { '/code/api': 'me/api' }, accounts: { '~/.claude-home': 'home' } });
  for (const [bad, key] of [[{ lan: 'yes' }, 'lan'], [{ port: 80 }, 'port'], [{ port: 7777.5 }, 'port'], [{ port: '7777' }, 'port'], [{ terminal: 'iTerm' }, 'terminal'], [{ pollMs: 5 }, 'pollMs'],
    [{ claudeBin: 'a\nb' }, 'claudeBin'], [{ deployRepos: { '/x': 'not a repo' } }, 'deployRepos'], [{ deployRepos: [] }, 'deployRepos'], [{ accounts: { '': 'x' } }, 'accounts'], [{ accounts: { '/x': '' } }, 'accounts'],
    [{ token: 'x' }, 'token'], [{ __proto__: null, constructor: 1 }, 'constructor'], [{ 'notify.nothing': true }, 'notify.nothing']]) {
    assert.ok(check(bad).errors?.[key], `${JSON.stringify(bad)} is refused`);
  }
  assert.ok(check(null).errors);
  assert.match(check({ pollMs: 500 }).errors.pollMs, /between 1 and 60/, 'limits are said the way the page shows the value (seconds)');
});

test('saving writes only what was checked, beside what else config.json holds, and never over a file that is not JSON', () => {
  const dir = temp(), path = join(dir, 'config.json');
  assert.deepEqual(readSaved(path), {});
  saveSettings(path, { lan: true, 'notify.cpu': false });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { lan: true, notify: { cpu: false } });
  writeFileSync(path, JSON.stringify({ port: 7001, notify: { waiting: false }, mine: 'kept' }));
  saveSettings(path, { 'notify.cpu': false, claudeBin: null });
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { port: 7001, notify: { waiting: false, cpu: false }, mine: 'kept', claudeBin: null });
  assert.equal(loadConfig(path).notify.yourTurn, true, 'what is not saved keeps its default');
  writeFileSync(path, '{ not json');
  assert.throws(() => saveSettings(path, { lan: true }));
  assert.equal(readFileSync(path, 'utf8'), '{ not json');
  assert.deepEqual(existsSync(`${path}.${process.pid}.tmp`), false);
  const cfg = loadConfig(join(dir, 'none.json'));
  assert.equal(needsRestart(cfg, { staleAfterHours: 2 }), false);
  assert.equal(needsRestart(cfg, { port: cfg.port, lan: false, claudeBin: null }), false, 'saved as it is: nothing starts again');
  assert.equal(needsRestart(cfg, { lan: true }), true);
  assert.equal(needsRestart(cfg, { worldsDir: '~/w' }), true);
});

async function collector({ root = temp(), ...more } = {}) {
  const claudeDir = join(root, 'claude');
  mkdirSync(join(claudeDir, 'sessions'), { recursive: true });
  mkdirSync(join(claudeDir, 'projects'), { recursive: true });
  const restarts = [];
  const handle = await startCollector({ root, webDir: WEB, claudeDir, claudeBin: process.execPath, port: 0, notify: () => {}, log: () => {}, home: root, restart: async () => { restarts.push(Date.now()); }, ...more });
  const token = readFileSync(join(root, 'state', 'token'), 'utf8');
  const origin = `http://127.0.0.1:${handle.port}`;
  const save = (values, headers = { 'x-tracker-token': token, origin }) => fetch(`${origin}/api/actions/config`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ values }) });
  return { root, handle, token, origin, restarts, save };
}

test('the Settings window: read and saved with the token only, in force at once; nothing has to be set before the collector starts', async () => {
  const c = await collector();
  try {
    assert.equal(existsSync(join(c.root, 'config.json')), false, 'it started with no config file at all');
    assert.equal((await fetch(`${c.origin}/api/config`)).status, 403);
    const got = await (await fetch(`${c.origin}/api/config`, { headers: { 'x-tracker-token': c.token } })).json();
    assert.equal(got.dataDir, c.root);
    assert.equal(got.platform, process.platform);
    assert.deepEqual(got.addresses, [`http://localhost:${c.handle.port}`]);
    assert.equal(got.fields.find(f => f.key === 'staleAfterHours').value, 24);
    assert.equal((await c.save({ staleAfterHours: 2 }, { origin: c.origin })).status, 403, 'no token');
    assert.equal((await c.save({ staleAfterHours: 2 }, { 'x-tracker-token': c.token, origin: 'http://evil.example' })).status, 403, 'another site');
    const bad = await (await c.save({ staleAfterHours: 0, nonsense: 1 })).json();
    assert.equal(bad.ok, false);
    assert.deepEqual(Object.keys(bad.errors), ['staleAfterHours', 'nonsense']);
    assert.equal(existsSync(join(c.root, 'config.json')), false, 'nothing is written when a value is refused');
    const saved = await (await c.save({ staleAfterHours: 2, 'notify.cpu': false })).json();
    assert.deepEqual([saved.ok, saved.restart], [true, false]);
    assert.deepEqual(JSON.parse(readFileSync(join(c.root, 'config.json'), 'utf8')), { staleAfterHours: 2, notify: { cpu: false } });
    const after = await (await fetch(`${c.origin}/api/config`, { headers: { 'x-tracker-token': c.token } })).json();
    assert.equal(after.fields.find(f => f.key === 'staleAfterHours').value, 2, 'in force without a restart');
    assert.deepEqual(c.restarts, []);
  } finally { await c.handle.stop(); }
});

test('a setting that needs the collector started again does that by itself, after the answer is out; a port in use is refused before anything is saved', async () => {
  const c = await collector();
  const taken = createServer();
  await new Promise(r => taken.listen(0, '127.0.0.1', r));
  try {
    const busy = await (await c.save({ port: taken.address().port })).json();
    assert.equal(busy.ok, false);
    assert.match(busy.errors.port, /is in use/);
    assert.equal(existsSync(join(c.root, 'config.json')), false);
    const shared = await (await c.save({ lan: true })).json();
    assert.deepEqual([shared.ok, shared.restart], [true, true]);
    assert.ok(shared.addresses.length >= 1 && shared.addresses[0] === `http://localhost:${c.handle.port}`);
    assert.equal(JSON.parse(readFileSync(join(c.root, 'config.json'), 'utf8')).lan, true);
    await new Promise(r => setTimeout(r, 500));
    assert.equal(c.restarts.length, 1, 'started again once');
  } finally { taken.close(); await c.handle.stop(); }
  // config.json changed from outside (`agentville lan on`, or by hand): what only a start reads starts it again too
  const outside = await collector();
  try {
    writeFileSync(join(outside.root, 'config.json'), JSON.stringify({ staleAfterHours: 3 }));
    await new Promise(r => setTimeout(r, 700));
    assert.deepEqual(outside.restarts, [], 'a setting in force at once starts nothing');
    writeFileSync(join(outside.root, 'config.json'), JSON.stringify({ staleAfterHours: 3, lan: true }));
    await new Promise(r => setTimeout(r, 900));
    assert.equal(outside.restarts.length, 1);
  } finally { await outside.handle.stop(); }
  // a collector with no way to start again (a test's, an embedder's) says so instead of saving
  const fixed = await collector({ restart: null });
  try {
    const no = await (await fixed.save({ lan: true })).json();
    assert.equal(no.ok, false);
    assert.match(no.error, /needs a restart/);
    assert.equal(existsSync(join(fixed.root, 'config.json')), false);
  } finally { await fixed.handle.stop(); }
});

test("the guests' password, the address lists and https are settings like the others: the password is kept as a hash and never sent back", async () => {
  const c = await collector();
  try {
    const bad = await (await c.save({ guestPassword: 'short', guestAllow: ['192.168.1.0/24', 'not an address'], guestBlock: 'x' })).json();
    assert.deepEqual(Object.keys(bad.errors).sort(), ['guestAllow', 'guestBlock', 'guestPassword']);
    const saved = await (await c.save({ guestPassword: 'open sesame', guestAllow: ['192.168.1.0/24', ' 10.0.0.5 '], guestBlock: [] })).json();
    assert.deepEqual([saved.ok, saved.restart], [true, false], 'in force at once: nothing starts again');
    const file = readFileSync(join(c.root, 'config.json'), 'utf8');
    assert.doesNotMatch(file, /open sesame/, 'never in the clear');
    assert.match(JSON.parse(file).guestPassword.hash, /^[0-9a-f]{64}$/);
    assert.deepEqual(JSON.parse(file).guestAllow, ['192.168.1.0/24', '10.0.0.5']);
    const text = await (await fetch(`${c.origin}/api/config`, { headers: { 'x-tracker-token': c.token } })).text();
    assert.doesNotMatch(text, new RegExp(`${JSON.parse(file).guestPassword.hash}|${JSON.parse(file).guestPassword.salt}|open sesame`), 'the page is told only that one is set');
    assert.equal(JSON.parse(text).fields.find(f => f.key === 'guestPassword').value, true);
    await c.save({ guestPassword: null });
    assert.equal(JSON.parse(readFileSync(join(c.root, 'config.json'), 'utf8')).guestPassword, null, 'removed');
    const https = await (await c.save({ https: true })).json();
    assert.deepEqual([https.ok, https.restart], [true, true], 'https needs a fresh start');
  } finally { await c.handle.stop(); }
  // started with https on: its certificate is made in its own state folder, once, and both http and https answer
  const root = temp();
  writeFileSync(join(root, 'config.json'), JSON.stringify({ https: true }));
  const s = await collector({ root });
  try {
    assert.ok(existsSync(join(root, 'state', 'tls', 'cert.pem')) && existsSync(join(root, 'state', 'tls', 'key.pem')));
    const plain = await fetch(`${s.origin}/api/state`, { redirect: 'manual' });
    assert.deepEqual([plain.status, plain.headers.get('location')], [308, `https://127.0.0.1:${s.handle.port}/api/state`], 'http is sent on to https, on this computer too');
    const { request } = await import('node:https');
    const status = await new Promise((resolve, reject) => request({ host: '127.0.0.1', port: s.handle.port, path: '/api/state', rejectUnauthorized: false, agent: false, headers: { host: `127.0.0.1:${s.handle.port}` } }, res => { res.resume(); resolve(res.statusCode); }).on('error', reject).end());
    assert.equal(status, 200);
  } finally { await s.handle.stop(); }
});

test('shared on the network (the lan setting, no environment variable): a guest gets the page and the worlds, never the settings', async t => {
  const own = Object.values(networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  if (!own) return t.skip('this machine has no network address to visit from');
  const root = temp();
  writeFileSync(join(root, 'config.json'), JSON.stringify({ lan: true }));
  const c = await collector({ root });
  try {
    const guest = `http://${own}:${c.handle.port}`;
    assert.equal((await fetch(`${guest}/api/state`)).status, 200);
    assert.doesNotMatch(await (await fetch(guest)).text(), new RegExp(c.token), 'its page holds no token');
    assert.equal((await fetch(`${guest}/api/config`)).status, 403);
    assert.equal((await fetch(`${guest}/api/config`, { headers: { 'x-tracker-token': c.token } })).status, 403, 'not even with the token: the settings are this computer’s alone');
    const tried = await fetch(`${guest}/api/actions/config`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-tracker-token': c.token, origin: guest }, body: JSON.stringify({ values: { lan: false } }) });
    assert.equal(tried.status, 403);
    assert.equal(JSON.parse(readFileSync(join(root, 'config.json'), 'utf8')).lan, true);
    const mine = await (await fetch(`${c.origin}/api/config`, { headers: { 'x-tracker-token': c.token } })).json();
    assert.ok(mine.addresses.includes(guest), 'the window lists where others open it');
  } finally { await c.handle.stop(); }
});

test("a password typed into config.json by hand is never read as none: nobody can give it until one is set in the Settings window", () => {
  const dir = temp(), path = join(dir, 'config.json');
  for (const typed of ['open sesame', 12345678, true, { hash: 'abc' }, ['x']]) {
    writeFileSync(path, JSON.stringify({ lan: true, guestPassword: typed }));
    const kept = loadConfig(path).guestPassword;
    assert.deepEqual(kept, { salt: '', hash: '' }, JSON.stringify(typed));
    assert.equal(checkPassword(String(typed), kept), false);
    assert.equal(checkPassword('', kept), false);
    assert.equal(typeof makePasses({ secret: 'x'.repeat(64), kept }).frame, 'string', 'guests are asked for it, and none gets in');
  }
  for (const none of [null, false, '', undefined]) {
    writeFileSync(path, JSON.stringify({ guestPassword: none }));
    assert.equal(loadConfig(path).guestPassword, null);
  }
});

test('https asked for and no certificate to be had: nothing is shared on the network in the clear instead', async t => {
  const root = temp(), said = [];
  mkdirSync(join(root, 'state'), { recursive: true });
  writeFileSync(join(root, 'state', 'tls'), 'a file where the certificate folder would be');
  writeFileSync(join(root, 'config.json'), JSON.stringify({ lan: true, https: true }));
  const c = await collector({ root, log: m => said.push(m) });
  try {
    const got = await (await fetch(`${c.origin}/api/config`, { headers: { 'x-tracker-token': c.token } })).json();
    assert.deepEqual(got.addresses, [`http://localhost:${c.handle.port}`], 'this computer only');
    assert.ok(said.some(m => /not shared on the network/.test(m)), said.join('\n'));
    const own = Object.values(networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)?.address;
    if (!own) return t.diagnostic('no network address to try from');
    await assert.rejects(fetch(`http://${own}:${c.handle.port}/api/state`), 'nobody is listening there');
  } finally {
    await c.handle.stop();
  }
});

test("saving a new guests' password lets every guest go at once; a guest that comes back is asked for it", async t => {
  const own = Object.values(networkInterfaces()).flat().find(i => i?.family === 'IPv4' && !i.internal)?.address;
  if (!own) return t.skip('this machine has no network address to visit from');
  const c = await collector({ lan: true });
  try {
    const stream = await new Promise((resolve, reject) => httpRequest({ host: own, port: c.handle.port, path: '/api/events', agent: false, headers: { host: `${own}:${c.handle.port}` } }, resolve).on('error', reject).end());
    assert.equal(stream.statusCode, 200);
    let ended = false;
    stream.on('close', () => { ended = true; }).on('error', () => { ended = true; }).resume();
    assert.equal((await c.save({ staleAfterHours: 3 })).status, 200);
    await new Promise(r => setTimeout(r, 150));
    assert.equal(ended, false, 'another setting leaves it be');
    assert.equal((await c.save({ guestPassword: 'a new long password' })).status, 200);
    for (let i = 0; i < 80 && !ended; i++) await new Promise(r => setTimeout(r, 25));
    assert.equal(ended, true);
    assert.equal((await fetch(`http://${own}:${c.handle.port}/api/state`, { headers: { host: `${own}:${c.handle.port}` } })).status, 401);
  } finally {
    await c.handle.stop();
  }
});

test('a slip in config.json never opens more than was meant: lists keep every entry, https is on unless plainly off', () => {
  const dir = temp(), path = join(dir, 'config.json');
  const read = user => { writeFileSync(path, JSON.stringify(user)); return loadConfig(path); };
  assert.deepEqual(read({ guestAllow: '192.168.1.20', guestBlock: [7, '10.0.0.1', null] }).guestAllow, ['192.168.1.20'], 'one address written without its brackets');
  assert.deepEqual(read({ guestBlock: [7, '10.0.0.1', null] }).guestBlock, ['7', '10.0.0.1', 'null'], 'an entry that is no address stays in the list, where it is seen');
  assert.deepEqual([read({}).guestAllow, read({ guestBlock: null }).guestBlock], [[], []]);
  for (const on of [true, 'true', 'yes', 1]) assert.equal(read({ https: on }).https, true, String(on));
  for (const off of [false, 'false', 0, null, undefined]) assert.equal(read({ https: off }).https, false, String(off));
});
