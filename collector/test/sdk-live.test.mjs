// A world of api 2, moved by the collector for everyone who watches (collector/live.mjs, live-world.mjs): the
// SDK's simulation and the world's sim.js inside QuickJS, in a thread of its own, and the room every browser
// joins. Built-in worlds and yours run the same way; yours gets numbers for names.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import { createTrackerServer } from '../server.mjs';
import { CORE, PLUGINS, loadSimShutIn, syntaxProblem } from '../live-world.mjs';
import { makeWorlds } from '../worlds.mjs';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (ok, ms = 5000) => { for (let t = 0; t < ms; t += 25) { if (ok()) return true; await sleep(25); } return ok(); };
const core = CORE.map(f => [f, readFileSync(`${WEB}worlds/sdk/core/${f}`, 'utf8')]), plugins = readFileSync(WEB + PLUGINS, 'utf8');
const TINY = JSON.stringify({ api: 2, name: 'Tiny', places: { wait: { spots: [[4, 4], [5, 4]] }, idle: { spots: [[20, 4]] } }, plots: { at: [[10, 20]] }, spawn: [0, 0] });
const shutIn = (sim = null, over = {}) => loadSimShutIn({ core, plugins, manifest: TINY, sim, ...over });
const agent = (id, state, over = {}) => ({ id, name: id, state, repo: null, ...over });
const sceneJson = (agents, repos = []) => JSON.stringify({ agents, repos, mail: [] });

/* ---------- the simulation, shut in ---------- */

test('shut in, a world is moved as anywhere: scenes in as text, states out in the room\'s measure', async () => {
  const w = await shutIn();
  try {
    assert.equal(w.scene(sceneJson([agent('a', 'working', { repo: '/r' }), agent('b', 'waiting')], [{ key: '/r', bed: 0 }])), null);
    const st = w.step(0);
    assert.deepEqual(st.bodies, [['a', 80, 160, 80, 160, 0, 'plot:0'], ['b', 32, 32, 32, 32, 0, 'wait']], 'each as [id, x, y, tx, ty, bits, zone], metres times eight');
    assert.deepEqual([st.t, st.animals, st.jobs, st.spare, st.fx, st.said], [0, null, [], 0, [], []]);
    w.scene(sceneJson([agent('a', 'working', { repo: '/r' }), agent('b', 'waiting'), agent('c', 'waiting')], [{ key: '/r', bed: 0 }]));
    const later = w.step(20);
    assert.ok(Math.abs(later.t - 1) < 1e-9, 'twenty steps are a second');
    const c = later.bodies.find(b => b[0] === 'c');
    assert.equal(c[5], 1, 'the newcomer walks in from the spawn');
    assert.ok(Math.abs(Math.hypot(c[1], c[2]) / 8 - 1.6) < 1e-6, 'at its world\'s pace');
    assert.deepEqual(w.ask({ animal: 'cat-0', act: 0 }), { ok: false, why: 'gone' }, 'a world of api 2 has no animals to ask');
    assert.equal(w.touch('cat-0'), false);
  } finally { w.stop(); }
});

test("a world's sim.js runs with it: its rules place, its tick moves, what it shares goes out, what it writes to its console is handed on", async () => {
  const w = await shutIn(`Agentville.sim({
    place: (ctx, a) => (a.id === 'b' ? 'idle' : undefined),
    tick(ctx, dt) { this.n = (this.n ?? 0) + 1; if (this.n === 1) console.warn('first tick at ' + ctx.time.toFixed(2)); },
    share(ctx) { return { n: this.n ?? 0, here: ctx.scene.agents.length }; },
  });`);
  try {
    w.scene(sceneJson([agent('a', 'waiting'), agent('b', 'waiting')]));
    const st = w.step(3);
    assert.deepEqual(st.bodies.map(b => b[6]), ['wait', 'idle']);
    assert.deepEqual(st.shared, { n: 3, here: 2 });
    assert.deepEqual(st.said, ['first tick at 0.05']);
  } finally { w.stop(); }
});

test('inside there is nothing but the language: no document, no fetch, no timers, no files, no import of anything else', async () => {
  const w = await shutIn(`Agentville.sim({ share: () => ({ has: ['document', 'fetch', 'setTimeout', 'XMLHttpRequest', 'WebSocket', 'require', 'process', 'Deno', 'Worker', 'performance'].filter(k => typeof globalThis[k] !== 'undefined') }) });`);
  try {
    w.scene(sceneJson([]));
    assert.deepEqual(w.step(1).shared, { has: [] });
  } finally { w.stop(); }
  const reader = await shutIn("let got = 'nothing'; import('core/sim.js').then(() => { got = 'the SDK'; }, () => { got = 'refused'; }); import('node:fs').then(() => { got = 'node:fs'; }, () => {}); Agentville.sim({ share: () => ({ got }) });");
  try {
    reader.scene(sceneJson([]));
    assert.notEqual(reader.step(1).shared.got, 'node:fs', "the collector's own modules are out of reach");
  } finally { reader.stop(); }
});

test('a sim.js that throws as it loads, registers nonsense, or never returns is refused or cut off, with what and where', async () => {
  await assert.rejects(shutIn("const a = 1;\nthrow new Error('no courts here');"), /no courts here \(at .*sim\.js:2/);
  await assert.rejects(shutIn('Agentville.sim(5);'), /takes an object of hooks/);
  await assert.rejects(shutIn('Agentville.sim({}); Agentville.sim({});'), /sim\.js registered twice/);
  await assert.rejects(shutIn('while (true) {}', { loadMs: 200 }), /it did not answer/);
  await assert.rejects(loadSimShutIn({ core, plugins, manifest: '{ "api": 2, "name": "x" }', sim: null }), /"places" is missing/);
  const hangs = await shutIn('Agentville.sim({ tick() { while (true) {} } });', { callMs: 200 });
  try {
    hangs.scene(sceneJson([agent('a', 'idle')]));
    assert.throws(() => hangs.step(1), /it did not answer/, 'a step that never ends is cut off');
  } finally { hangs.stop(); }
  const throws = await shutIn("Agentville.sim({ place(ctx, a) {\n  throw new Error('lost ' + a.id);\n} });");
  try { assert.throws(() => throws.scene(sceneJson([agent('a', 'idle')])), /lost a \(at place \(sim\.js:2/); } finally { throws.stop(); }
});

test('a script is read for its syntax without being run', async () => {
  assert.equal(await syntaxProblem('Agentville.view({ setup(ctx) { document.title = ctx.world.name; } }); while (false) {}', 'view.js'), null);
  assert.match(await syntaxProblem('Agentville.view({\n  setup(ctx) {\n});', 'view.js'), /view\.js:3/);
});

/* ---------- the room ---------- */

const servers = [], temps = [];
const agentOf = (id, state, over = {}) => ({ id, kind: 'interactive', name: id, cwd: '/p/shop', state, stateSince: 5, startedAt: 1, lastReply: `${id} says the cart is fixed`, feed: [{ at: 2, kind: 'tool', tool: 'Edit', step: 'edit', summary: 'src/cart.ts' }], children: [], touching: [], docs: [], ...over });
const snapshot = () => ({ generatedAt: Date.now(), counts: {}, collisions: [], repos: [{ path: '/p/shop', name: 'shop', bed: 4 }], agents: [agentOf('w1', 'working'), agentOf('w2', 'working'), agentOf('q1', 'waiting'), agentOf('i1', 'idle')] });
async function dashboard({ userDir = null, lan = false } = {}) {
  const logged = [];
  const worlds = makeWorlds({ builtinDir: `${WEB}worlds`, userDir });
  const none = async () => ({ status: 404, error: 'none' });
  const srv = createTrackerServer({ port: 0, token: 'tok', webFile: `${WEB}index.html`, lan, log: m => logged.push(String(m)), worlds, getSnapshot: snapshot, getFeed: () => [], getConversation: async () => ({ total: 0, from: 0, items: [] }), actions: {}, readFile: none, listFiles: none, repoTouched: none });
  const port = await srv.listen();
  servers.push(srv);
  return { srv, port, logged, url: `http://127.0.0.1:${port}` };
}
after(async () => { for (const s of servers) await s.close(); for (const t of temps) rmSync(t, { recursive: true, force: true }); });
const post = (port, path, body) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'POST', headers: { 'content-type': 'application/json' } }, res => { let text = ''; res.on('data', c => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, body: text })); });
  req.on('error', reject);
  req.end(JSON.stringify(body));
});
/** A folder of your worlds: the starter under each name, with the sim.js given (null: none). */
function folder(worlds) {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-sdk-live-'));
  temps.push(dir);
  for (const [name, sim] of Object.entries(worlds)) {
    cpSync(`${WEB}worlds/starter`, join(dir, name), { recursive: true });
    if (sim === null) rmSync(join(dir, name, 'sim.js')); else if (sim !== undefined) writeFileSync(join(dir, name, 'sim.js'), sim);
  }
  return dir;
}
const metres = s => [...s.bodies.entries()].map(([id, v]) => [id, v.x / 64, v.y / 64, v.zone]).sort(); // positions come in eighths of the room's measure, which is eighths of a metre

test('a built-in world of api 2 is moved here without being named anywhere: a thread of its own, one room, the same world for this computer and a guest', async () => {
  const d = await dashboard();
  const a = await new Client(d.url).joinOrCreate('world', { world: 'tennis', token: 'tok' }), b = await new Client(d.url).joinOrCreate('world', { world: 'tennis' });
  let sim = null;
  try {
    assert.equal(a.roomId, b.roomId);
    const room = matchMaker.getLocalRoomById(a.roomId);
    sim = room.sim;
    assert.ok(sim.thread > 0 && sim.alive(), 'in a thread of its own, as a world of yours is');
    let sa = null, sb = null;
    a.onStateChange(s => { sa = s; });
    b.onStateChange(s => { sb = s; });
    assert.ok(await until(() => sa?.bodies.size === 4 && sb?.bodies.size === 4 && sa.t > 0.2), d.logged.join(' | '));
    assert.ok(await until(() => JSON.stringify(metres(sa)) === JSON.stringify(metres(sb))), 'everyone watching is told the same');
    const where = Object.fromEntries(metres(sa).map(([id, x, z, zone]) => [id, [x, z, zone]]));
    const court = JSON.parse(readFileSync(`${WEB}worlds/tennis/world.json`, 'utf8')).plots;
    const [cx, cz] = court.grid.origin;
    assert.ok(Math.abs(where.w1[0] - (cx + (23.77*.8/2/5.415))) <= .4 && Math.abs(where.w1[1] - (cz + 4.3*(23.77*.8/2/5.415))) <= .4 && where.w1[2] === 'tennis:0', `the nine-court world compacts collector bed 4 into its first visible slot, to 1/64 m (${where.w1})`);
    assert.deepEqual(where.w2.slice(2), ['wait'], 'an independent working agent waits at reception instead of inflating the idle terrace');
    assert.deepEqual([where.q1[2], where.i1[2]], ['wait', 'idle']);
    assert.deepEqual([sa.animals.size, sa.jobs, sa.names], [0, 0, '[]'], 'no animals, and no stand-ins: it is not a world of yours');
  } finally { await a.leave(); await b.leave(); }
  assert.ok(await until(() => !sim.alive()), 'no one watches: its thread is gone');
});

test('a world of yours of api 2 is moved the same way, and given numbers for names', async () => {
  const d = await dashboard({ userDir: folder({ club: "Agentville.sim({ share: ctx => ({ names: ctx.scene.agents.map(a => a.name), repos: ctx.scene.repos.map(r => r.key + ':' + r.name), isPrivate: ctx.scene.private }) });" }) });
  const a = await new Client(d.url).joinOrCreate('world', { world: 'u/club', token: 'tok' });
  try {
    let sa = null;
    a.onStateChange(s => { sa = s; });
    assert.ok(await until(() => sa?.bodies.size === 4 && sa.shared.size === 3), d.logged.join(' | '));
    assert.deepEqual(JSON.parse(sa.shared.get('names')), ['agent 1', 'agent 2', 'agent 3', 'agent 4']);
    assert.deepEqual(JSON.parse(sa.shared.get('repos')), ['r1:repo 1']);
    assert.equal(JSON.parse(sa.shared.get('isPrivate')), true);
    assert.ok(JSON.parse(sa.names).some(([what, standIn]) => what === 'r:/p/shop' && standIn === 'r1'), "the room hands every page the collector's stand-ins");
    assert.doesNotMatch(JSON.stringify([...sa.shared.entries()]), /shop|w1|cart/, 'nothing it could share holds a name or a word');
  } finally { await a.leave(); }
});

test('the starter moves its ball here, for everyone alike; a world with no sim.js is moved by the SDK alone', async () => {
  const d = await dashboard({ userDir: folder({ plain: null, ball: undefined }) });
  const a = await new Client(d.url).joinOrCreate('world', { world: 'u/ball', token: 'tok' }), b = await new Client(d.url).joinOrCreate('world', { world: 'u/plain', token: 'tok' });
  try {
    let sa = null, sb = null;
    a.onStateChange(s => { sa = s; });
    b.onStateChange(s => { sb = s; });
    assert.ok(await until(() => sa?.shared.has('ball') && sb?.bodies.size === 4), d.logged.join(' | '));
    const first = Number(sa.shared.get('ball'));
    assert.ok(await until(() => Number(sa.shared.get('ball')) > first), 'the ball rolls on');
    assert.equal(sb.shared.size, 0, 'no sim.js: nothing of its own to share');
    assert.notEqual(a.roomId, b.roomId, 'a room for each world');
  } finally { await a.leave(); await b.leave(); }
});

test('a world whose sim.js does not load gets no room: its browsers move it themselves; a world that is not there gets none either', async () => {
  const d = await dashboard({ userDir: folder({ broken: "throw new Error('no net');" }) });
  const r = await post(d.port, '/matchmake/joinOrCreate/world', { world: 'u/broken', token: 'tok' });
  assert.equal(r.status, 400, r.body);
  assert.match(r.body, /no net/);
  assert.ok(d.logged.some(l => /no seat in the u\/broken: .*no net/.test(l)), d.logged.join(' | '));
  assert.equal((await post(d.port, '/matchmake/joinOrCreate/world', { world: 'u/nowhere' })).status, 404);
  assert.equal((await post(d.port, '/matchmake/joinOrCreate/world', { world: 'legacy-starter' })).status, 404, 'a built-in world of the pixel engine that is not on the list of those moved here');
  assert.equal((await post(d.port, '/matchmake/joinOrCreate/world', { world: 'sdk' })).status, 404);
});
