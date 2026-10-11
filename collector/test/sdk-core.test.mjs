// The SDK's simulation core (web/worlds/sdk/core/): the manifest reader, the ground plan and its paths, who
// stands where and how they walk, what happens between two scenes, and the state on its way to the browsers.
// Renderer-free code, so it runs here as it runs on the collector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bedsOf, eventsOf } from '../../web/worlds/sdk/core/events.js';
import { makeLayout } from '../../web/worlds/sdk/core/layout.js';
import { ASSET, checkManifest, readManifest, unknownFields } from '../../web/worlds/sdk/core/manifest.js';
import { glide, makeMirror } from '../../web/worlds/sdk/core/mirror.js';
import { defaultPlace, makeSim } from '../../web/worlds/sdk/core/sim.js';
import { STEP_NAMES, STEPS, stepOf } from '../../web/worlds/sdk/core/steps.js';
import { cutMid, hashOf, seededRandom } from '../../web/worlds/sdk/core/util.js';
import { fromWire, popFromWire, toWire } from '../../web/worlds/sdk/core/wire.js';

const web = f => readFileSync(fileURLToPath(new URL(`../../web/${f}`, import.meta.url)), 'utf8');
const PLACES = { wait: { row: { from: [4, 4], step: [1, 0], count: 3 } }, idle: { spots: [[20, 4], [21, 4]] } };
const tiny = (over = {}) => ({ api: 2, name: 'Tiny', places: PLACES, ...over });
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const agent = (id, state, over = {}) => ({ id, name: id, state, repo: null, compactions: 0, ...over });
const sceneOf = (agents, repos = [], over = {}) => ({ agents, repos, mail: [], ...over });

/* ---------- world.json ---------- */

test('a world.json with nothing but its two places reads, with every default filled in', () => {
  const w = readManifest(tiny());
  assert.deepEqual(w.ground, { w: 48, d: 32, color: '#5d9b46' });
  assert.deepEqual(w.camera, { view: 'iso', yaw: 45, pitch: 35 });
  assert.deepEqual(w.nouns, { agent: 'agent', agents: 'agents', repo: 'repo', repos: 'repos', place: 'world', start: 'start', diary: 'Diary' });
  assert.deepEqual(w.places.wait.spots, [[4, 4], [5, 4], [6, 4]], 'a row, laid out');
  assert.equal(w.plots, null);
  assert.equal(w.speed, 1.6);
  assert.deepEqual(w.figure, { model: null, height: 1.7, tint: '', hand: '', clips: { idle: 'idle', walk: 'walk', work: 'work', wait: 'wait', sleep: 'sleep' } });
  assert.deepEqual(Object.keys(w.steps), STEP_NAMES, 'every step has its glyph and verb');
  assert.deepEqual(w.steps.test, { glyph: STEPS.test.glyph, verb: STEPS.test.verb, model: null });
  assert.deepEqual(w.assets, []);
  assert.equal(checkManifest(tiny()), null);
});

test('places are laid out as given: spots, a row, a grid or a ring, exactly one of them', () => {
  const w = readManifest(tiny({ places: { ...PLACES, grid: { grid: { from: [0, 0], step: [2, 3], cols: 2, count: 5 } }, ring: { ring: { center: [10, 10], radius: 2, count: 4 }, face: { to: [10, 10] }, name: 'Fire' } } }));
  assert.deepEqual(w.places.grid.spots, [[0, 0], [2, 0], [0, 3], [2, 3], [0, 6]]);
  assert.equal(w.places.ring.spots.length, 4);
  close(w.places.ring.spots[0][1], 12);
  assert.deepEqual(w.places.ring.face, { to: [10, 10] });
  assert.equal(w.places.ring.name, 'Fire');
  assert.match(checkManifest(tiny({ places: { ...PLACES, both: { spots: [[1, 1]], row: { from: [0, 0], step: [1, 0], count: 2 } } } })), /"places\.both" has exactly one of/);
  assert.match(checkManifest(tiny({ places: { wait: PLACES.wait } })), /"places\.idle" is missing/);
  assert.match(checkManifest({ api: 2, name: 'x' }), /"places" is missing/);
  assert.match(checkManifest(tiny({ places: { ...PLACES, 'Bad Name': { spots: [[1, 1]] } } })), /named in lowercase letters/);
});

test('plots: given one by one or as a grid, eighteen at most (the collector gives no more beds)', () => {
  const grid = readManifest(tiny({ plots: { grid: { origin: [10, 10], step: [6, 5], cols: 3 }, max: 5 } })).plots;
  assert.deepEqual(grid.at, [[10, 10], [16, 10], [22, 10], [10, 15], [16, 15]]);
  assert.deepEqual(grid.size, [8, 6]);
  assert.equal(readManifest(tiny({ plots: { grid: { origin: [0, 0], step: [1, 1] } } })).plots.at.length, 18);
  assert.deepEqual(readManifest(tiny({ plots: { at: [[1, 2], [3, 4]], work: [[0, 0]], label: [0, 1] } })).plots.at, [[1, 2], [3, 4]]);
  assert.match(checkManifest(tiny({ plots: {} })), /"plots" has "at".*or "grid"/);
  assert.match(checkManifest(tiny({ plots: { at: [[1, 2]], grid: { origin: [0, 0], step: [1, 1] } } })), /one of the two/);
  assert.match(checkManifest(tiny({ plots: { at: [[1, 2]], max: 19 } })), /"plots\.max" is a number from 1 to 18/);
});

test('what is wrong is said in one sentence that names the field', () => {
  const bad = [
    [{ ground: { size: [4, 400] } }, /"ground\.size" is \[width, depth\] in metres, each from 8 to 400/],
    [{ ground: { color: 'green' } }, /"ground\.color" is a colour like/],
    [{ camera: { view: 'fisheye' } }, /"camera\.view" is one of iso, tilt, top, orbit/],
    [{ camera: { pitch: 5 } }, /"camera\.pitch" is a number from 10 to 90/],
    [{ speed: 0 }, /"speed" is a number from 0\.2 to 10/],
    [{ spawn: [1] }, /"spawn" is a point on the ground/],
    [{ spawn: [1, 9999] }, /"spawn" is a point/],
    [{ paths: [[[0, 0]]] }, /"paths\[0\]" is a list of 2 to 64 points/],
    [{ scenery: [{ shape: 'pyramid', size: [1, 1, 1] }] }, /"scenery\[0\]\.shape" is one of box, cylinder, cone, sphere, plane/],
    [{ scenery: [{ shape: 'box', size: [1, 1] }] }, /"scenery\[0\]\.size" is \[width, height, depth\]/],
    [{ scenery: [{ shape: 'plane', size: [1, 1, 1] }] }, /"scenery\[0\]\.size" is \[width, depth\]/],
    [{ scenery: [{ shape: 'box', size: [1, 1, 1], model: 'assets/a.glb' }] }, /exactly one of "shape", "model" or "use"/],
    [{ scenery: [{ shape: 'box', size: [1, 1, 1], at: [0, 0], each: [[1, 1]] }] }, /"at" or "each", not both/],
    [{ scenery: [{ shape: 'box', size: [1, 1, 1], opens: 'vault' }] }, /"scenery\[0\]\.opens" is one of session, board, repos, help/],
    [{ scenery: [{ shape: 'box', size: [1, 1, 1], shows: 'deploy' }] }, /"scenery\[0\]\.shows" is for what stands on a plot/],
    [{ scenery: [{ use: 'tree' }] }, /"scenery\[0\]\.use" names one of the prefabs: there are none/],
    [{ scenery: [{ model: '../secret.glb' }] }, /names a file in the world's assets folder/],
    [{ scenery: [{ model: 'assets/tree.png' }] }, /\(a \.glb model\)/],
    [{ prefabs: { tree: [] } }, /"prefabs\.tree" has at least one part/],
    [{ prefabs: { tree: [{ use: 'tree' }] } }, /part of a prefab: it can't use another/],
    [{ figure: { height: 9 } }, /"figure\.height" is a number from 0\.5 to 4/],
    [{ steps: { dance: {} } }, /"steps\.dance" is not a step/],
    [{ steps: { test: { glyph: '' } } }, /"steps\.test\.glyph" is an emoji/],
    [{ help: 'x'.repeat(601) }, /"help" is text of up to 600 characters/],
    [{ scenery: [{ shape: 'box', size: [1, 1, 1], each: Array.from({ length: 400 }, () => [0, 0]) }, ...Array.from({ length: 10 }, () => ({ shape: 'box', size: [1, 1, 1], each: Array.from({ length: 400 }, () => [0, 0]) }))] }, /more than 4000 things/],
  ];
  for (const [over, why] of bad) assert.match(checkManifest(tiny(over)) ?? 'it read', why, JSON.stringify(over).slice(0, 80));
  for (const j of [null, [], 'x', 5]) assert.match(checkManifest(j), /not a JSON object/);
  // a prefab's parts count as many times as they stand, wherever the prefab is used
  const forest = { prefabs: { wood: [{ shape: 'box', size: [1, 1, 1], each: Array.from({ length: 400 }, (_, i) => [i % 20, 0]) }] }, scenery: [{ use: 'wood', each: Array.from({ length: 11 }, (_, i) => [i, 0]) }] };
  assert.match(checkManifest(tiny(forest)), /more than 4000 things/);
  assert.equal(checkManifest(tiny({ ...forest, scenery: [{ use: 'wood', each: [[0, 0], [1, 1]] }] })), null);
  // spots laid out by a rule lie within reach as those written down do
  assert.match(checkManifest(tiny({ places: { ...PLACES, far: { row: { from: [0, 0], step: [100, 0], count: 8 } } } })), /"places\.far" has spots more than 450 m/);
  assert.match(checkManifest(tiny({ plots: { grid: { origin: [0, 0], step: [200, 200] } } })), /"plots\.grid" has plots more than 450 m/);
  assert.match(checkManifest({ ...tiny(), api: 1 }), /this reader is for "api": 2/);
  assert.match(checkManifest(tiny({ paths: Array.from({ length: 5 }, () => Array.from({ length: 64 }, (_, i) => [i, i])) })), /"paths" has up to 256 points in all/);
});

test('scenery: shapes, models and prefabs, each with where it stands; every model named is listed as an asset', () => {
  const w = readManifest(tiny({
    prefabs: { tree: [{ shape: 'cylinder', size: [1, 2, 1], color: '#6B4320' }, { model: 'assets/crown.glb', y: 2 }] },
    scenery: [{ use: 'tree', each: [[1, 1], [2, 2]], turn: 90, opens: 'board', tip: 'A tree' }, { shape: 'plane', size: [3, 2], at: [5, 5], glow: true, opacity: 0.5 }, { model: 'assets/hut.glb', scale: 2 }],
    plots: { at: [[10, 10]], scenery: [{ shape: 'box', size: [1, 1, 1], shows: 'deploy' }] },
    figure: { model: 'assets/person.glb' }, steps: { test: { model: 'assets/tube.glb', verb: 'testing samples' } },
  }));
  assert.deepEqual(w.assets, ['assets/crown.glb', 'assets/hut.glb', 'assets/person.glb', 'assets/tube.glb']);
  assert.deepEqual(w.prefabs.tree[0], { at: [[0, 0]], y: 0, turn: 0, glow: false, opens: null, tip: '', shows: null, kind: 'shape', shape: 'cylinder', size: [1, 2, 1], color: '#6b4320', opacity: 1 });
  assert.equal(w.scenery[0].kind, 'use');
  close(w.scenery[0].turn, Math.PI / 2);
  assert.deepEqual([w.scenery[0].opens, w.scenery[0].tip, w.scenery[0].at.length], ['board', 'A tree', 2]);
  assert.deepEqual(w.scenery[1].size, [3, 0, 2], 'a flat shape has no height');
  assert.equal(w.scenery[2].scale, 2);
  assert.equal(w.plots.scenery[0].shows, 'deploy');
  assert.equal(w.steps.test.verb, 'testing samples');
  assert.equal(w.steps.test.glyph, STEPS.test.glyph, 'what a world leaves out of a step stays the kit\'s');
});

test('an asset is a file in the assets folder, never a way out of it; the page checks requests with the same rule', () => {
  for (const ok of ['assets/tree.glb', 'assets/a/b-c_d.v2.png', 'assets/x.JPG'.toLowerCase(), 'assets/p.webp', 'assets/p.jpeg']) assert.ok(ASSET.test(ok), ok);
  for (const bad of ['tree.glb', 'assets/../x.glb', 'assets/.hidden.glb', 'assets//x.glb', '/assets/x.glb', 'assets/x.js', 'assets/x.glb/', 'assets/x', 'assets\\x.glb', 'assets/x.glb?y', 'assets/a b.glb']) assert.ok(!ASSET.test(bad), bad);
  assert.ok(web('worlds.js').includes(`const ASSET = ${ASSET};`), "web/worlds.js's copy (it can import nothing)");
});

test('fields this version does not read are named: a typo, most often', () => {
  assert.deepEqual(unknownFields({ ...tiny(), placs: {}, senery: [] }), ['placs', 'senery']);
  assert.deepEqual(unknownFields(tiny({ icon: '🌱', description: 'x', author: 'me', help: 'h' })), []);
});

/* ---------- the ground plan ---------- */

test('the way those standing somewhere look: a direction, a point, or nothing said', () => {
  const l = makeLayout(readManifest(tiny({ places: { wait: { ...PLACES.wait, face: [1, 0] }, idle: { ...PLACES.idle, face: { to: [20, 0] } } }, plots: { at: [[10, 20], [30, 20]], work: [[-2, 0], [2, 0]], face: { to: [0, 0] } } })));
  close(l.heading('wait', 4, 4), Math.PI / 2);
  close(l.heading('idle', 20, 4), Math.PI, 1e-9);
  close(l.heading('plot:1', 28, 20), Math.PI / 2, 1e-9);
  close(l.heading('plot:1', 32, 20), -Math.PI / 2, 1e-9);
  assert.equal(makeLayout(readManifest(tiny())).heading('wait', 4, 4), null, 'the world does not say');
  assert.equal(l.heading('nowhere', 0, 0), null);
  assert.deepEqual(l.spot('plot:1', 1), { x: 32, z: 20 });
  assert.deepEqual(l.spot('plot:1', 3), { x: 32, z: 21.2 }, 'past the last work spot: the same spots, a step nearer');
  assert.equal(l.spot('plot:7', 0), null);
  assert.equal(l.plotAt(null), null);
  assert.deepEqual(l.spawn, [4, 4], "no spawn given: the wait place's first spot");
});

test('a walk goes along the paths where there are any: on at the nearest point, the shortest way, off again', () => {
  const l = makeLayout(readManifest(tiny({ paths: [[[0, 10], [40, 10]], [[20, 10], [20, 30]]] })));
  assert.deepEqual(l.route([5, 5], [22, 28]), [[5, 10], [20, 10], [20, 28], [22, 28]], 'the second path starts in the middle of the first: they join there');
  assert.deepEqual(l.route([5, 5], [6, 6]), [[6, 6]], 'a few steps: straight there');
  assert.deepEqual(l.route([5, 5], [35, 6]), [[5, 10], [20, 10], [35, 10], [35, 6]], 'along the first path, past where the second joins it');
  assert.deepEqual(makeLayout(readManifest(tiny())).route([0, 0], [30, 30]), [[30, 30]], 'no paths: straight there');
  const cross = makeLayout(readManifest(tiny({ paths: [[[0, 10], [40, 10]], [[20, 0], [20, 30]]] })));
  assert.deepEqual(cross.route([2, 12], [22, 28]), [[2, 10], [20, 10], [20, 28], [22, 28]], 'two paths that cross meet where they cross');
  const apart = makeLayout(readManifest(tiny({ paths: [[[0, 10], [10, 10]], [[30, 10], [40, 10]]] })));
  assert.deepEqual(apart.route([1, 12], [39, 12]), [[39, 12]], 'paths that do not meet: straight there');
  const far = makeLayout(readManifest(tiny({ paths: [[[0, 100], [40, 100]]] })));
  assert.deepEqual(far.route([0, 0], [10, 0]), [[10, 0]], 'a path farther off than the place itself is not gone to');
  const round = makeLayout(readManifest(tiny({ paths: [[[0, 0], [0, 40], [6, 40], [6, 0]]] })));
  assert.deepEqual(round.route([0.5, 1], [5.5, 1]), [[5.5, 1]], 'nor a way by the paths that is many times the straight one');
  assert.equal(round.route([0.5, 1], [5.5, 39]).length, 5, 'the same paths, where they are the way');
});

/* ---------- who stands where ---------- */

test('by its state an agent goes to its plot, to wait, or to idle; the optional places take their states when a world has them', () => {
  const p = { wait: {}, idle: {} }, more = { ...p, turn: {}, stale: {}, work: {} };
  assert.equal(defaultPlace(agent('a', 'working'), p, true), 'plot');
  assert.equal(defaultPlace(agent('a', 'working'), p, false), 'idle');
  assert.equal(defaultPlace(agent('a', 'working'), more, false), 'work');
  assert.deepEqual(['waiting', 'turn', 'idle', 'stale'].map(s => defaultPlace(agent('a', s), p, true)), ['wait', 'wait', 'idle', 'idle']);
  assert.deepEqual(['turn', 'stale'].map(s => defaultPlace(agent('a', s), more, true)), ['turn', 'stale']);
  assert.equal(defaultPlace(agent('a', 'turn', { nap: true }), more, true), 'idle', 'napping: it rests');
});

test('everyone has a spot when the world opens; later comers walk in from the spawn', () => {
  const sim = makeSim(readManifest(tiny({ spawn: [0, 0], plots: { at: [[10, 20]], work: [[0, 0], [2, 0]] } })), {}, { now: () => 5000 });
  sim.scene(sceneOf([agent('a', 'working', { repo: '/r' }), agent('b', 'waiting'), agent('c', 'idle')], [{ key: '/r', bed: 0 }]));
  let st = sim.state();
  assert.deepEqual(st.bodies, [
    { id: 'a', x: 10, z: 20, tx: 10, tz: 20, walk: false, zone: 'plot:0' },
    { id: 'b', x: 4, z: 4, tx: 4, tz: 4, walk: false, zone: 'wait' },
    { id: 'c', x: 20, z: 4, tx: 20, tz: 4, walk: false, zone: 'idle' },
  ]);
  assert.equal(st.wall, 5000);
  sim.scene(sceneOf([agent('a', 'working', { repo: '/r' }), agent('b', 'waiting'), agent('c', 'idle'), agent('d', 'waiting')], [{ key: '/r', bed: 0 }]));
  st = sim.state();
  assert.deepEqual(st.bodies.at(-1), { id: 'd', x: 0, z: 0, tx: 5, tz: 4, walk: false, zone: 'wait' }, 'at the spawn, on its way to the next free spot');
  sim.step(1);
  const d = sim.state().bodies.at(-1);
  close(Math.hypot(d.x, d.z), 1.6);
  assert.equal(d.walk, true);
  for (let i = 0; i < 100; i++) sim.step(0.05);
  assert.deepEqual(sim.state().bodies.at(-1), { id: 'd', x: 5, z: 4, tx: 5, tz: 4, walk: false, zone: 'wait' }, 'arrived, and standing');
});

test('a spot is kept while its agent stays; one that frees is taken by the next to come; past the last, they are counted', () => {
  const sim = makeSim(readManifest(tiny()));
  const waiting = ids => sceneOf(ids.map(id => agent(id, 'waiting')));
  sim.scene(waiting(['a', 'b', 'c', 'd', 'e']));
  let st = sim.state();
  assert.deepEqual(st.bodies.map(b => [b.id, b.tx]), [['a', 4], ['b', 5], ['c', 6]]);
  assert.deepEqual(st.over, { wait: 2 }, 'three spots: two more are counted, not shown');
  sim.scene(waiting(['b', 'c', 'd', 'e']));
  st = sim.state();
  assert.deepEqual(st.bodies.map(b => [b.id, b.tx]), [['b', 5], ['c', 6], ['d', 4]], 'b and c keep their spots; d takes the one a left');
  assert.deepEqual(st.over, { wait: 1 });
  sim.scene(waiting([]));
  assert.deepEqual(sim.state().bodies, []);
});

test('a repo without a bed from the collector gets the first free one, and keeps it while it stays', () => {
  const kept = new Map();
  assert.deepEqual([...bedsOf([{ key: 'a' }, { key: 'b', bed: 0 }, { key: 'c' }], kept)], [['b', 0], ['a', 1], ['c', 2]]);
  assert.deepEqual([...bedsOf([{ key: 'c' }, { key: 'd' }], kept)], [['c', 2], ['d', 0]], 'c stays where it was; d takes a free bed');
  assert.deepEqual([...bedsOf([{ key: 'c', bed: 5 }], kept)], [['c', 5]], "the collector's word wins");
});

test("a world's own rules: where an agent belongs, what moves by itself, what it shares, what it pops up", () => {
  const ticks = [];
  const sim = makeSim(readManifest(tiny({ places: { ...PLACES, lab: { spots: [[30, 30]] } }, plots: { at: [[10, 20]] } })), {
    place(ctx, a) { return a.id === 'lab' ? 'lab' : a.id === 'gone' ? null : a.id === 'free' ? { at: [7, 8], zone: 'pond' } : a.id === 'plot' ? { plot: '/r' } : a.id === 'odd' ? 'no such place' : undefined; },
    tick(ctx, dt) { ticks.push([dt, ctx.time, ctx.scene.agents.length, Boolean(ctx.body('lab'))]); return false; },
    share: ctx => ({ n: ctx.scene.agents.length, plot: ctx.plotOf('/r') }),
    scene: () => [{ text: 'Hello', at: [1, 2], cls: 'good' }, { text: 'At lab', agent: 'lab' }, 'junk', { text: 'nowhere' }],
  });
  sim.scene(sceneOf(['lab', 'gone', 'free', 'plot', 'odd'].map(id => agent(id, 'idle')), [{ key: '/r', bed: 0 }]));
  const st = sim.state();
  assert.deepEqual(st.bodies.map(b => [b.id, b.x, b.z, b.zone]), [['lab', 30, 30, 'lab'], ['free', 7, 8, 'pond'], ['plot', 10, 20, 'plot:0'], ['odd', 20, 4, 'idle']], "an answer that names no place is the world's default");
  assert.deepEqual(st.shared, { n: 5, plot: { bed: 0, x: 10, z: 20 } });
  assert.deepEqual(st.fx, [{ pop: [1, 2, 'Hello', 'good'] }, { pop: [30, 30, 'At lab', ''] }]);
  assert.deepEqual(sim.state().fx, [], 'handed out once');
  sim.step(0.5);
  assert.deepEqual(ticks, [[0.5, 0.5, 5, true]]);
});

test("tick may say that its agents' places changed: they are placed afresh", () => {
  let where = 'wait';
  const sim = makeSim(readManifest(tiny()), { place: () => where, tick: () => true });
  sim.scene(sceneOf([agent('a', 'idle')]));
  where = 'idle';
  sim.step(0.05);
  assert.deepEqual([sim.state().bodies[0].tx, sim.state().bodies[0].zone], [20, 'idle']);
});

test('motion off: everyone is where they are going, at once', () => {
  const sim = makeSim(readManifest(tiny({ spawn: [0, 0] })));
  sim.scene(sceneOf([agent('a', 'idle')]));
  sim.scene(sceneOf([agent('a', 'idle'), agent('b', 'idle')]));
  sim.scene(sceneOf([agent('a', 'idle'), agent('b', 'idle')], [], { mail: [{ from: 'a', to: 'b', at: 1, text: 'x' }] }));
  sim.settle();
  const st = sim.state();
  assert.deepEqual(st.bodies[1], { id: 'b', x: 21, z: 4, tx: 21, tz: 4, walk: false, zone: 'idle' });
  assert.deepEqual(st.flights, [], 'and no message is left in the air, to fly when motion comes on again');
});

/* ---------- what happens between two scenes ---------- */

test('between two scenes: arrivals, changes of state, compactions, merges, deploys that end, messages', () => {
  const repo = (over = {}) => ({ key: '/r', name: 'shop', deploy: null, prs: { open: [], merged: [] }, ...over });
  const prev = sceneOf([agent('a', 'working'), agent('b', 'idle', { compactions: 1 })], [repo({ deploy: { state: 'running' } })]);
  const next = sceneOf([agent('a', 'waiting'), agent('b', 'idle', { compactions: 2 }), agent('c', 'working')], [repo({ deploy: { state: 'failed' }, prs: { open: [], merged: [{ number: 12 }] } })], { mail: [{ from: 'a', to: 'b', at: 9, text: 'done' }] });
  assert.deepEqual(eventsOf(prev, next).map(e => [e.kind, e.agent ?? e.repo ?? `${e.from}>${e.to}`, e.text, Boolean(e.pop)]), [
    ['state', 'a', 'waits for you', false], ['compacted', 'b', 'Compacted', true], ['arrive', 'c', 'arrives', false],
    ['merged', '/r', 'Merged #12', true], ['deployFailed', '/r', 'Deploy failed', true], ['mail', 'a>b', 'done', false],
  ]);
  assert.deepEqual(eventsOf(next, next), [], 'nothing new, nothing told');
  assert.deepEqual(eventsOf(null, next).map(e => e.kind), ['mail'], 'as a world opens only the messages on their way are news');
  assert.deepEqual(eventsOf(prev, sceneOf(prev.agents, [repo({ deploy: { state: 'ok' } })])).map(e => [e.kind, e.cls]), [['deployOk', 'good']]);
});

test('the simulation pops up what happened where it happened, and carries a message from one agent to another', () => {
  const sim = makeSim(readManifest(tiny({ plots: { at: [[10, 20]] } })));
  const a = over => agent('a', 'working', { repo: '/r', ...over }), b = agent('b', 'waiting');
  sim.scene(sceneOf([a(), b], [{ key: '/r', bed: 0, prs: { merged: [] } }]));
  assert.deepEqual(sim.state().fx, []);
  sim.scene(sceneOf([a({ compactions: 1 }), b], [{ key: '/r', bed: 0, prs: { merged: [{ number: 7 }] } }], { mail: [{ from: 'a', to: 'b', at: 1, text: 'x' }] }));
  let st = sim.state();
  assert.deepEqual(st.fx, [{ pop: [10, 20, 'Compacted', 'good'] }, { pop: [10, 20, 'Merged #7', 'good'] }], 'state changes and arrivals are for the diary, not popped');
  assert.deepEqual(st.flights, [['a', 'b', 0]]);
  for (let i = 0; i < 47; i++) sim.step(0.05);
  assert.equal(sim.state().flights.length, 1, 'still on its way after 2.35 s');
  sim.step(0.1);
  st = sim.state();
  assert.deepEqual(st.flights, []);
  assert.deepEqual(st.fx, [{ pop: [4, 4, '✉', 'good'] }], 'it lands at the receiver');
});

/* ---------- to the browsers and back ---------- */

test("the room's measure: metres times eight out, and back; a state survives the trip", () => {
  const state = { t: 3, wall: 99, bodies: [{ id: 'a', x: 1.25, z: 2.5, tx: 10, tz: 20.125, walk: true, zone: 'plot:3' }], flights: [['a', 'b', 1]], over: { wait: 2 }, shared: { n: 1 }, fx: [{ pop: [1.5, 2, 'Hi', 'good'] }] };
  const wire = toWire(state);
  assert.deepEqual(wire, { t: 3, wall: 99, flights: [['a', 'b', 1]], bodies: [['a', 10, 20, 80, 161, 1, 'plot:3']], animals: null, over: { wait: 2 }, spare: 0, jobs: [], shared: { n: 1 }, fx: [{ pop: [12, 16, 'Hi', 'good'] }] });
  // as web/live.js hands it on: b, f, o, wl, and w (what changed of the shared, as JSON)
  const back = fromWire({ t: 3, wl: 99, b: wire.bodies, a: [], f: wire.flights, o: wire.over, w: { n: '1' } });
  assert.deepEqual(back, { t: 3, wall: 99, bodies: [state.bodies[0]], flights: [['a', 'b', 1]], over: { wait: 2 }, w: { n: '1' }, wk: null });
  assert.deepEqual(fromWire({ t: 1, wk: ['n'] }), { t: 1, wall: null, bodies: [], flights: [], over: {}, w: null, wk: ['n'] }, 'a state that says little, and which keys the world still shares');
  assert.deepEqual(popFromWire({ pop: [12, 16, 'Hi', 'good'], t: 3 }), { t: 3, x: 1.5, z: 2, text: 'Hi', cls: 'good' });
  for (const junk of [null, {}, { fx: 'hearts', at: [1, 2], t: 1 }, { pop: [1, 2, 'x'], t: 1 }, { pop: [1, 2, 'x', ''] }]) assert.equal(popFromWire(junk), null);
});

test('states are played back a moment late: between two, everyone glides; a leap is not glided; with motion off, everyone where they go', () => {
  const reached = [], m = makeMirror(st => reached.push(st.t), 0.1);
  assert.equal(m.at(5), null);
  const body = (x, over = {}) => ({ id: 'a', x, z: 0, tx: 9, tz: 0, walk: true, zone: 'wait', ...over });
  m.push({ t: 10, wall: 1000, bodies: [body(1)], flights: [], over: {} }, 100);
  m.push({ t: 10.05, wall: 1050, bodies: [body(1.08)], flights: [], over: { wait: 1 } }, 100.05);
  assert.equal(m.ready, true);
  assert.deepEqual([m.at(100.1).t, m.at(100.1).bodies[0].x, m.at(100.1).wall], [10, 1, 1000]);
  const mid = m.at(100.125);
  close(mid.t, 10.025);
  close(mid.bodies[0].x, 1.04);
  close(mid.wall, 1025);
  assert.deepEqual(reached, [10], 'each state reached once, as its moment comes');
  assert.deepEqual(m.at(100.3).over, { wait: 1 });
  assert.deepEqual(reached, [10, 10.05]);
  assert.deepEqual(m.at(0, true).bodies[0], body(9, { walk: false }), 'still');
  assert.deepEqual(glide(0, 0, 5, 0, 0.4), [0, 0], 'a leap: where it was until the half');
  assert.deepEqual(glide(0, 0, 5, 0, 0.6), [5, 0]);
  m.push({ t: 2, wall: 0, bodies: [], flights: [], over: {} }, 101); // its clock went back: a new room
  assert.deepEqual(m.at(101.2).bodies, []);
  // the same moment told again (someone joined the room): the newer word, and nothing of the world's own things lost
  const got = [], again = makeMirror(st => got.push([st.t, st.w ?? null, st.wk ?? null]), 0.1);
  again.push({ t: 5, wall: 0, bodies: [body(1)], flights: [], over: {}, w: { ball: '1' } }, 50);
  again.push({ t: 5, wall: 0, bodies: [body(2)], flights: [], over: {}, w: { cup: '2' }, wk: ['ball', 'cup'] }, 50.01);
  assert.equal(again.at(50.2).bodies[0].x, 2);
  assert.deepEqual(got, [[5, { ball: '1', cup: '2' }, ['ball', 'cup']]], 'reached once, with both');
  again.push({ t: 5, wall: 0, bodies: [body(3)], flights: [], over: {}, w: { ball: '9' } }, 50.3);
  assert.deepEqual([again.at(50.5).bodies[0].x, got.at(-1)], [3, [5, { ball: '9' }, null]], 'told again after its moment has come: taken at once');
});

/* ---------- the small things ---------- */

test('steps: the collector\'s step, an older tool by its name, plan mode while it works, nothing between steps', () => {
  assert.equal(stepOf({ state: 'working', step: 'test', tool: 'Bash' }), 'test');
  assert.equal(stepOf({ state: 'working', tool: 'Grep' }), 'search');
  assert.equal(stepOf({ state: 'working', tool: 'mcp__x__y' }), 'other');
  assert.equal(stepOf({ state: 'working', step: 'juggle', tool: 'Bash' }), 'shell', 'a step this version does not know');
  assert.equal(stepOf({ state: 'working', mode: 'plan', step: 'edit' }), 'planMode');
  assert.equal(stepOf({ state: 'turn', mode: 'plan' }), null);
  assert.equal(stepOf({ state: 'working' }), null);
  for (const s of Object.values(STEPS)) assert.ok(s.glyph && s.verb);
});

test('text and numbers: a name cut in the middle, the same numbers from the same seed', () => {
  assert.equal(cutMid('inventory_management', 16), 'inventor…agement');
  assert.equal(cutMid('short', 16), 'short');
  assert.equal(hashOf('a'), hashOf('a'));
  assert.notEqual(hashOf('a'), hashOf('b'));
  const r1 = seededRandom(7), r2 = seededRandom(7);
  assert.deepEqual([r1(), r1(), r1()], [r2(), r2(), r2()]);
});
