// What is asked of the animals (web/worlds/legacy/animals.js, makeJobs): who goes, in what order, how many at once,
// and what a watcher's kit is told of the animals (state, adopt). A little world of its own stands in for the
// engine: farmers walk straight to wherever their job sends them, at a farmer's pace.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
function load() {
  const window = { Agentville: {} };
  const sandbox = { window, console, Math, Date, JSON, Map, Set, __ctx: { fillRect() {}, set fillStyle(_) {} } };
  vm.createContext(sandbox);
  vm.runInContext(`${['worlds/sdk/ui/pixel-text.js', 'worlds/sdk/ui/pixel-hud.js', 'worlds/legacy/pixel.js', 'worlds/legacy/creatures.js', 'worlds/legacy/animals.js'].map(web).join('\n;\n')}\n;PXG.ctx = __ctx; window.kit = { makeAnimals, seededRandom, makeJobs };`, sandbox);
  return window.kit;
}
const plain = v => JSON.parse(JSON.stringify(v));

/**
 * Farmers f0…f(n-1) in a row at y 10, 20 apart, each at home; animals where `animals` has them. step(s) moves time on
 * in twentieths of a second: the jobs tick, then every farmer walks 40 px/s towards where its job sends it (or home).
 */
function yard(n, animals, options = {}) {
  const { makeJobs } = load(), jobs = makeJobs(options);
  const farmers = new Map(Array.from({ length: n }, (_, i) => [`f${i}`, { x: 300 + 20 * i, y: 10, home: [300 + 20 * i, 10], state: 'stale' }]));
  const done = [], spots = [];
  const waitSpot = k => [200 - 10 * k, 30];
  const env = {
    at: id => farmers.get(id) ?? null,
    state: id => farmers.get(id)?.state,
    stand: (animal, rank) => (animals[animal] ? [animals[animal][0] - 10 - 9 * rank, animals[animal][1]] : null),
    home: id => { const f = farmers.get(id); return Math.hypot(f.x - f.home[0], f.y - f.home[1]) < 1; },
    perform: (j, went) => done.push(`${j.animal}:${j.act}:${went ? j.doer : 'you'}`),
  };
  let now = 0;
  function step(seconds = 0.05) {
    for (let t = 0; t < seconds - 1e-9; t += 0.05) {
      now += 0.05;
      jobs.tick(now, env);
      for (const [id, f] of farmers) {
        const [tx, ty] = jobs.target(id, waitSpot)?.at ?? f.home, d = Math.hypot(tx - f.x, ty - f.y), sp = 40 * 0.05;
        if (d <= sp) { f.x = tx; f.y = ty; } else { f.x += ((tx - f.x) / d) * sp; f.y += ((ty - f.y) / d) * sp; }
      }
    }
  }
  const ask = (animal, act, doer) => jobs.add({ animal, act, doer, now });
  const phases = () => jobs.all().map(j => `${j.doer}:${j.phase}${j.held ? '*' : ''}`).join(' ');
  return { jobs, farmers, done, spots, step, ask, phases, now: () => now, waitSpot };
}

test('one job: its farmer sets off at once, does it at the animal, stays a moment, walks back, and the job is over', () => {
  const y = yard(1, { cow: [300, 100] });
  y.ask('cow', 1, 'f0');
  y.step();
  assert.equal(y.phases(), 'f0:go');
  assert.deepEqual(plain(y.jobs.target('f0').at), [290, 100], 'beside the animal');
  y.step(3);
  assert.deepEqual(y.done, ['cow:1:f0'], 'done there, by it');
  assert.equal(y.phases(), 'f0:act');
  y.step(1.5);
  assert.equal(y.phases(), 'f0:back');
  assert.equal(y.jobs.target('f0').at, null, 'back to its own place');
  y.step(4);
  assert.equal(y.jobs.size(), 0);
  assert.deepEqual(y.done, ['cow:1:f0'], 'once');
});

test('several asked at once set off one after another, a little apart, so none walks inside another', () => {
  const y = yard(3, { cow: [300, 100], pig: [100, 100] }, { gap: 1.2 });
  y.ask('cow', 0, 'f0'); y.ask('pig', 0, 'f1'); y.ask('cow', 1, 'f2');
  y.step();
  assert.equal(y.phases(), 'f0:go f1:wait f2:wait', 'the first at once');
  assert.equal(y.jobs.target('f1').at, null, 'one whose turn is a moment off waits where it stands');
  y.step(1.1);
  assert.equal(y.phases(), 'f0:go f1:wait f2:wait');
  y.step(0.15);
  assert.equal(y.phases(), 'f0:go f1:go f2:wait', '1.2 s on, the second');
  y.step(1.2);
  assert.match(y.phases(), /f2:go/, 'then the third');
  const [a, b] = [y.farmers.get('f0'), y.farmers.get('f1')];
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 8, 'they are not on top of one another');
});

test('at most five are out at once: a sixth waits at the waiting place, in line, and sets off when one is back', () => {
  const animals = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`a${i}`, [40 + 30 * i, 120]]));
  const y = yard(8, animals, { outMax: 5, gap: 0.5 });
  for (let i = 0; i < 8; i++) y.ask(`a${i}`, 0, `f${i}`);
  y.step(2.8);
  assert.equal(y.jobs.all().filter(j => j.phase !== 'wait').length, 5, 'five out');
  assert.equal(y.phases().match(/wait\*/g).length, 3, 'three held');
  assert.deepEqual([5, 6, 7].map(i => plain(y.jobs.target(`f${i}`, y.waitSpot).at)), [[200, 30], [190, 30], [180, 30]], 'at the waiting place, one behind the other, in the order asked');
  let most = 0;
  for (let t = 0; t < 60 && y.jobs.size(); t += 0.25) { y.step(0.25); most = Math.max(most, y.jobs.all().filter(j => j.phase !== 'wait').length); }
  assert.equal(most, 5, 'never more than five');
  assert.equal(y.jobs.size(), 0, 'and all of it gets done');
  assert.deepEqual(y.done.map(d => d.split(':')[0]), ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'].filter(a => y.done.some(d => d.startsWith(a))), 'each once');
  assert.equal(y.done.length, 8);
  assert.ok(y.done.every(d => !d.endsWith('you')), 'each by its farmer');
});

test('at an animal they stand in line: the first does its action, the next steps up when it has gone, in the order asked', () => {
  const y = yard(3, { cow: [300, 100] }, { gap: 0.3 });
  y.ask('cow', 0, 'f0'); y.ask('cow', 1, 'f1'); y.ask('cow', 2, 'f2');
  y.step(1);
  assert.deepEqual(['f0', 'f1', 'f2'].map(id => plain(y.jobs.target(id).at)), [[290, 100], [281, 100], [272, 100]], 'beside it, then one behind the other');
  const order = [], acting = [];
  for (let t = 0; t < 30 && y.jobs.size(); t += 0.05) {
    y.step();
    acting.push(y.jobs.all().filter(j => j.phase === 'act').length);
    if (y.done.length > order.length) order.push(y.done.at(-1));
  }
  assert.deepEqual(order, ['cow:0:f0', 'cow:1:f1', 'cow:2:f2'], 'in the order asked');
  assert.equal(Math.max(...acting), 1, 'never two at it at once');
});

test('a farmer that starts waiting on you drops its job: what was not done yet is done by you, once; one that already did it is just let go', () => {
  const y = yard(2, { cow: [300, 100] }, { gap: 0.2 });
  y.ask('cow', 0, 'f0'); y.ask('cow', 1, 'f1');
  y.step(0.5);
  y.farmers.get('f1').state = 'waiting';
  y.step();
  assert.deepEqual(y.done, ['cow:1:you'], 'on its way: you do it');
  assert.equal(y.phases(), 'f0:go');
  y.step(3);
  assert.deepEqual(y.done, ['cow:1:you', 'cow:0:f0']);
  y.farmers.get('f0').state = 'turn';
  y.step();
  assert.equal(y.jobs.size(), 0);
  assert.deepEqual(y.done, ['cow:1:you', 'cow:0:f0'], 'nothing is done twice');
});

test('one that gets work while it waits its turn goes back to it (you do the action); on its way already, it has five seconds more', () => {
  const y = yard(2, { cow: [300, 400] }, { gap: 0.2 });
  y.ask('cow', 0, 'f0'); y.ask('cow', 1, 'f1');
  y.step(0.1);
  y.farmers.get('f1').state = 'working'; // still waiting to set off
  y.step();
  assert.deepEqual(y.done, ['cow:1:you']);
  y.farmers.get('f0').state = 'working'; // on its way, far from the animal
  y.step(4.9);
  assert.equal(y.phases(), 'f0:go');
  y.step(0.3);
  assert.equal(y.phases(), 'f0:back', 'it never got there');
  assert.deepEqual(y.done, ['cow:1:you', 'cow:0:you']);
});

test('an animal that wandered on meanwhile is gone after, twice at most; then the action is done from where the farmer stands', () => {
  const animals = { cow: [300, 100] }, y = yard(1, animals);
  y.ask('cow', 0, 'f0');
  y.step(2);
  animals.cow = [200, 100]; // it walks off while the farmer is on its way
  y.step(0.5);
  assert.deepEqual(plain(y.jobs.target('f0').at), [190, 100], 'after it');
  assert.deepEqual(y.done, []);
  y.step(2);
  animals.cow = [100, 100];
  y.step(0.5);
  assert.deepEqual(plain(y.jobs.target('f0').at), [90, 100], 'and once more');
  y.step(2);
  animals.cow = [20, 100];
  y.step(0.5);
  assert.deepEqual(y.done, ['cow:0:f0'], 'the third time it does it from there');
});

test('an animal someone has come for is asked to stay; the line behind follows it when it has moved on', () => {
  const animals = { cow: [300, 100] }, y = yard(3, animals, { gap: 0.2 });
  const held = [];
  const tick = y.jobs.tick.bind(y.jobs);
  y.jobs.tick = (now, env) => tick(now, { ...env, hold: animal => held.push(animal) });
  y.ask('cow', 0, 'f0'); y.ask('cow', 1, 'f1'); y.ask('cow', 2, 'f2');
  y.step(1);
  assert.deepEqual(held, [], 'no one is there yet: it goes where it likes');
  animals.cow = [200, 100]; // and it does
  y.step(1.6);
  assert.deepEqual(['f0', 'f1', 'f2'].map(id => plain(y.jobs.target(id).at)), [[190, 100], [181, 100], [172, 100]], 'the first came where it had been and goes after it; the line behind follows');
  assert.ok(held.length > 0 && held.every(a => a === 'cow'), 'and now it is asked to stay');
  for (let t = 0; t < 30 && y.jobs.size(); t += 0.05) y.step();
  assert.deepEqual(y.done, ['cow:0:f0', 'cow:1:f1', 'cow:2:f2']);
});

test('with motion switched off every job ends where it is: what was not done is done by you', () => {
  const y = yard(2, { cow: [300, 100] });
  y.ask('cow', 0, 'f0'); y.ask('cow', 1, 'f1');
  y.step(0.1);
  y.jobs.finish({ perform: (j, went) => y.done.push(`${j.animal}:${j.act}:${went ? j.doer : 'you'}`) });
  assert.deepEqual(y.done, ['cow:0:you', 'cow:1:you']);
  assert.equal(y.jobs.size(), 0);
});

/* ---------- what a watcher's kit is told ---------- */

const CAST = [
  { kind: 'cow', count: 2, actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Ride', pose: 'run', run: true }], lines: { idle: ['MOO.'], petted: ['moo ♥'] } },
  { kind: 'goat', actions: [{ label: 'Pet' }, { label: 'Feed' }], lines: { idle: ['meh.'] } },
];
const YARD = { x: 0, y: 100, w: 200, h: 100 };

test("a kit told another's state shows the same animals: where they are, their pose, what they wear, what they say", () => {
  const { makeAnimals, seededRandom } = load();
  const moved = makeAnimals(CAST, { random: seededRandom(3) }), shown = makeAnimals(CAST, { random: seededRandom(99) });
  for (const k of [moved, shown]) k.place({ roam: [YARD], avoid: [] });
  for (let i = 0; i < 400; i++) moved.tick(0.05, { winter: true });
  moved.perform('cow-0', 0, null); // it says its line
  const st = plain(moved.state());
  assert.equal(st.ones.length, 3);
  shown.adopt(st, 20);
  const seen = k => plain(k.list()).map(o => [o.id, o.x, o.y, o.pose, o.wear]);
  assert.deepEqual(seen(shown), seen(moved));
  assert.equal(plain(shown.list()).find(o => o.kind === 'goat').wear.scarf, true, 'the goat wears its scarf: it is winter where the animals are moved');
  assert.deepEqual(plain(shown.bubbles()).map(b => [b.id, b.text]), plain(moved.bubbles()).map(b => [b.id, b.text]));
  assert.deepEqual(plain(shown.bubbles()).map(b => b.text), ['moo ♥']);
});

test("the season a watcher's page shows dresses the animals it is told of: a scarf in winter held, none in summer", () => {
  const { makeAnimals, seededRandom } = load();
  const moved = makeAnimals(CAST, { random: seededRandom(3) }), shown = makeAnimals(CAST, { random: seededRandom(4) });
  for (const k of [moved, shown]) k.place({ roam: [YARD], avoid: [] });
  moved.tick(0.05, { winter: false });
  shown.adopt(plain(moved.state()), 1, { winter: true });
  assert.equal(plain(shown.list()).find(o => o.kind === 'goat').wear.scarf, true);
  shown.adopt(plain(moved.state()), 1, { winter: false });
  assert.equal(plain(shown.list()).find(o => o.kind === 'goat').wear.scarf, undefined);
});

test("a helper's line has the world's own beside it: what a guest reads in its place", () => {
  const { makeAnimals, seededRandom } = load();
  const kit = makeAnimals(CAST, { random: seededRandom(3) });
  kit.place({ roam: [YARD], avoid: [] });
  kit.chatter([{ kind: 'cow', when: 'idle', text: 'the cart tests are red again' }, { kind: 'goat', when: 'idle', text: 'someone merged on a friday' }]);
  for (let i = 0; i < 4000 && !kit.state().says.length; i++) kit.tick(0.05, {});
  const [[id, text, plainLine]] = plain(kit.state().says);
  assert.match(text, /cart tests|merged on a friday/, "the helper's line is said");
  assert.equal(plainLine, id.startsWith('cow') ? 'MOO.' : 'meh.', "with the world's own line for that moment beside it");
  for (let i = 0; i < 200; i++) kit.tick(0.05, {});
  kit.perform('cow-0', 0, null);
  const own = plain(kit.state().says).find(s => s[1] === 'moo ♥');
  assert.equal(own[2], null, "the world's own line has none beside it: everyone reads it");
});

test('after being told, a kit goes on by itself from where everyone stands', () => {
  const { makeAnimals, seededRandom } = load();
  const moved = makeAnimals(CAST, { random: seededRandom(3) }), shown = makeAnimals(CAST, { random: seededRandom(4) });
  for (const k of [moved, shown]) k.place({ roam: [YARD], avoid: [] });
  for (let i = 0; i < 100; i++) moved.tick(0.05, {});
  shown.adopt(plain(moved.state()), 5);
  shown.resume();
  const before = plain(shown.list());
  assert.deepEqual(before.map(o => [o.x, o.y]), plain(moved.list()).map(o => [o.x, o.y]), 'from there');
  for (let i = 0; i < 600; i++) shown.tick(0.05, {});
  assert.notDeepEqual(plain(shown.list()).map(o => [o.x, o.y]), before.map(o => [o.x, o.y]), 'it lives again');
  assert.ok(plain(shown.list()).every(o => o.x >= YARD.x && o.x <= YARD.x + YARD.w && o.y >= YARD.y && o.y <= YARD.y + YARD.h), 'in its yard');
});
