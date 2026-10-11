// A world the collector moves, from both ends (web/worlds/legacy/engine.js): the collector's (headless: it steps the
// world and says how it stands) and a browser's (it is told, and only shows). A stand-in DOM, frames stepped by hand.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const code = ['scene.js', 'worlds/legacy/pixel.js', 'worlds/legacy/people.js', 'worlds/legacy/props.js', 'worlds/legacy/creatures.js', 'worlds/legacy/animals.js', 'worlds/sdk/grid.js', 'worlds/legacy/engine.js'].map(web).join('\n;\n');
const plain = v => JSON.parse(JSON.stringify(v));

// Every element and canvas context is a proxy that takes any call and answers with another.
function stubDom() {
  const rects = { left: 0, top: 0, width: 400, height: 300, right: 400, bottom: 300 };
  const numbers = new Set(['offsetWidth', 'offsetHeight', 'clientWidth', 'clientHeight', 'scrollLeft', 'scrollTop', 'scrollWidth', 'scrollHeight', 'width', 'height', 'length', 'size']);
  const made = { elements: 0 };
  const make = () => new Proxy(function () {}, {
    get: (t, k) => {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === 'then') return undefined;
      if (numbers.has(k)) return t[k] ?? (k === 'offsetWidth' || k === 'width' ? 400 : k === 'offsetHeight' || k === 'height' ? 300 : 0);
      if (k === 'getBoundingClientRect') return () => rects;
      if (k === 'style' || k === 'dataset') return (t[k] ??= {});
      if (k === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === 'isConnected') return true;
      if (k === 'hidden' || k === 'open') return t[k] ?? false;
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getContext') return () => ctx;
      if (k === 'measureText') return () => ({ width: 0 });
      return (t[k] ??= make());
    },
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => make(),
  });
  const ctx = make();
  const document = Object.assign(make(), { hidden: false, createElement: () => { made.elements++; return make(); } });
  return { make, made, document, globals: { ResizeObserver: class { observe() {} disconnect() {} }, cancelAnimationFrame() {}, setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, Image: class {}, Path2D: class {} } };
}
/** The SDK in a context of its own, with a clock and frames a test moves by hand. */
function load({ dom = true, noon = false } = {}) {
  const d = stubDom(), clock = { ms: 1000 };
  // The world's sky and its animals' sleep follow the wall clock (they sleep from 20:00 to 05:00). With `noon` the clock the
  // world sees runs on as usual but starts at noon, so a test of their daytime life does not depend on the hour it runs at.
  const shift = noon ? new Date().setHours(12, 0, 0, 0) - Date.now() : 0;
  const WorldDate = class extends Date { constructor(...a) { super(...(a.length ? a : [Date.now() + shift])); } static now() { return Date.now() + shift; } };
  let pending = null;
  const window = { Agentville: { raw() {} }, devicePixelRatio: 1 };
  const ctx = vm.createContext(dom
    ? { window, document: d.document, console, Math, Date: WorldDate, JSON, Map, Set, Intl, performance: { now: () => clock.ms }, requestAnimationFrame: cb => { pending = cb; return 1; }, ...d.globals }
    : { window, console, Math, Date: WorldDate, JSON, Map, Set, Intl }); // the collector's side: no document at all
  vm.runInContext(`${code}\n;window.sdk = { withDefaults, engineScene, makePixelView, makeMirror, glide, PXG };`, ctx);
  /** Frames on, 50 ms apart. */
  const run = n => { for (let i = 0; i < n && pending; i++) { const cb = pending; pending = null; clock.ms += 50; cb(clock.ms); } };
  const sceneOf = agents => window.sdk.engineScene(window.AgentvilleScene.toScene({ generatedAt: Date.now(), collisions: [], agents, repos: [{ path: '/c/x', name: 'x' }] }));
  return { window, sdk: window.sdk, d, clock, run, sceneOf };
}
const someone = (id, over = {}) => ({ id, name: id, kind: 'interactive', cwd: '/c/x', state: 'idle', feed: [], children: [], touching: [], ...over });
const PEN = () => [{ x: 10, y: 20, w: 180, h: 80 }];
const GOAT = { kind: 'goat', actions: [{ label: 'Pet', fx: 'hearts' }, { label: 'Feed' }], lines: { idle: ['meh.'] } };
/** A world: its working agents at (60, 90), the rest in a row of two at y 40 (the third and on stand in reserve), a goat in a pen. */
const hooks = (extra = {}) => ({
  W: 200, drawChar() {}, bg() {},
  slots: f => (f.state === 'working' ? { group: 'st:/c/x', at: used => { used.push(0); return [60, 90]; }, zone: 'field' } : { group: 'row', cap: 2, at: i => [100 + 20 * i, 40], extra: k => [110, 30 + k], zone: 'row' }),
  animals: () => [GOAT], roam: PEN, avoid: () => [], ...extra,
});
const prefs = { get: () => null, set() {} };

/* ---------- the mirror: states played back a moment late ---------- */

test('between two states everyone is drawn part of the way; a leap is not glided; the world\'s own things are handed on in order, once', () => {
  const { sdk } = load();
  const shared = [], m = sdk.makeMirror(st => { if (st.w) shared.push(plain(st.w)); }, 0.1);
  assert.equal(m.at(5), null, 'nothing yet');
  assert.equal(m.ready, false);
  m.push({ t: 10, wl: 5_000_000, b: [['a', 50, 40, 60, 40, 1, 'row'], ['gone', 5, 5, 5, 5, 0, 'row']], a: [['goat-0', 20, 30, 0, 'walk', 0, -1]], says: [['goat-0', 'meh.']], taken: [], o: { row: 1 }, sp: 1, j: 0, f: [['a', 'gone', 9.5]], w: { hens: '[1]' } }, 100);
  m.push({ t: 10.05, b: [['a', 52, 40, 60, 40, 1, 'row'], ['new', 9, 9, 9, 9, 0, 'row']], a: [['goat-0', 120, 30, 0, 'stand', 0, -1]], says: [], taken: ['bucket'], o: {}, sp: 0, j: 2, w: { hens: '[2]', carts: '[]' } }, 100.05);
  assert.equal(m.ready, true);
  // the clocks: 90 s apart; shown 0.1 s late
  const early = plain(m.at(100.1));
  assert.equal(early.t, 10);
  assert.deepEqual(early.bodies.map(b => b.slice(0, 3)), [['a', 50, 40], ['gone', 5, 5]], 'the older state, as it was');
  assert.deepEqual(shared, [{ hens: '[1]' }], "its own things: the first state's, now");
  const mid = plain(m.at(100.125));
  assert.ok(Math.abs(mid.t - 10.025) < 1e-9);
  assert.ok(Math.abs(mid.wall - 5_000_025) < 1e-6, "the collector's time of day for that very moment");
  assert.deepEqual(mid.flights, [['a', 'gone', 9.5]], 'and the messages on their way');
  assert.ok(Math.abs(mid.bodies[0][1] - 51) < 1e-9, 'half-way between 50 and 52');
  assert.deepEqual(mid.animals.ones[0].slice(0, 5), ['goat-0', 120, 30, 0, 'walk'], 'a leap of a hundred pixels is taken at its half, not glided; its pose is the older state\'s');
  assert.deepEqual(mid.animals.says, [['goat-0', 'meh.']]);
  const late = plain(m.at(100.5));
  assert.equal(late.t, 10.05, 'no newer state: the newest is held');
  assert.deepEqual(late.bodies.map(b => b[0]), ['a', 'new'], 'who came and who went, as the newer state has it');
  assert.deepEqual([late.over, late.spare, late.jobs, late.animals.taken], [{}, 0, 2, ['bucket']]);
  assert.deepEqual(shared, [{ hens: '[1]' }, { hens: '[2]', carts: '[]' }], 'then the second, once');
  m.at(100.6);
  assert.equal(shared.length, 2);
  const still = plain(m.at(0, true));
  assert.deepEqual(still.bodies[0], ['a', 60, 40, 60, 40, 0, 'row'], 'standing still: everyone where they are going, not walking');
  m.push({ t: 0.05, b: [], a: [] }, 101); // a new room: its clock starts again
  assert.equal(plain(m.at(101.2)).t, 0.05);
});

/* ---------- the collector's side ---------- */

test('the world run headless: no document is touched; it steps, says how it stands, and tells what there is to show', () => {
  const { sdk, sceneOf } = load({ dom: false });
  const shown = [];
  const view = sdk.makePixelView(sdk.withDefaults(hooks()), prefs, { headless: true, onFx: e => shown.push(plain(e)) });
  view.update(sceneOf([someone('w', { state: 'working' }), someone('r1'), someone('r2'), someone('r3'), someone('r4')]));
  const first = plain(view.state());
  assert.deepEqual(first.bodies.map(b => [b[0], b[1], b[2], b[6]]), [['w', 60, 90, 'field'], ['r1', 100, 40, 'row'], ['r2', 120, 40, 'row']]);
  assert.deepEqual([first.over.row, first.spare, first.jobs, first.t], [2, 2, [], 0], 'two over the cap, in reserve');
  assert.equal(first.animals.ones.length, 1);
  for (let i = 0; i < 20; i++) view.step(0.05);
  assert.ok(Math.abs(view.state().t - 1) < 1e-9);
  // three things asked at once: the two of the row go, then one from the reserve steps out
  const asked = [0, 1, 0].map(act => plain(view.ask({ animal: 'goat-0', act, by: 'me' })));
  assert.deepEqual(asked.map(r => [r.ok, r.wait]), [[true, 0], [true, 1], [true, 2]]);
  assert.equal(new Set(asked.map(r => r.doer)).size, 3);
  const called = asked.map(r => r.doer).filter(id => id === 'r3' || id === 'r4'), spare = called[0];
  assert.ok(spare, 'the row has two: at least one of the reserve was called');
  let st = plain(view.state());
  assert.deepEqual(st.bodies.find(b => b[0] === spare).slice(1, 3), [110, spare === 'r3' ? 30 : 31], "it stands where its place's extra() puts it");
  assert.equal(st.bodies.find(b => b[0] === spare)[5] & 4, 4, 'marked away, as all three are');
  assert.equal(st.over.row ?? 0, 2 - called.length, 'and the sign counts one fewer for each');
  let most = 0;
  for (let i = 0; i < 2400 && view.state().jobs.length; i++) { view.step(0.05); most = Math.max(most, view.state().jobs.filter(j => j.phase === 'act').length); }
  st = plain(view.state());
  assert.equal(st.jobs.length, 0, 'all three done');
  assert.equal(most, 1, 'one at a time at the goat');
  assert.deepEqual(shown.map(e => e.fx), ['hearts', 'hearts'], "what there is to show is told (Feed has nothing to show)");
  assert.ok(shown.every(e => e.at.every(Number.isInteger)));
  assert.equal(st.bodies.length, 3, 'the one from the reserve is back in');
  assert.equal(st.over.row, 2);
  assert.deepEqual(plain(view.ask({ animal: 'goat-9', act: 0 })), { ok: false, why: 'gone' });
});

test("a world's own things go out with its state (share), and a busy farmer is asked only when no job is under way", () => {
  const { sdk, sceneOf } = load({ dom: false });
  let n = 0;
  const view = sdk.makePixelView(sdk.withDefaults(hooks({ share: () => ({ carts: [['c', ++n]] }) })), prefs, { headless: true });
  view.update(sceneOf([someone('w', { state: 'working' })]));
  assert.deepEqual(plain(view.state().shared), { carts: [['c', 1]] });
  const a = plain(view.ask({ animal: 'goat-0', act: 0 }));
  assert.ok(a.ok);
  const b = plain(view.ask({ animal: 'goat-0', act: 0 }));
  assert.deepEqual([b.ok, b.doer], [true, null], 'the only farmer is out (or too far to make it in its few seconds): the second is done at once, by you');
});

/* ---------- a browser's side ---------- */

function watcher(extra = {}, options = {}) {
  const l = load({ noon: true }), drawn = [], acts = [], touches = [], diary = [];
  const world = hooks({ drawChar: (f, b) => drawn.push([f.id, Math.round(b.x * 100) / 100, b.y, b.walk, b.face, b.zone]), ...extra });
  const view = l.sdk.makePixelView(l.sdk.withDefaults(world), prefs);
  view.mount(l.d.make(), { still: false, remote: true, onAct: a => acts.push(plain(a)), onTouch: id => touches.push(id), onDiary: list => { diary.length = 0; diary.push(...list.map(e => `${e.who} ${e.text}`.trim())); }, ...options });
  const tell = s => view.remote({ s: { says: [], taken: [], o: {}, sp: 0, j: 0, ...s } });
  const frame = () => { drawn.length = 0; l.run(1); return plain(drawn); };
  return { ...l, view, drawn, acts, touches, diary, tell, frame, kit: view.animalsKit() };
}
const BITS = { walk: 1, hatless: 2, away: 4, up: 8, left: 16, right: 24 };

test('a world the collector moves: nothing is shown moving until it says where everyone is; then they are there, and nothing here moves them', () => {
  const w = watcher();
  w.view.update(w.sceneOf([someone('a', { state: 'working' }), someone('b')]));
  assert.deepEqual(w.frame(), [], 'no one yet: this page places no one itself');
  const now = () => w.clock.ms / 1000;
  w.tell({ t: 50, b: [['a', 60, 90, 60, 90, 0, 'field'], ['b', 100, 40, 140, 40, BITS.walk | BITS.right, 'row']], a: [['goat-0', 30, 50, 0, 'eat', 0, -1]] });
  w.clock.ms += 50;
  w.tell({ t: 50.05, b: [['a', 60, 90, 60, 90, 0, 'field'], ['b', 102, 40, 140, 40, BITS.walk | BITS.right, 'row']], a: [['goat-0', 30, 50, 2, 'stand', 0, -1]] });
  w.clock.ms += 50; // 0.1 s after the first state came: its moment
  let seen = w.frame(); // 0.15 s after: the second's
  assert.deepEqual(seen, [['a', 60, 90, false, 'down', 'field'], ['b', 102, 40, true, 'right', 'row']], 'each where the collector has it, walking as it says');
  assert.deepEqual(plain(w.kit.list()), [{ id: 'goat-0', kind: 'goat', x: 30, y: 50, pose: 'stand', lift: 0, wear: {} }]);
  assert.deepEqual(w.diary, ['2 agents here'], 'who is there when the page opens has not just arrived');
  for (let i = 0; i < 40; i++) seen = w.frame();
  assert.deepEqual(seen, [['a', 60, 90, false, 'down', 'field'], ['b', 102, 40, true, 'right', 'row']], 'with no newer state, they stay: this page walks no one to its place (b would be at 140)');
  // someone new, and a change of zone, are told as ever
  w.view.update(w.sceneOf([someone('a', { state: 'working' }), someone('b'), someone('c')]));
  w.tell({ t: 60, b: [['a', 60, 90, 60, 90, 0, 'field'], ['b', 140, 40, 140, 40, 0, 'porch'], ['c', 100, 0, 100, 40, BITS.walk, 'row']], a: [] });
  w.clock.ms += 200;
  seen = w.frame();
  assert.deepEqual(seen.map(s => s[0]).sort(), ['a', 'b', 'c']);
  assert.deepEqual(w.diary.slice(0, 3), ['c moves', 'c arrives', 'b moves']);
  // one called out of the reserve for a job (away) has not arrived from anywhere
  w.view.update(w.sceneOf([someone('a', { state: 'working' }), someone('b'), someone('c'), someone('d')]));
  w.tell({ t: 70, b: [['d', 110, 30, 110, 30, BITS.away, 'row']], a: [] });
  w.clock.ms += 200;
  seen = w.frame();
  assert.deepEqual(seen.map(s => s[0]), ['d'], 'and who is not in the state is gone from the map');
  assert.ok(!w.diary.some(l => /^d /.test(l)), 'no diary line for it');
  void now;
});

test('what the world itself shares is taken as the collector says it (adopt), again after each scene; its tick is told not to move those things', () => {
  const adopted = [], ticks = [];
  const w = watcher({ adopt: got => adopted.push(plain(got)), tick: (dt, posOf, snap, told) => { ticks.push([snap, told]); } });
  w.view.update(w.sceneOf([someone('a')]));
  w.tell({ t: 5, b: [['a', 100, 40, 100, 40, 0, 'row']], a: [], w: { hens: '[["h1",3]]', carts: 'not json' } });
  w.clock.ms += 150;
  w.frame();
  assert.deepEqual(adopted, [{ hens: [['h1', 3]] }], 'parsed; what is not JSON is left out');
  assert.deepEqual(ticks.at(-1), [false, true], 'told');
  w.view.update(w.sceneOf([someone('a'), someone('b')]));
  assert.deepEqual(adopted.at(-1), { hens: [['h1', 3]] }, 'a scene sets the world going its own way: the collector\'s word is given again');
});

test('with the room lost, this page moves the world itself again, from where everyone stands; with it back, it only shows again', () => {
  const w = watcher();
  w.view.update(w.sceneOf([someone('a', { state: 'working' }), someone('b')]));
  w.tell({ t: 5, b: [['a', 20, 90, 60, 90, BITS.walk, 'field'], ['b', 100, 40, 100, 40, 0, 'row']], a: [['goat-0', 30, 50, 0, 'stand', 0, -1]] });
  w.clock.ms += 200;
  assert.deepEqual(w.frame().find(s => s[0] === 'a').slice(1, 3), [20, 90]);
  w.view.remote({ on: false });
  let seen;
  for (let i = 0; i < 60; i++) seen = w.frame();
  assert.deepEqual(seen.find(s => s[0] === 'a').slice(1, 4), [60, 90, false], 'it walked on to its place by itself');
  assert.deepEqual(seen.find(s => s[0] === 'b').slice(1, 3), [100, 40]);
  const goat = plain(w.kit.list())[0];
  for (let i = 0; i < 400; i++) w.frame();
  assert.notDeepEqual(plain(w.kit.list())[0], goat, 'and the goat lives again');
  w.view.remote({ on: true });
  w.tell({ t: 1, b: [['a', 60, 90, 60, 90, 0, 'field']], a: [['goat-0', 150, 60, 0, 'sleep', 0, -1]] });
  w.clock.ms += 200;
  assert.deepEqual(w.frame().map(s => s[0]), ['a'], 'told again');
  assert.deepEqual(plain(w.kit.list())[0], { id: 'goat-0', kind: 'goat', x: 150, y: 60, pose: 'sleep', lift: 0, wear: {} });
});

test('something to show (hearts) is shown when the collector says so; the answer to what was asked says when it waits in line', () => {
  const w = watcher();
  w.view.update(w.sceneOf([someone('a')]));
  w.tell({ t: 5, b: [['a', 100, 40, 100, 40, 0, 'row']], a: [['goat-0', 30, 50, 0, 'stand', 0, -1]] });
  w.clock.ms += 200;
  w.frame();
  const made = () => w.d.made.elements; // a pop is an element made (and a picture of its text, the first time)
  let before = made();
  w.view.remote({ fx: { fx: 'hearts', at: [30, 50], t: 5.2 } }); // it happened a moment after the state this page draws
  w.frame();
  assert.equal(made(), before, 'held: its moment is not the one drawn yet');
  w.tell({ t: 5.2, b: [['a', 100, 40, 100, 40, 0, 'row']], a: [['goat-0', 30, 50, 0, 'happy', 0, -1]] });
  w.clock.ms += 200;
  w.frame();
  assert.ok(made() > before, 'now a ♥ pops');
  before = made();
  w.view.remote({ fx: { pop: [100, 20, 'Harvest!', 'good'], t: 5.2 } });
  w.frame();
  assert.ok(made() > before, 'a word the collector says pops for everyone');
  before = made();
  w.view.remote({ re: { rid: 'r', animal: 'goat-0', ok: true, doer: 'a', wait: 2 } });
  assert.ok(made() > before, 'waiting behind two: it says so (this one is yours alone, at once)');
  before = made();
  w.view.remote({ re: { rid: 'r', animal: 'goat-0', ok: true, doer: 'a', wait: 0 } });
  w.view.remote({ fx: { fx: 'hearts', t: 5.2 } });
  w.view.remote({ fx: { fx: 'hearts', at: [1, 2] } });
  w.view.remote({ fx: { pop: ['x'], t: 5.2 } });
  w.view.remote({ fx: null });
  w.frame();
  assert.equal(made(), before, 'nothing for an answer with no wait, or for what is written wrong');
});

test('motion off, a watcher shows everyone where they are going, at once', () => {
  const w = watcher({}, { still: true });
  w.view.update(w.sceneOf([someone('a', { state: 'working' })]));
  w.drawn.length = 0;
  w.tell({ t: 5, b: [['a', 20, 90, 60, 90, BITS.walk, 'field']], a: [['goat-0', 30, 50, 0, 'walk', 0, -1]] });
  assert.deepEqual(plain(w.drawn.at(-1)), ['a', 60, 90, false, 'down', 'field'], 'drawn as the state comes: no frames run');
  assert.equal(plain(w.kit.list())[0].pose, 'sleep', 'the animals rest, as ever with motion off');
});

/* ---------- what is only for show is the same for everyone: the clock, the particles, messages on their way ---------- */

/** A watcher of a world that scatters sparks at each agent and dust over the land, drawing from Math.random as worlds do. */
function sparky(framesPerState) {
  const made = [], flown = [];
  const w = watcher({
    emit: (f, b, dt, add) => { if (Math.random() < 0.7) { const p = { x: b.x + Math.random() * 10, y: b.y - Math.random() * 4, vx: 0, vy: -3, life: 1, max: 1, size: 1, color: '#fff' }; made.push([f.id, +p.x.toFixed(6), +p.y.toFixed(6)]); add(p); } },
    ambient: (dt, add) => { const p = { x: Math.random() * 200, y: 0, vx: 0, vy: 9, life: 2, max: 2, size: 1, color: '#eee' }; made.push(['', +p.x.toFixed(6)]); add(p); },
    flight: (a, z, t, T) => flown.push([a.id, z.id, +t.toFixed(3), +T.toFixed(3)]),
  });
  w.view.update(w.sceneOf([someone('a', { state: 'working' }), someone('b')]));
  for (let k = 0; k < 12; k++) {
    w.tell({ t: 20 + k * 0.05, wl: 7_000_000 + k * 50, b: [['a', 60 + k, 90, 80, 90, BITS.walk, 'field'], ['b', 100, 40, 100, 40, 0, 'row']], a: [], f: k >= 4 ? [['a', 'b', 20.2]] : [] });
    w.clock.ms += 50 - framesPerState * 0; // states come 50 ms apart
    for (let i = 0; i < framesPerState; i++) w.frame(); // (each frame moves this page's clock on 50 ms: a slow page sees fewer states a frame)
  }
  for (let i = 0; i < 8; i++) w.frame();
  return { w, made, flown };
}

test('dust, sparks and snow are the same in every browser: scattered on the beat of the states, from a seed, however fast a page draws', () => {
  const quick = sparky(1), slow = sparky(3);
  assert.ok(quick.made.length > 12, 'it scattered some');
  assert.deepEqual(slow.made, quick.made, 'a page that draws a third as often has the very same particles');
  assert.ok(quick.made.some(p => p[0] === 'a') && quick.made.some(p => p[0] === 'b') && quick.made.some(p => p[0] === ''), 'from each agent and from the land');
  const xs = quick.made.filter(p => p[0] === 'a').map(p => p[1]);
  assert.ok(xs.every((x, i) => i === 0 || x !== xs[i - 1]), 'a new draw each beat, not the same one again');
  assert.ok(xs.every(x => x >= 60 && x < 82), 'at the agent, where each state has it (not where a frame happened to glide it)');
  const real = [Math.random(), Math.random(), Math.random()];
  assert.ok(new Set(real).size === 3, 'and Math.random is its own again afterwards');
});

test("the collector's time of day is every browser's (PXG.now), a moment late as all it shows; a message on its way flies for everyone", () => {
  const { w, flown } = sparky(1);
  const now = w.sdk.PXG.now();
  assert.ok(now >= 7_000_000 && now <= 7_000_000 + 11 * 50, `by the state drawn, not this machine's clock (${now})`);
  assert.ok(Math.abs(now - (7_000_000 + (w.sdk.PXG.T - 20) * 1000)) < 1e-6, 'for the very moment the world is drawn at');
  assert.ok(flown.length > 2 && flown.every(f => f[0] === 'a' && f[1] === 'b'), 'the message flies, from the state alone (this page was sent no mail)');
  assert.ok(flown.every(f => Math.abs(f[2] - (f[3] - 20.2) / 2.4) < 0.002), 'as far along as the world\'s clock says');
  w.view.remote({ on: false });
  assert.equal(w.sdk.PXG.wall, null, "moving its world itself again, it goes by this machine's clock");
});

test('headless, what would pop up or fly is told instead: a word with its place, a message until it lands', () => {
  const { sdk, sceneOf } = load({ dom: false });
  const told = [];
  const view = sdk.makePixelView(sdk.withDefaults(hooks({ onMove: (f, zone, was, pop) => { if (zone === 'field') pop('To work!', 'good'); } })), prefs, { headless: true, onFx: e => told.push(plain(e)) });
  const at = Date.now() - 1000;
  const mail = from => [{ kind: 'peer', dir: 'out', other: 'b', at, text: 'never sent on' }].filter(() => from);
  view.update(sceneOf([someone('a', { feed: mail(false) }), someone('b')]));
  view.step(0.05);
  view.update(sceneOf([someone('a', { state: 'working', feed: mail(true) }), someone('b')]));
  assert.deepEqual(told.map(e => e.pop?.slice(2)), [['To work!', 'good']], 'a word that pops, for everyone');
  assert.ok(told[0].pop.slice(0, 2).every(Number.isInteger));
  let st = plain(view.state());
  assert.deepEqual(st.flights.map(f => f.slice(0, 2)), [['a', 'b']], 'the message on its way is in the state');
  assert.ok(Math.abs(st.wall - Date.now()) < 2000, 'with the time of day');
  told.length = 0;
  for (let i = 0; i < 60; i++) view.step(0.05);
  st = plain(view.state());
  assert.deepEqual(st.flights, [], 'it has landed');
  assert.deepEqual(told.filter(e => e.pop).map(e => e.pop[2]), ['✉'], 'and a ✉ pops where it did');
  assert.doesNotMatch(JSON.stringify([st, told]), /never sent on/, 'what it said is nowhere in what goes out');
});
