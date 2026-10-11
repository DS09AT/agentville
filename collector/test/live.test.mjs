// One world for everyone who watches (collector/live.mjs): a built-in world run without a page, the room every
// browser joins, who may do what in it, and what a guest is (and is not) sent.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import WebSocket from 'ws';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerServer, guestSnapshot } from '../server.mjs';
import { makeWorlds } from '../worlds.mjs';
import { makeWorld, LIVE_WORLDS, cleanState, freeName, givenName, plainName } from '../live.mjs';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (ok, ms = 4000) => { for (let t = 0; t < ms; t += 25) { if (ok()) return true; await sleep(25); } return ok(); };

const agent = (id, state, over = {}) => ({
  id, kind: 'interactive', name: id, cwd: '/p/shop', state, stateSince: 5, startedAt: 1, lastPrompt: 'fix the cart', lastReply: `${id} says the cart is fixed`,
  feed: [{ at: 3, kind: 'reply', text: 'the cart is fixed' }, { at: 2, kind: 'tool', tool: 'Edit', step: 'edit', summary: 'src/cart.ts' }], children: [], touching: [], docs: [], ...over,
});
/** Three at work in a repo, nine gone stale (four stand in the scarecrows' row, five behind it), one waiting on you. */
const snapshot = (over = {}) => ({
  generatedAt: Date.now(), counts: {}, collisions: [], repos: [{ path: '/p/shop', name: 'shop', bed: 0 }],
  agents: [
    agent('w1', 'working', { now: { tool: 'Bash', step: 'test', summary: 'npm test -- cart', startedAt: 4 } }), agent('w2', 'working'), agent('w3', 'working', { now: { tool: 'mcp__notes__search', step: 'search', service: 'notes', summary: 'cart', startedAt: 4 } }),
    ...Array.from({ length: 9 }, (_, i) => agent(`s${i}`, 'stale')), agent('q1', 'waiting', { ask: { kind: 'question', questions: ['Push it?'] } }),
  ],
  ...over,
});
const guestJson = snap => JSON.stringify(guestSnapshot(snap));

test('the worlds moved here are the built-in ones, and the page knows the same list', () => {
  assert.deepEqual(LIVE_WORLDS, ['farm', 'factory']);
  assert.match(readFileSync(`${WEB}worlds.js`, 'utf8'), /const LIVE_WORLDS = \['farm', 'factory'\];/, "web/worlds.js's copy");
  assert.throws(() => makeWorld('u/mine', WEB), /no such world/, 'never a world from your folder: its code is not ours to run here');
  assert.throws(() => makeWorld('../collector', WEB), /no such world/);
});

for (const key of LIVE_WORLDS) {
  test(`the ${key}, run without a page: everyone has a place, time moves it on, and it says how it stands as plain data`, () => {
    const world = makeWorld(key, WEB);
    world.scene(guestJson(snapshot()));
    const first = world.step(0);
    assert.equal(first.t, 0);
    assert.equal(first.bodies.length, 8, 'three at work, four of the stale in their row, one waiting: the rest are over the cap');
    assert.ok(first.bodies.every(b => typeof b[0] === 'string' && b.slice(1, 6).every(Number.isFinite) && typeof b[6] === 'string'), 'each as [id, x, y, tx, ty, bits, zone]');
    assert.equal(first.over.storage, 5, 'five stale ones behind the row');
    assert.equal(first.spare, 5, 'who could step out for a job');
    assert.ok(first.animals.ones.length > 0 && first.animals.ones.every(a => a.length === 7), 'its animals, each as [id, x, y, bits, pose, lift, den]');
    const later = world.step(200);
    assert.ok(Math.abs(later.t - 10) < 1e-6, 'two hundred steps are ten seconds');
    assert.notDeepEqual(later.animals.ones.map(a => [a[1], a[2]]), first.animals.ones.map(a => [a[1], a[2]]), 'the animals have moved');
    assert.doesNotThrow(() => JSON.stringify(later));
  });
}

test('the farm, asked for more than five things at once: five are out, the rest wait in line; those behind the row step out, and go back in', () => {
  const world = makeWorld('farm', WEB);
  world.scene(guestJson(snapshot()));
  let st = world.step(1);
  const pig = st.animals.ones.find(a => a[0].startsWith('pig'))[0];
  const asked = Array.from({ length: 8 }, (_, i) => world.ask({ animal: pig, act: 0, by: `c${i}` }));
  assert.ok(asked.every(r => r.ok && /^s\d$/.test(r.doer)), 'a scarecrow each');
  assert.equal(new Set(asked.map(r => r.doer)).size, 8, 'eight different ones');
  assert.deepEqual(asked.map(r => r.wait), [0, 1, 2, 3, 4, 5, 6, 7], 'each told how many wait ahead of it');
  const onMap = new Set(st.bodies.map(b => b[0])), out = asked.filter(r => !onMap.has(r.doer)).length;
  assert.ok(out >= 4, 'the row has four: the rest of the eight come from behind it');
  st = world.step(1);
  assert.equal(st.bodies.length, 8 + out, 'they have stepped out');
  assert.equal(st.over.storage, 5 - out, 'and the sign counts one fewer for each');
  let most = 0, held = 0, hearts = 0, lined = 0;
  for (let i = 0; i < 1200 && st.jobs.length; i++) {
    st = world.step(2);
    most = Math.max(most, st.jobs.filter(j => j.phase !== 'wait').length);
    held = Math.max(held, st.jobs.filter(j => j.held).length);
    lined = Math.max(lined, st.jobs.filter(j => j.phase === 'line').length);
    hearts += st.fx.filter(e => e.fx === 'hearts').length;
    assert.ok(st.jobs.filter(j => j.phase === 'act').length <= 1, 'one at the animal at a time');
  }
  assert.equal(st.jobs.length, 0, 'all done');
  assert.equal(most, 5, 'never more than five out');
  assert.equal(held, 3, 'three waited at the waiting place');
  assert.ok(lined >= 1, 'they stood in line at the animal');
  assert.equal(hearts, 8, 'each action was done once, and shown');
  assert.equal(st.bodies.length, 8, 'the ones from behind the row are back in');
  assert.equal(st.over.storage, 5);
  assert.deepEqual(world.ask({ animal: 'pig-77', act: 0 }), { ok: false, why: 'gone' }, 'no such animal');
  assert.deepEqual(world.ask({ animal: pig, act: 9 }), { ok: false, why: 'gone' }, 'no such action');
});

test("a guest's scene is yours without the words: every farmer in the same place with the same tool, so one world can be moved for both", () => {
  const window = { Agentville: {} };
  const ctx = vm.createContext({ window });
  vm.runInContext(readFileSync(`${WEB}scene.js`, 'utf8'), ctx);
  const snap = snapshot();
  const mine = JSON.parse(JSON.stringify(window.AgentvilleScene.toScene(JSON.parse(JSON.stringify(snap))))), theirs = JSON.parse(JSON.stringify(window.AgentvilleScene.toScene(JSON.parse(guestJson(snap)))));
  const WORDS = new Set(['reply', 'said', 'summary', 'ask', 'question', 'label', 'result', 'items', 'mail', 'prompt', 'askKind', 'planAsk']); // what was said, and what kind of question it is (how its bubble is drawn: no one's place)
  const differ = [];
  (function walk(a, b, path) {
    if (JSON.stringify(a) === JSON.stringify(b)) return;
    if (a && b && typeof a === 'object' && typeof b === 'object') { for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) if (!WORDS.has(k)) walk(a[k], b[k], `${path}.${k}`); return; }
    differ.push(path);
  })(mine, theirs, 'scene');
  assert.deepEqual(differ, [], 'only what was said differs');
  assert.equal(theirs.agents.find(a => a.id === 'w2').tool, 'Edit', 'one between two steps keeps its last tool');
  assert.deepEqual(theirs.mcp, [{ server: 'notes', busy: 'w3' }], "a connector call's cart goes to its farmer for a guest too");
  assert.doesNotMatch(guestJson(snap), /cart is fixed|fix the cart|src\/cart|npm test|Push it/, 'and nothing that was said goes out');
});

/* ---------- the room ---------- */

const servers = [];
async function dashboard({ snap = snapshot(), lan = false, userDir = null } = {}) {
  let now = snap;
  const logged = [];
  const worlds = userDir ? makeWorlds({ builtinDir: `${WEB}worlds`, userDir }) : undefined;
  const srv = createTrackerServer({ port: 0, token: 'tok', webFile: `${WEB}index.html`, lan, log: m => logged.push(String(m)), worlds, getSnapshot: () => now, getFeed: () => [], getConversation: async () => ({ total: 0, from: 0, items: [] }), actions: {} });
  const port = await srv.listen();
  servers.push(srv);
  return { srv, port, logged, url: `http://127.0.0.1:${port}`, publish(next) { now = next; srv.broadcast(next); } };
}
after(async () => { for (const s of servers) await s.close(); });
const post = (host, port, path, body, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host, port, path, method: 'POST', headers: { host: `${host}:${port}`, 'content-type': 'application/json', ...headers } }, res => { let text = ''; res.on('data', d => { text += d; }); res.on('end', () => resolve({ status: res.statusCode, body: text })); });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});
const shape = s => JSON.stringify({ t: s.t, b: [...s.bodies.entries()].map(([id, b]) => [id, b.x, b.y, b.bits, b.zone]), a: [...s.animals.entries()].map(([id, a]) => [id, a.x, a.y, a.pose]), says: [...s.says.entries()] });

test('this Mac and a guest are in one room and are sent the same world, step for step; nothing in it was said by anyone', async () => {
  const d = await dashboard();
  const mine = await new Client(d.url).joinOrCreate('world', { world: 'farm', token: 'tok' }), theirs = await new Client(d.url).joinOrCreate('world', { world: 'farm' });
  try {
    assert.equal(mine.roomId, theirs.roomId, 'one room for the farm');
    let a = null, b = null, patches = 0;
    mine.onStateChange(s => { a = s; patches++; });
    theirs.onStateChange(s => { b = s; });
    assert.ok(await until(() => a && b && a.bodies.size === 8 && b.bodies.size === 8), 'both are told where everyone is');
    const from = patches;
    await sleep(500);
    assert.ok(patches - from >= 7 && patches - from <= 13, `about twenty states a second (${patches - from} in half a second)`);
    assert.ok(await until(() => shape(a) === shape(b)), 'the same state');
    assert.ok(a.t > 0.4, 'its clock runs');
    assert.deepEqual([...a.shared.keys()].sort(), ['carts', 'cat', 'ghosts', 'hens', 'leavers', 'left', 'porch', 'rounds', 'whistled', 'works'], "what the farm itself shares, under the farm's keys");
    assert.ok(Math.abs(a.wall - Date.now()) < 2000, "with the collector's time of day, for what goes by the clock");
    const all = JSON.stringify({ b: [...a.bodies.values()].map(v => v.toJSON()), sh: [...a.shared.entries()], over: a.over });
    assert.doesNotMatch(all, /cart is fixed|fix the cart|src\/cart|npm test|Push it/);
    const room = matchMaker.getLocalRoomById(mine.roomId);
    assert.deepEqual(Array.from(room.clients, c => c.userData.host).sort(), [false, true], 'the token, from this Mac, makes one of them this Mac');
    const other = await new Client(d.url).joinOrCreate('world', { world: 'factory' });
    assert.notEqual(other.roomId, mine.roomId, 'the factory is another room');
    await other.leave();
  } finally { await mine.leave(); await theirs.leave(); }
  assert.ok(await until(() => !matchMaker.getLocalRoomById(mine.roomId)), 'with no one watching, the room closes: nothing runs');
});

test('anyone watching may ask an animal for an action, and everyone sees it done: asked twice it is done once, and one at a time', async () => {
  const d = await dashboard();
  const mine = await new Client(d.url).joinOrCreate('world', { world: 'farm', token: 'tok' }), theirs = await new Client(d.url).joinOrCreate('world', { world: 'farm' });
  try {
    let state = null;
    const seen = { mine: [], theirs: [] }, answers = [];
    mine.onStateChange(s => { state = s; });
    mine.onMessage('fx', e => { if (e.fx) seen.mine.push(e); }); // (a word popping up comes this way too: { pop })
    theirs.onMessage('fx', e => { if (e.fx) seen.theirs.push(e); });
    theirs.onMessage('re', r => answers.push(r));
    assert.ok(await until(() => state?.animals.size > 0));
    const near = ([, a]) => Math.hypot(a.x / 8 - 330, a.y / 8 - 90); // the animal nearest the scarecrows' row: the shortest walk
    const pig = [...state.animals.entries()].filter(([, a]) => !(a.bits & 1)).sort((p, q) => near(p) - near(q))[0][0];
    theirs.send('act', { rid: 'guest-1', animal: pig, act: 0 });
    theirs.send('act', { rid: 'guest-1', animal: pig, act: 0 }); // sent again (a dropped connection): the same answer, nothing more done
    theirs.send('act', { rid: 'guest-2', animal: pig, act: 1 }); // too soon after the first
    assert.ok(await until(() => answers.length === 3));
    assert.deepEqual(answers.slice(0, 2).map(r => [r.rid, r.ok, r.animal, typeof r.doer, r.wait]), [['guest-1', true, pig, 'string', 0], ['guest-1', true, pig, 'string', 0]]);
    assert.equal(answers[0].doer, answers[1].doer, 'the very same answer');
    assert.deepEqual(answers[2], { rid: 'guest-2', animal: pig, ok: false, why: 'slow' });
    assert.ok(await until(() => state.jobs === 1), 'one job under way');
    for (const bad of [{ rid: 'x', animal: '../etc', act: 0 }, { rid: 'has space', animal: pig, act: 0 }, { rid: 'y', animal: pig, act: 99 }, { animal: pig, act: 0 }, null]) theirs.send('act', bad);
    assert.ok(await until(() => seen.mine.length === 1 && seen.theirs.length === 1, 15_000), 'its farmer got there: the action is shown to both');
    assert.deepEqual(seen.mine, seen.theirs);
    assert.deepEqual(Object.keys(seen.mine[0]).sort(), ['at', 'fx', 't'], 'what to show, where, and at what moment of the world');
    assert.equal(answers.length, 3, 'what is written wrong is not answered');
  } finally { await mine.leave(); await theirs.leave(); }
});

test("the helper's lines for the animals go to this Mac's browser alone; a guest is sent the world's own line", async () => {
  const lines = [{ kind: 'cow', when: 'idle', text: 'the cart tests are red again' }, { kind: 'pig', when: 'idle', text: 'w1 is at the trough of bugs' }, { kind: 'goat', when: 'idle', text: 'someone merged on a friday' }, { kind: 'sheep', when: 'idle', text: 'counting failing tests' }, { kind: 'horse', when: 'idle', text: 'neigh to that refactor' }, { kind: 'goose', when: 'idle', text: 'honk if it compiles' }, { kind: 'duck', when: 'idle', text: 'quack went the deploy' }, { kind: 'cat', when: 'idle', text: 'I sat on the cart code' }, { kind: 'sheepdog', when: 'idle', text: 'herding the branches' }, { kind: 'mouse', when: 'idle', text: 'nibbling the cart cache' }];
  const d = await dashboard({ snap: snapshot({ chatter: { at: 7, lines } }) });
  const mine = await new Client(d.url).joinOrCreate('world', { world: 'farm', token: 'tok' }), theirs = await new Client(d.url).joinOrCreate('world', { world: 'farm' });
  try {
    const own = [], leaked = [];
    let theirState = null;
    mine.onMessage('says', list => own.push(...list));
    theirs.onMessage('says', list => leaked.push(...list));
    theirs.onStateChange(s => { theirState = s; });
    const fresh = new Set(lines.map(l => l.text)), said = new Set();
    assert.ok(await until(() => { for (const text of theirState?.says.values() ?? []) said.add(text); return own.some(([, text]) => fresh.has(text)); }, 60_000), "an animal says one of the helper's lines, to this Mac");
    assert.deepEqual(leaked, [], 'a guest is sent none of them');
    assert.ok([...said].every(text => !fresh.has(text)), `nor are they in the state everyone gets (${[...said].join(' | ')})`);
  } finally { await mine.leave(); await theirs.leave(); }
});

test('a new snapshot moves the world for everyone: a farmer whose turn ends walks to the porch', async () => {
  const d = await dashboard();
  const room = await new Client(d.url).joinOrCreate('world', { world: 'farm' });
  try {
    let state = null;
    room.onStateChange(s => { state = s; });
    assert.ok(await until(() => state?.bodies.get('w1')));
    const before = [state.bodies.get('w1').x, state.bodies.get('w1').y];
    const next = snapshot();
    next.agents[0] = { ...next.agents[0], state: 'turn', now: undefined };
    d.publish(next);
    assert.ok(await until(() => state.bodies.get('w1').zone === 'turn'), 'its place is the porch now');
    assert.ok(await until(() => state.bodies.get('w1').bits & 1), 'and it walks there');
    assert.notDeepEqual([state.bodies.get('w1').tx * 8, state.bodies.get('w1').ty * 8], before);
  } finally { await room.leave(); }
});

test('a seat is given only to this dashboard\'s own pages, for a world there is; a guest may ask for one, and for nothing else', async t => {
  const d = await dashboard({ lan: true });
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'farm' }, { origin: 'http://evil.example' })).status, 403, 'another site');
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'farm' }, { host: 'evil.example' })).status, 403, 'another name for this Mac');
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'nowhere' })).status, 404);
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/lobby', { world: 'farm' })).status, 404, 'no room but a world');
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/create/world', { world: 'farm' })).status, 404, 'no way but joinOrCreate and reconnect');
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'farm', pad: 'x'.repeat(5000) })).status, 413);
  const seat = await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'farm', live: 'someone-elses' }, { origin: `http://127.0.0.1:${d.port}` });
  assert.equal(seat.status, 200);
  assert.deepEqual(Object.keys(JSON.parse(seat.body)).sort(), ['name', 'processId', 'roomId', 'sessionId']);
  const flood = await Promise.all(Array.from({ length: 14 }, () => post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'farm' })));
  assert.deepEqual([...new Set(flood.map(r => r.status))].sort(), [200, 429], 'more than a dozen from one address in ten seconds: the rest are refused');
  assert.equal(flood.filter(r => r.status === 200).length, 12 - 4, 'twelve in all, the four asked above (from this address, by a page of its own) among them');
  const own = Object.values(networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  if (!own) return t.skip('this machine has no network address to visit from');
  const theirs = await post(own, d.port, '/matchmake/joinOrCreate/world', { world: 'farm', token: 'tok' });
  assert.equal(theirs.status, 200, 'a guest gets a seat');
  assert.equal((await post(own, d.port, '/api/actions/reload', {}, { 'x-tracker-token': 'tok', origin: `http://${own}:${d.port}` })).status, 403, 'and still no way to act on an agent');
  // The guest opens its socket, claiming (by a header) to come from this Mac, with the token: it stays a guest.
  const { roomId, processId, sessionId } = JSON.parse(theirs.body);
  const ws = new WebSocket(`ws://${own}:${d.port}/${processId}/${roomId}?sessionId=${sessionId}`, { headers: { 'x-forwarded-for': '127.0.0.1', 'x-real-ip': '127.0.0.1' } });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  assert.ok(await until(() => matchMaker.getLocalRoomById(roomId)?.clients.length === 1));
  assert.equal(matchMaker.getLocalRoomById(roomId).clients[0].userData.host, false, "the socket's own address says who it is");
  ws.close();
  // Another site's page can't open a socket here either.
  const foreign = new WebSocket(`ws://127.0.0.1:${d.port}/${processId}/${roomId}?sessionId=${sessionId}`, { headers: { origin: 'http://evil.example' } });
  assert.equal(await new Promise(resolve => { foreign.once('open', () => resolve('open')); foreign.once('error', () => resolve('refused')); foreign.once('close', () => resolve('refused')); }), 'refused');
});

test("the page's library is this collector's own copy of the installed SDK, and a browser that has it is told so", async () => {
  const d = await dashboard();
  const res = await fetch(`${d.url}/colyseus.js`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.match(await res.text(), /colyseus\.js@\d+\.\d+\.\d+/);
  const again = await fetch(`${d.url}/colyseus.js`, { headers: { 'if-none-match': res.headers.get('etag') } });
  assert.equal(again.status, 304);
});

test("the factory shares where its AGVs drive: another factory takes it as it is, and, told, drives none itself", () => {
  const window = { Agentville: { raw() {} }, devicePixelRatio: 1 };
  const ctx = vm.createContext({ window, console });
  for (const f of ['scene.js', 'worlds/legacy/pixel.js', 'worlds/legacy/people.js', 'worlds/legacy/props.js', 'worlds/legacy/creatures.js', 'worlds/legacy/animals.js', 'worlds/sdk/grid.js', 'worlds/legacy/engine.js', 'worlds/factory/world.js']) vm.runInContext(readFileSync(`${WEB}${f}`, 'utf8'), ctx, { filename: f });
  const F = window.AgentvilleFactory, plain = v => JSON.parse(JSON.stringify(v));
  const t = Date.now(), snap = snapshot();
  snap.agents[2] = { ...snap.agents[2], mcp: [{ server: 'notes', at: t }], now: { ...snap.agents[2].now, startedAt: t } };
  const made = () => { const h = F.makeFactory(), sc = F.factoryScene(window.AgentvilleScene.toScene(JSON.parse(JSON.stringify(snap)))); h.setScene(sc); h.relayout(F.FACTORY_GRID.layoutFor(sc.fields)); return h; };
  const moved = made(), shown = made(), posOf = () => ({ x: 150, y: 150, tx: 150, ty: 150, path: [] });
  moved.tick(0.05, posOf);
  const home = plain(moved.share());
  assert.deepEqual(home.agvs.map(a => a[0]), ['notes']);
  for (let i = 0; i < 20; i++) moved.tick(0.05, posOf);
  const out = plain(moved.share());
  assert.notDeepEqual(out.agvs[0].slice(1, 3), home.agvs[0].slice(1, 3), 'it drives to the robot making the call');
  shown.tick(0.05, posOf, false, true);
  shown.adopt(out);
  assert.deepEqual(plain(shown.share()), out);
  for (let i = 0; i < 20; i++) shown.tick(0.05, posOf, false, true);
  assert.deepEqual(plain(shown.share()), out, 'told: it stays where it was said to be');
});

/* ---------- who is watching ---------- */

test('a name is one line of plain text; one that someone has gets a number; a browser is given the same two words whenever it comes', () => {
  assert.equal(plainName('  Sam   the\u202e Second\n '), 'Sam the Second');
  assert.equal(plainName('x'.repeat(40)).length, 24);
  for (const none of ['', '   ', '\u200b\u0007', null, 7, {}]) assert.equal(plainName(none), '');
  assert.equal(freeName('Sam', ['Ann']), 'Sam');
  assert.equal(freeName('Sam', ['sam', 'SAM 2']), 'Sam 3', 'whatever their capitals');
  assert.equal(freeName('x'.repeat(24), ['x'.repeat(24)]).length, 24, 'still no longer than a name may be');
  assert.equal(givenName('abcdefgh12345678'), givenName('abcdefgh12345678'));
  assert.match(givenName('abcdefgh12345678'), /^[A-Z][a-z]+ [A-Z][a-z]+$/);
  assert.ok(new Set(Array.from({ length: 200 }, (_, i) => givenName(`viewer-key-${i}`))).size > 120, 'many different ones');
});

const viewersOf = s => [...s.viewers.entries()].map(([id, v]) => [id, v.name, v.host, v.on]);
test('a room says who watches: each browser once, whatever its tabs; this Mac marked; looking or away; gone a moment after it leaves', async () => {
  const d = await dashboard();
  const url = d.url, mine = { world: 'farm', token: 'tok', viewer: 'this-mac-browser-1' };
  const tab1 = await new Client(url).joinOrCreate('world', mine), told = [];
  tab1.onMessage('you', m => told.push(m));
  let s = null;
  tab1.onStateChange(st => { s = st; });
  const tab2 = await new Client(url).joinOrCreate('world', mine); // the same browser, a second tab
  const guest = await new Client(url).joinOrCreate('world', { world: 'farm', viewer: 'a-guest-browser-22', name: '  Ann  ' });
  const nameless = await new Client(url).joinOrCreate('world', { world: 'farm' }); // an older page: no key of its own
  try {
    assert.ok(await until(() => s?.viewers.size === 3));
    const given = givenName('this-mac-browser-1');
    assert.deepEqual(viewersOf(s).map(v => v.slice(1)).sort(), [[given, true, true], ['Ann', false, true], [viewersOf(s).find(v => v[0] === 'v3')[1], false, true]].sort(), 'two tabs of one browser are one watcher; a name brought along is kept');
    tab1.send('see', { on: true });
    assert.ok(await until(() => told.length > 0));
    assert.deepEqual(told.at(-1), { id: 'v1', host: true }, 'a browser is told which of them it is');
    tab1.send('see', { on: false });
    await sleep(150);
    assert.equal(viewersOf(s).find(v => v[0] === 'v1')[3], true, 'one tab out of sight: its other tab still looks');
    tab2.send('see', { on: false });
    assert.ok(await until(() => viewersOf(s).find(v => v[0] === 'v1')[3] === false), 'both out of sight: it is away');
    tab2.send('see', { on: true });
    assert.ok(await until(() => viewersOf(s).find(v => v[0] === 'v1')[3] === true));
    await guest.leave();
    await sleep(300);
    assert.equal(s.viewers.size, 3, 'one that left is kept a moment: a reload does not make it flicker');
    const back = await new Client(url).joinOrCreate('world', { world: 'farm', viewer: 'a-guest-browser-22', name: 'Someone else' });
    await sleep(200);
    assert.deepEqual(viewersOf(s).find(v => v[0] === 'v2').slice(1), ['Ann', false, true], 'back in time: the same watcher, under the name it has here');
    await back.leave();
    assert.ok(await until(() => s.viewers.size === 2, 6000), 'gone for good after a few seconds');
  } finally { for (const r of [tab1, tab2, nameless]) await r.leave().catch(() => {}); }
});

test('a watcher names itself: plain text, told apart from the others, once a second, and asked twice changed once; a guest may too', async () => {
  const d = await dashboard();
  const a = await new Client(d.url).joinOrCreate('world', { world: 'farm', token: 'tok', viewer: 'this-mac-browser-1' }), b = await new Client(d.url).joinOrCreate('world', { world: 'farm', viewer: 'a-guest-browser-22' });
  try {
    let s = null;
    const got = { a: [], b: [] };
    a.onStateChange(st => { s = st; });
    a.onMessage('named', m => got.a.push(m));
    b.onMessage('named', m => got.b.push(m));
    b.send('name', { rid: 'n1', name: '  <b>Sam</b>   the\u202e 2nd ' });
    b.send('name', { rid: 'n1', name: 'something else' }); // the same asking again: the same answer, nothing changed
    assert.ok(await until(() => got.b.length === 2));
    assert.deepEqual(got.b, [{ rid: 'n1', ok: true, name: '<b>Sam</b> the 2nd' }, { rid: 'n1', ok: true, name: '<b>Sam</b> the 2nd' }], 'kept as text (a page shows it as text), its spaces single, no hidden marks');
    assert.ok(await until(() => s && viewersOf(s).find(v => v[0] === 'v2')?.[1] === '<b>Sam</b> the 2nd'), 'and everyone watching sees it');
    a.send('name', { rid: 'n2', name: '<B>SAM</B> THE 2ND' });
    assert.ok(await until(() => got.a.length === 1));
    assert.deepEqual(got.a[0], { rid: 'n2', ok: true, name: '<B>SAM</B> THE 2ND 2' }, 'a name someone else has gets a number');
    a.send('name', { rid: 'n3', name: 'Too soon' });
    a.send('name', { rid: 'n4', name: ' \u200b ' });
    for (const bad of [{ name: 'no rid' }, { rid: 'has space', name: 'x' }, null]) a.send('name', bad);
    assert.ok(await until(() => got.a.length === 3));
    assert.deepEqual(got.a.slice(1).map(m => [m.rid, m.ok, m.why]), [['n3', false, 'slow'], ['n4', false, 'empty']]);
    await sleep(1050);
    a.send('name', { rid: 'n5', name: 'Kim' });
    assert.ok(await until(() => viewersOf(s).find(v => v[0] === 'v1')[1] === 'Kim'));
  } finally { await a.leave(); await b.leave(); }
});

/* ---------- a world from your folder: a process of its own, shut in, only while it is watched ---------- */

/** A folder of worlds: the starter under each name, and whatever `more` adds ({ name: world.js }). */
function folder(names, more = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'tracker-live-'));
  for (const name of names) cpSync(`${WEB}worlds/legacy-starter`, join(dir, name), { recursive: true });
  for (const [name, js] of Object.entries(more)) { cpSync(`${WEB}worlds/legacy-starter`, join(dir, name), { recursive: true }); writeFileSync(join(dir, name, 'world.js'), js); }
  return dir;
}

test('what a world of yours says of itself is kept to what a state is, whatever it says', () => {
  const st = cleanState({ t: 'soon', wall: NaN, bodies: [['a', 1e9, -1e9, 'x', null, 999, { z: 1 }], 'junk', ['b']], animals: { ones: [['cat-0', 1, 2, 3, 'x'.repeat(99), 4, 5]], says: [['cat-0', 'y'.repeat(99), null]], taken: 'bucket' },
    over: { row: 1e12, ['k'.repeat(99)]: -4 }, spare: -1, jobs: [{ by: 7 }, null], shared: { ok: [1, 2], 'bad key!': 1, big: 'x'.repeat(20_000), fn: () => 1 }, fx: [{ pop: [1, 2, 'z'.repeat(99), 'good'] }, { fx: 'hearts', at: [1e9, 'x'] }, { fx: 'no place' }, 'junk'], flights: [['a', 'b', 'x'], 'junk'] });
  assert.deepEqual([st.t, st.wall], [0, 0]);
  assert.deepEqual(st.bodies, [['a', 4000, -4000, 0, 0, 255, '[object Object]'], ['b', 0, 0, 0, 0, 0, '']]);
  assert.deepEqual(st.animals, { ones: [['cat-0', 1, 2, 3, 'x'.repeat(24), 4, 5]], says: [['cat-0', 'y'.repeat(40), null]], taken: [] });
  assert.deepEqual([st.over.row, st.spare, st.jobs], [9999, 0, [{ by: null }, { by: null }]]);
  assert.deepEqual(Object.keys(st.shared), ['ok'], 'its own things: a few, small, under plain names');
  assert.deepEqual(st.fx, [{ pop: [1, 2, 'z'.repeat(40), 'good'] }, { fx: 'hearts', at: [4000, 0] }]);
  assert.deepEqual(st.flights, [['a', 'b', 0]]);
  assert.doesNotThrow(() => cleanState(null));
});

test('a world of yours is moved in a thread of its own, started when it is first watched and stopped when no one watches; it is given numbers for names', async () => {
  const d = await dashboard({ userDir: folder(['demo']) });
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'u/nowhere' })).status, 404);
  const a = await new Client(d.url).joinOrCreate('world', { world: 'u/demo', token: 'tok' }), b = await new Client(d.url).joinOrCreate('world', { world: 'u/demo' });
  let sim = null;
  try {
    assert.equal(a.roomId, b.roomId, 'one room for it');
    sim = matchMaker.getLocalRoomById(a.roomId).sim;
    assert.ok(sim.thread > 0 && sim.alive(), 'in a thread of its own');
    let sa = null, sb = null;
    a.onStateChange(s => { sa = s; });
    b.onStateChange(s => { sb = s; });
    assert.ok(await until(() => sa?.bodies.size > 0 && sb?.bodies.size > 0 && sa.t > 0.3));
    assert.ok(await until(() => shape(sa) === shape(sb)), 'everyone watching is told the same');
    const all = JSON.stringify({ zones: [...sa.bodies.values()].map(v => v.zone), shared: [...sa.shared.entries()] });
    assert.doesNotMatch(all, /shop|\/p\//, 'what it says holds no name or path: it was given none');
    assert.ok([...sa.bodies.values()].some(v => /^st:r\d+$/.test(v.zone)), `its plots are numbers (${[...sa.bodies.values()].map(v => v.zone).slice(0, 3)})`);
    const names = JSON.parse(sa.names);
    assert.ok(names.some(([what, standIn]) => what === 'r:/p/shop' && /^r\d+$/.test(standIn)), "the room hands every page the collector's stand-ins, so their private scenes number alike");
    const animal = [...sa.animals.keys()][0], answers = [];
    b.onMessage('re', r => answers.push(r));
    b.send('act', { rid: 'own-1', animal, act: 0 });
    b.send('act', { rid: 'own-1', animal, act: 0 }); // again, while the first asking is still with its process
    assert.ok(await until(() => answers.length === 2));
    assert.deepEqual(answers[0], answers[1], 'asked twice, answered the same, done once');
    assert.equal(answers[0].ok, true);
  } finally { await a.leave(); await b.leave(); }
  assert.ok(await until(() => !sim.alive()), 'no one watches: its thread is gone');
});

test('a world of yours has nothing to reach: no process, no file, no network, no program, no way out of its engine; one that takes too much memory or hangs is stopped', async () => {
  // Everything a world must not get at, tried from inside: the ways out of a context (a constructor's constructor, an
  // import), and what a page or Node would offer. It says what it found in what it shares.
  const spy = `(() => {
    const out = {}, tried = (k, fn) => { try { out[k] = String(fn()); } catch (e) { out[k] = 'refused: ' + (e.message || e) }; };
    const outside = (() => { try { return window.Agentville.raw.constructor('return this')(); } catch (e) { return null; } })();
    out.same = outside === globalThis; // a function made by a constructor still runs in here
    for (const name of ['process', 'require', 'module', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Deno', 'Bun', 'os', 'std', 'Worker', 'WebAssembly', 'setTimeout', 'postMessage', 'parentPort', 'workerData']) out['has_' + name] = typeof (outside ?? globalThis)[name];
    tried('process', () => window.Agentville.raw.constructor('return process')().version);
    tried('require', () => window.Agentville.raw.constructor('return require')()('node:fs').readFileSync('/etc/hosts', 'utf8'));
    let imported = 'pending';
    try { import('node:fs').then(m => { imported = 'got ' + Object.keys(m).length; }, e => { imported = 'refused: ' + (e.message || e); }); } catch (e) { imported = 'refused: ' + (e.message || e); }
    Agentville.world({ W: 200, slots: () => ({ group: 'all', cap: 9, at: i => [20 + i * 10, 40], zone: 'all' }), drawChar() {}, bg() {}, share: () => ({ probe: { ...out, imported } }) });
  })();`;
  const hog = `(() => { const kept = []; Agentville.world({ W: 200, slots: () => ({ group: 'all', cap: 9, at: i => [20 + i * 10, 40], zone: 'all' }), drawChar() {}, bg() {}, tick() { for (let i = 0; i < 64; i++) kept.push(new Array(100000).fill(kept.length)); } }); })();`;
  const d = await dashboard({ userDir: folder([], { spy, hog, hang: `(() => { Agentville.world({ W: 200, slots: () => ({ group: 'all', cap: 9, at: i => [20 + i * 10, 40], zone: 'all' }), drawChar() {}, bg() {}, tick() { for (;;); } }); })();`, raw: `Agentville.raw({ start() {}, scene() {} });` }) });
  const room = await new Client(d.url).joinOrCreate('world', { world: 'u/spy' });
  try {
    let s = null;
    room.onStateChange(st => { s = st; });
    assert.ok(await until(() => { try { return /^refused|^got/.test(JSON.parse(s?.shared.get('probe') ?? '{}').imported); } catch { return false; } }, 6000), 'it ran, and said what it found');
    const probe = JSON.parse(s.shared.get('probe'));
    assert.equal(probe.same, true, 'the way out of a context leads back into its own engine');
    for (const name of ['process', 'require', 'module', 'fetch', 'XMLHttpRequest', 'WebSocket', 'Deno', 'Bun', 'os', 'std', 'Worker', 'WebAssembly', 'setTimeout', 'postMessage', 'parentPort', 'workerData']) assert.equal(probe[`has_${name}`], 'undefined', `no ${name} in there`);
    assert.match(probe.process, /^refused: /, `no process (${probe.process})`);
    assert.match(probe.require, /^refused: /, `no file read (${probe.require})`);
    assert.match(probe.imported, /^refused: /, `nothing to import (${probe.imported})`);
  } finally { await room.leave(); }
  // one that keeps taking memory: its engine refuses it more, its thread is ended, and the collector itself is none the fuller
  const rssBefore = process.memoryUsage().rss;
  const greedy = await new Client(d.url).joinOrCreate('world', { world: 'u/hog' });
  let greedyLeft = false;
  greedy.onLeave(() => { greedyLeft = true; });
  assert.ok(await until(() => greedyLeft, 8000), 'stopped, and its watcher let go');
  assert.ok(process.memoryUsage().rss - rssBefore < 400 * 1024 * 1024, 'what it took was bounded');
  assert.ok(d.logged.some(l => /the u\/hog failed: out of memory/.test(l)), `the log says why (${d.logged.filter(l => /hog/.test(l)).join(' | ')})`);
  // one that never returns: it is cut off, its thread is ended, its room closes, and its page moves it itself
  const stuck = await new Client(d.url).joinOrCreate('world', { world: 'u/hang' });
  const stuckSim = matchMaker.getLocalRoomById(stuck.roomId).sim;
  let left = false;
  stuck.onLeave(() => { left = true; });
  assert.ok(await until(() => left && !stuckSim.alive(), 6000), 'stopped, and its watcher let go');
  assert.ok(d.logged.some(l => /u\/hang is moved by its browsers again: it did not answer/.test(l)), 'the log says why');
  // one that draws itself has nothing here to move
  const raw = await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'u/raw' });
  assert.equal(raw.status, 503);
  assert.match(raw.body, /draws itself/);
  const before = d.logged.length;
  assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'u/raw' })).status, 503, 'asked again, it is not even started: that is known until its files change');
  assert.equal(d.logged.length, before);
});

test('only a few worlds of yours are moved at once: one more is left to its browsers until another stops; a watcher of one already moved always gets in', async () => {
  const names = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'];
  const d = await dashboard({ userDir: folder(names) });
  const rooms = [];
  try {
    for (const n of names.slice(0, 6)) rooms.push(await new Client(d.url).joinOrCreate('world', { world: `u/${n}` }));
    const seventh = await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'u/w7' });
    assert.equal(seventh.status, 503);
    assert.match(seventh.body, /6 worlds of yours are moved here already/);
    rooms.push(await new Client(d.url).joinOrCreate('world', { world: 'u/w1' })); // one more watcher of a world that runs: no new process
    assert.equal(rooms.at(-1).roomId, rooms[0].roomId);
    const [stopped] = rooms.splice(1, 1);
    await stopped.leave();
    assert.ok(await until(() => !matchMaker.getLocalRoomById(stopped.roomId)));
    assert.equal((await post('127.0.0.1', d.port, '/matchmake/joinOrCreate/world', { world: 'u/w7' })).status, 200, 'one stopped: there is room for it now');
  } finally { await Promise.all(rooms.map(r => r.leave().catch(() => {}))); }
});

test('the list of worlds says how many look at each just now: what its chip says, 0 where no one watches', async () => {
  const d = await dashboard({ userDir: folder(['demo']) });
  const list = async () => Object.fromEntries((await (await fetch(`${d.url}/api/worlds`, { headers: { 'x-tracker-token': 'tok' } })).json()).worlds.map(w => [w.key, w.online]));
  const settles = async (ok, ms = 6000) => { for (let t = 0; t < ms; t += 50) { if (await ok()) return true; await sleep(50); } return ok(); }; // (what is asked is itself awaited)
  assert.deepEqual(await list(), { farm: 0, factory: 0, tennis: 0, 'u/demo': 0 }, 'before anyone watches: nothing is started to count');
  const a = await new Client(d.url).joinOrCreate('world', { world: 'farm', token: 'tok', viewer: 'viewer-aaaaaaaa' }), b = await new Client(d.url).joinOrCreate('world', { world: 'farm', viewer: 'viewer-bbbbbbbb' });
  const c = await new Client(d.url).joinOrCreate('world', { world: 'u/demo', viewer: 'viewer-bbbbbbbb' });
  try {
    assert.deepEqual(await list(), { farm: 2, factory: 0, tennis: 0, 'u/demo': 1 });
    b.send('see', { on: false }); // its tab went out of sight
    assert.ok(await settles(async () => (await list()).farm === 1), 'one that looks away is not counted, as on the chip');
  } finally { await a.leave(); await b.leave(); await c.leave(); }
  assert.ok(await settles(async () => { const l = await list(); return l.farm === 0 && l['u/demo'] === 0; }, 8000), 'gone: back to 0');
});

test("a guest may see which worlds there are (each is a room to watch), never where your folder is or what is wrong with one", async t => {
  const own = Object.values(networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  if (!own) return t.skip('this machine has no network address to visit from');
  const dir = folder(['demo']);
  mkdirSync(join(dir, 'broken'));
  writeFileSync(join(dir, 'broken', 'world.json'), '{ not json');
  const d = await dashboard({ lan: true, userDir: dir });
  const theirs = await (await fetch(`http://${own}:${d.port}/api/worlds`)).json();
  assert.deepEqual(theirs.worlds.map(w => [w.key, w.error]), [['farm', null], ['factory', null], ['tennis', null], ['u/broken', 'It has something wrong with it.'], ['u/demo', null]]);
  assert.equal(theirs.folder, null);
  assert.doesNotMatch(JSON.stringify(theirs), new RegExp(dir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal((await fetch(`${d.url}/api/worlds`)).status, 403, 'on this Mac the token is still asked for');
  const mine = await (await fetch(`${d.url}/api/worlds`, { headers: { 'x-tracker-token': 'tok' } })).json();
  assert.equal(mine.folder, dir);
});
