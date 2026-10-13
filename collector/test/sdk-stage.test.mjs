// What a world of api 2 is drawn from (web/worlds/sdk/stage/ and ui/), as far as it goes without a graphics
// card: the scenery as three.js objects, the figures and their moves, the models read from a .glb, the
// camera's fit, and the HTML laid over the world. What only a browser can show (the frame, WebGL, the
// page's part in loading a model) is in scripts/e2e-ui.mjs.
import { test } from 'node:test';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { readManifest } from '../../web/worlds/sdk/core/manifest.js';
import { makeAssets } from '../../web/worlds/sdk/stage/assets.js';
import { makeCamera, ZOOMS } from '../../web/worlds/sdk/stage/camera.js';
import { makeFigures, MOVES, moveOf } from '../../web/worlds/sdk/stage/figures.js';
import { flatten, makeScenery, shown } from '../../web/worlds/sdk/stage/scenery.js';
import { helpHtml } from '../../web/worlds/sdk/ui/dialogs.js';
import { hudHtml } from '../../web/worlds/sdk/ui/hud.js';
import { glyphOf, plotLabel } from '../../web/worlds/sdk/ui/overlay.js';
import { glb, turn } from '../../scripts/lib/glb.mjs';

const PLACES = { wait: { spots: [[4, 4]] }, idle: { spots: [[20, 4]] } };
const world = (over = {}) => readManifest({ api: 2, name: 'T', places: PLACES, ...over });
const asset = name => { const b = readFileSync(fileURLToPath(new URL(`../../web/worlds/tennis/assets/${name}`, import.meta.url))); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);
const settled = () => new Promise(r => setTimeout(r, 30));

/* ---------- scenery ---------- */

test('scenery is taken apart into single things: a prefab turned and scaled as a whole, each part where it then stands', () => {
  const w = world({
    prefabs: { post: [{ shape: 'box', size: [1, 2, 1], at: [1, 0], color: '#111111' }, { model: 'assets/top.glb', y: 2, scale: 3 }] },
    scenery: [{ use: 'post', at: [10, 10], turn: 90, scale: 2, opens: 'board', tip: 'Board' }, { shape: 'plane', size: [4, 2], each: [[0, 0], [5, 5]], color: '#222222', glow: true }],
  });
  const leaves = flatten(w.scenery, w.prefabs);
  assert.equal(leaves.length, 4);
  const [box, model, p1, p2] = leaves;
  assert.deepEqual([box.kind, box.shape, box.size, box.color], ['shape', 'box', [2, 4, 2], '#111111']);
  close(box.x, 10); close(box.z, 8); // a quarter turn takes the part from the prefab's +x to its −z, twice as far
  close(box.turn, Math.PI / 2);
  assert.deepEqual(box.meta, { opens: 'board', tip: 'Board' }, 'what the prefab opens, each of its parts opens');
  assert.deepEqual([model.kind, model.model, model.y, model.scale], ['model', 'assets/top.glb', 4, 6]);
  assert.deepEqual([p1.x, p1.z, p2.x, p2.z, p1.glow, p1.meta], [0, 0, 5, 5, true, null]);
  assert.deepEqual(flatten([w.scenery[1]], w.prefabs, [100, 200]).map(l => [l.x, l.z]), [[100, 200], [105, 205]], 'around an origin: a plot');
});

test("what stands on a plot may show its repo's state: a colour for the deploy, so much of a bar for the context, there or not for the rest", () => {
  assert.deepEqual(shown('deploy', { deploy: 'ok' }), { color: '#2fa57a' });
  assert.deepEqual(shown('deploy', { deploy: 'blocked' }), { color: '#9aa4ad' }, 'any state it has no colour for: grey');
  assert.deepEqual(shown('deploy', { deploy: null }), { hidden: true });
  assert.deepEqual(shown('context', { context: 0.4 }), { k: 0.4 });
  assert.deepEqual(shown('context', { context: 0 }), { k: 0.02 }, 'never quite nothing');
  assert.deepEqual([shown('collision', { collision: true }), shown('collision', {}), shown('busy', { busy: true }), shown('busy', {})], [{}, { hidden: true }, {}, { hidden: true }]);
  const w = world({ plots: { at: [[10, 10]], scenery: [
    { shape: 'box', size: [1, 4, 1], color: '#aaaaaa', shows: 'context' }, { shape: 'plane', size: [4, 1], color: '#aaaaaa', shows: 'context' },
    { shape: 'box', size: [1, 1, 1], color: '#aaaaaa', shows: 'deploy' }, { shape: 'box', size: [1, 1, 1], color: '#bbbbbb', shows: 'collision' },
  ] } });
  const leaves = flatten(w.plots.scenery, w.prefabs, [10, 10], { deploy: 'failed', context: 0.5, collision: false, busy: false });
  assert.equal(leaves.length, 3, 'no collision: its cone is not there');
  assert.deepEqual(leaves[0].size, [1, 2, 1], 'a shape grows from the ground');
  assert.deepEqual([leaves[1].size, leaves[1].x], [[2, 0, 1], 9], 'a flat one from its left edge');
  assert.equal(leaves[2].color, '#e04a3a');
});

test('shapes of one kind and colour are one instanced mesh, however many; what can be clicked is found again by its instance', () => {
  const w = world({ scenery: [
    { shape: 'box', size: [1, 2, 1], each: Array.from({ length: 50 }, (_, i) => [i, 0]), color: '#336699' },
    { shape: 'box', size: [2, 2, 2], at: [5, 5], color: '#336699', opens: 'session', tip: 'Hut' },
    { shape: 'cone', size: [1, 1, 1], color: '#336699' }, { shape: 'box', size: [1, 1, 1], color: '#336699', glow: true },
  ] });
  const scenery = makeScenery({ world: w, assets: null });
  const group = scenery.build(w.scenery);
  assert.deepEqual(group.children.map(m => [m.isInstancedMesh, m.count]), [[true, 51], [true, 1], [true, 1]], 'fifty-one boxes of one look, a cone, a glowing box');
  const boxes = group.children[0], m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  boxes.getMatrixAt(3, m);
  m.decompose(p, q, s);
  assert.deepEqual([p.x, p.y, p.z, s.x, s.y, s.z], [3, 1, 0, 1, 2, 1], 'each stands on the ground, as large as it is');
  assert.deepEqual(scenery.metaOf({ object: boxes, instanceId: 50 }), { opens: 'session', tip: 'Hut' });
  assert.equal(scenery.metaOf({ object: boxes, instanceId: 3 }), null);
  const glowing = group.children[2].material;
  assert.equal(glowing.emissiveIntensity, 0, 'by day nothing glows');
  scenery.setNight(1);
  assert.equal(glowing.emissiveIntensity, 1);
  assert.equal(group.children[0].material.emissiveIntensity ?? 1, 1, 'what does not glow is left as it is');
  scenery.release(group);
  scenery.dispose();
});

/* ---------- models ---------- */

test('flat markings above a raster surface keep their declared drawing order', async () => {
  const w=world({scenery:[{sprite:'assets/court.png',size:[10,20],y:.04},{shape:'plane',size:[.04,20],color:'#ffffff',y:.065}]});
  const scenery=makeScenery({world:w,assets:{async sprite(){return new THREE.Mesh(new THREE.PlaneGeometry(10,20),new THREE.MeshBasicMaterial({transparent:true}));}}});
  const group=scenery.build(w.scenery);await Promise.resolve();
  const line=group.children.find(o=>!o.userData.raster),court=group.children.find(o=>o.userData.raster);
  assert.ok(line.renderOrder>court.renderOrder);scenery.release(group);scenery.dispose();
});

test('a model is read from the bytes the page hands over, once for all who ask; each copy has nodes of its own', async () => {
  let asked = 0;
  const assets = makeAssets({ bytes: async path => { asked++; return asset(path.replace('assets/', '')); } });
  const [a, b] = await Promise.all([assets.model('assets/player.glb'), assets.model('assets/player.glb')]);
  assert.equal(asked, 1);
  assert.notEqual(a.scene, b.scene);
  assert.equal(a.animations, b.animations, 'the clips are shared');
  assert.deepEqual(a.animations.map(c => c.name), ['Stand', 'Walk', 'Swing', 'Wave', 'Rest']);
  const meshes = [];
  a.scene.traverse(o => { if (o.isMesh) meshes.push(o.material.name); });
  assert.ok(meshes.includes('Shirt') && meshes.includes('Skin'));
  await assert.rejects(makeAssets({ bytes: async () => { throw new Error('That file is not there.'); } }).model('assets/none.glb'), /not there/);
  await assert.rejects(makeAssets({ bytes: async () => new ArrayBuffer(8) }).model('assets/junk.glb'));
  assets.dispose();
});

test('a model that stands in many places is drawn once for all of them', async () => {
  const w = world({ scenery: [{ model: 'assets/cypress.glb', each: [[1, 1], [2, 2], [3, 3]], scale: 2, tip: 'A cypress' }] });
  const errors = [];
  let changes = 0;
  const assets = makeAssets({ bytes: async path => asset(path.replace('assets/', '')) });
  const scenery = makeScenery({ world: w, assets, changed: () => changes++, onError: e => errors.push(e) });
  const group = scenery.build(w.scenery);
  assert.equal(group.children.length, 0, 'it comes in when it has loaded');
  await settled();
  assert.deepEqual(group.children.map(m => [m.isInstancedMesh, m.count]), [[true, 3], [true, 3]], 'its trunk and its leaves, three of each in one call');
  assert.equal(changes, 1, 'and the world is drawn again');
  assert.deepEqual(scenery.metaOf({ object: group.children[0], instanceId: 2 }), { tip: 'A cypress' });
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  group.children[0].getMatrixAt(1, m);
  m.decompose(p, q, s);
  assert.deepEqual([p.x, p.z, s.x], [2, 2, 2]);
  const missing = makeScenery({ world: w, assets: makeAssets({ bytes: async () => { throw new Error('gone'); } }), onError: e => errors.push(e) });
  missing.build(w.scenery);
  await settled();
  assert.deepEqual(errors, ['assets/cypress.glb: gone'], 'a model that can not be had is said, and the rest of the world stands');
  scenery.release(group);
});

test('the model writer makes what GLTFLoader reads: nodes, materials by name, clips that turn and move them', async () => {
  const bytes = glb({
    materials: { Red: '#ff0000' },
    nodes: [{ name: 'Root' }, { name: 'Arm', parent: 'Root', at: [0, 1, 0], parts: [{ shape: 'box', size: [1, 2, 1], at: [0, -1, 0], material: 'Red' }, { shape: 'cone', size: [1, 1, 1], at: [0, 1, 0], material: 'Red' }] }],
    animations: [{ name: 'Wave', tracks: [{ node: 'Arm', path: 'rotation', times: [0, 1], values: [turn('x', 0), turn('x', 1)] }] }],
  });
  assert.equal(bytes.readUInt32LE(0), 0x46546c67);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const { scene, animations } = await makeAssets({ bytes: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) }).model('assets/x.glb');
  const arm = scene.getObjectByName('Arm');
  assert.deepEqual([arm.position.y, arm.material.name, arm.material.color.getHexString()], [1, 'Red', 'ff0000']);
  const box = new THREE.Box3().setFromObject(scene);
  assert.deepEqual([box.min.y, box.max.y], [-1, 2.5]);
  assert.deepEqual([animations[0].name, animations[0].duration, animations[0].tracks[0].name], ['Wave', 1, 'Arm.quaternion']);
  assert.deepEqual(turn('y', Math.PI), [0, 1, 0, 0]);
});

/* ---------- figures ---------- */

test('every figure moves the same five ways: walking wherever it goes, else by its state', () => {
  assert.deepEqual(MOVES, ['idle', 'walk', 'work', 'wait', 'sleep']);
  const a = (state, over = {}) => ({ state, ...over });
  assert.deepEqual(['waiting', 'working', 'turn', 'idle', 'stale'].map(s => moveOf(a(s), false)), ['wait', 'work', 'idle', 'sleep', 'sleep']);
  assert.equal(moveOf(a('working'), true), 'walk');
  assert.equal(moveOf(a('turn', { nap: true }), false), 'sleep');
});

test("the kit's person: in its agent's colour, eased from one move to the next, grey and still when stale, an orb for each subagent", () => {
  const w = world(), figures = makeFigures({ world: w, assets: null });
  const f = figures.create({ id: 'a', color: '#d9673a' });
  const height = () => new THREE.Box3().setFromObject(f.object).getSize(new THREE.Vector3()).y;
  f.animate('idle', 0, 1);
  close(height(), 1.7, 0.12);
  const colours = () => { const out = new Set(); f.object.traverse(o => { if (o.isMesh) out.add(o.material.color.getHexString()); }); return out; };
  assert.ok(colours().has('d9673a'));
  f.animate('sleep', 0, 1);
  assert.ok(height() < 1.3, 'asleep it sits');
  f.animate('idle', 0, 0.5);
  const half = height();
  assert.ok(half > 1.2 && half < 1.68, 'half-way back up');
  f.setStale(true);
  assert.ok(!colours().has('d9673a') && colours().has('9aa4ad'));
  f.setStale(false);
  assert.ok(colours().has('d9673a'));
  const meshes = () => { let n = 0; f.object.traverse(o => { if (o.isMesh) n++; }); return n; };
  const before = meshes();
  f.setKids(3, 0);
  assert.equal(meshes(), before + 3);
  f.setKids(1, 0.5);
  assert.equal(meshes(), before + 1);
  for (const move of MOVES) assert.doesNotThrow(() => f.animate(move, 1.5, 1));
  f.dispose();
  assert.equal(f.object.parent, null);
  figures.dispose();
});

test("a world's own figure: its model scaled to the figure's height, the shirt in the agent's colour, its clips played by their standard names", async () => {
  const w = world({ figure: { model: 'assets/player.glb', height: 2, tint: 'Shirt', clips: { idle: 'Stand', walk: 'Walk', work: 'Swing', wait: 'Wave', sleep: 'Rest' } } });
  let changes = 0;
  const assets = makeAssets({ bytes: async path => asset(path.replace('assets/', '')) });
  const figures = makeFigures({ world: w, assets, changed: () => changes++ });
  const f = figures.create({ id: 'a', color: '#4a7bd0' }), g = figures.create({ id: 'b', color: '#2fa57a' });
  f.animate('idle', 0, 1); // the kit's person, until the model has loaded
  await settled();
  assert.equal(changes, 2);
  f.animate('idle', 0, 1);
  close(new THREE.Box3().setFromObject(f.object).getSize(new THREE.Vector3()).y, 2, 0.05);
  const shirt = fig => { let c = null; fig.object.traverse(o => { if (o.isMesh && o.material.name === 'Shirt') c = o.material.color.getHexString(); }); return c; };
  assert.deepEqual([shirt(f), shirt(g)], ['4a7bd0', '2fa57a'], 'each its own colour, though they share the model');
  const arm = f.object.getObjectByName('ArmR');
  f.animate('wait', 0.2, 1);
  f.animate('wait', 0.4, 1);
  assert.ok(Math.abs(arm.quaternion.x) > 0.9, 'waving: the arm is up');
  f.animate('walk', 0.6, 1);
  f.animate('walk', 0.8, 1);
  assert.ok(Math.abs(arm.quaternion.x) < 0.5, 'walking: it swings by its side');
  f.setStale(true);
  assert.equal(shirt(f), '9aa4ad');
  assert.equal(f.hand.parent.parent, f.object, 'no node named for its hand: what it holds is held before its middle, not by a part of the model');
  f.dispose(); g.dispose(); figures.dispose(); assets.dispose();
});

test("what a figure holds hangs from the node its world names, at its own size whatever the model's", async () => {
  const w = world({ figure: { model: 'assets/player.glb', height: 3.5, hand: 'HandR', clips: { idle: 'Stand', walk: 'Walk', work: 'Swing', wait: 'Wave', sleep: 'Rest' } } });
  const assets = makeAssets({ bytes: async path => asset(path.replace('assets/', '')) });
  const figures = makeFigures({ world: w, assets, changed: () => {} });
  const f = figures.create({ id: 'a', color: '#4a7bd0' });
  const held = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  f.hand.add(held); // put in the kit person's hand before the model has loaded
  await settled();
  assert.equal(f.hand.parent.name, 'HandR');
  assert.equal(held.parent, f.hand, 'and it went over to the model\'s hand');
  f.object.updateMatrixWorld(true);
  const size = held.getWorldScale(new THREE.Vector3());
  close(size.x, 1, 1e-3); close(size.y, 1, 1e-3); close(size.z, 1, 1e-3);
  const at = f.hand.getWorldPosition(new THREE.Vector3());
  f.animate('wait', 0.2, 1);
  f.animate('wait', 0.4, 1);
  f.object.updateMatrixWorld(true);
  assert.ok(f.hand.getWorldPosition(new THREE.Vector3()).y > at.y + 0.5, 'waving, the hand goes up and what it holds with it');
  f.dispose(); figures.dispose(); assets.dispose();
});

/* ---------- the camera ---------- */

test('at 100% the whole ground is in the frame, whatever the view; zoom and dragging move the view inside it', () => {
  const corners = (rig, w, d) => [[0, 0], [w, 0], [0, d], [w, d]].map(([x, z]) => new THREE.Vector3(x, 0, z).project(rig.camera));
  for (const view of ['iso', 'tilt', 'top', 'orbit']) {
    const w = world({ ground: { size: [60, 30] }, camera: { view } }), rig = makeCamera({ world: w, size: () => [1000, 600] });
    rig.update(0);
    for (const c of corners(rig, 60, 30)) assert.ok(Math.abs(c.x) <= 1 && Math.abs(c.y) <= 1, `${view}: a corner at ${c.x.toFixed(2)}, ${c.y.toFixed(2)}`);
    assert.equal(rig.flat, view !== 'orbit');
  }
  const rig = makeCamera({ world: world({ ground: { size: [60, 30] }, camera: { view: 'top' } }), size: () => [1000, 600] });
  rig.update(0);
  const centre = () => new THREE.Vector3(30, 0, 15).project(rig.camera);
  close(centre().x, 0); close(centre().y, 0);
  assert.equal(rig.zoom, 1);
  rig.zoomBy(1);
  assert.equal(rig.zoom, ZOOMS[ZOOMS.indexOf(1) + 1]);
  rig.update(0);
  assert.ok(corners(rig, 60, 30).some(c => Math.abs(c.x) > 1), 'zoomed in, the ground is larger than the frame');
  rig.panBy(100, 0);
  rig.update(0);
  assert.ok(centre().x > 0.15, 'dragged right, the world moves right');
  rig.zoomBy(0);
  rig.update(0);
  close(centre().x, 0);
  assert.equal(rig.zoom, 1, 'back to the whole world');
  for (let i = 0; i < 20; i++) rig.zoomBy(1);
  assert.equal(rig.zoom, ZOOMS.at(-1));
  rig.setZoom(0.01);
  assert.equal(rig.zoom, ZOOMS[0]);
});

test('the ground keeps clear of the panel over the top left: beside it or below it, whichever leaves it bigger', () => {
  const fit = (size, safe) => {
    const rig = makeCamera({ world: world({ ground: { size: [60, 30] }, camera: { view: 'top' } }), size: () => size });
    rig.setSafe(...safe);
    rig.update(0);
    const px = ([x, z]) => { const v = new THREE.Vector3(x, 0, z).project(rig.camera); return [(v.x * 0.5 + 0.5) * size[0], (-v.y * 0.5 + 0.5) * size[1]]; };
    return { topLeft: px([0, 0]), bottomRight: px([60, 30]) };
  };
  const plain = fit([1000, 600], [0, 0]), beside = fit([1000, 600], [250, 400]), below = fit([1000, 900], [250, 300]);
  assert.ok(beside.topLeft[0] >= 250, `beside: the ground starts right of the panel (${beside.topLeft[0].toFixed(0)})`);
  assert.ok(beside.bottomRight[0] <= 1000);
  assert.ok(below.topLeft[1] >= 300, `below: it starts under the panel (${below.topLeft[1].toFixed(0)})`);
  assert.ok(below.bottomRight[0] - below.topLeft[0] > 900, 'and has the frame\'s whole width');
  assert.ok(plain.bottomRight[0] - plain.topLeft[0] > beside.bottomRight[0] - beside.topLeft[0], 'no panel: bigger');
});

test('Follow keeps an agent in the middle, zoomed in; the orbit view turns, the others do not', () => {
  const rig = makeCamera({ world: world({ camera: { view: 'tilt' } }), size: () => [800, 600] });
  const body = { x: 5, z: 6 };
  rig.follow(body);
  assert.equal(rig.following, true);
  assert.equal(rig.zoom, 2);
  rig.update(0);
  const at = () => new THREE.Vector3(body.x, 0, body.z).project(rig.camera);
  close(at().x, 0); close(at().y, 0);
  body.x = 9;
  rig.update(0);
  close(at().x, 0);
  rig.panBy(10, 0);
  assert.equal(rig.following, false, 'dragging takes the view back');
  rig.update(0);
  const before = rig.camera.position.clone();
  rig.turnBy(100, 0);
  rig.update(0);
  assert.ok(rig.camera.position.equals(before), 'a flat view does not turn');
  const orbit = makeCamera({ world: world({ camera: { view: 'orbit' } }), size: () => [800, 600] });
  orbit.update(0);
  const was = orbit.camera.position.clone();
  orbit.turnBy(100, 0);
  orbit.update(0);
  assert.ok(!orbit.camera.position.equals(was));
});

/* ---------- what is written over the world ---------- */

test('the sign over an agent says what it does now, the same in every world', () => {
  const steps = world({ steps: { test: { glyph: '🎾', verb: 'serving' } } }).steps;
  const g = (state, over = {}) => glyphOf({ state, ...over }, steps);
  assert.deepEqual(g('waiting'), ['!', 'waits for your permission']);
  assert.deepEqual(g('waiting', { askKind: 'question' }), ['?', 'asks you a question']);
  assert.deepEqual(g('waiting', { planAsk: true }), ['📋', 'a plan waits for your approval']);
  assert.deepEqual(g('turn'), ['✓', 'finished its turn']);
  assert.deepEqual(g('turn', { question: 'Ship it?' }), ['?', 'asks you something']);
  assert.deepEqual(g('turn', { nap: true })[0], '💤');
  assert.deepEqual([g('idle')[0], g('stale')[0]], ['💤', '…']);
  assert.deepEqual(g('working', { step: 'test', tool: 'Bash' }), ['🎾', 'serving'], "the world's own word for a step");
  assert.deepEqual(g('working', { step: 'edit', tool: 'Edit' }), ['✏️', 'editing']);
  assert.deepEqual(g('working', { thinking: true }), ['💭', 'thinking']);
  assert.deepEqual(g('working'), ['💭', 'between steps']);
});

test("a plot's label: its repo's name and a chip for each thing to know; nothing a repo is called is read as HTML", () => {
  const html = plotLabel({ name: '<b>shop</b>-with-a-very-long-name', deploy: { state: 'failed', label: '✗ "broken"' }, collision: 'high', dirty: 3, ahead: 2, behind: 1, prs: { open: [{}, {}] } }, 4);
  assert.match(html, /^<b>&lt;b&gt;shop&lt;\/…ong-name<\/b>/);
  assert.match(html, /<i class="dep-bad" title="✗ &quot;broken&quot;">✗<\/i>/);
  for (const chip of ['⚠', '●3', '↑2', '↓1', '#2', '+4']) assert.ok(html.includes(chip), chip);
  assert.equal(plotLabel({ name: 'api' }), '<b>api</b>');
  assert.match(plotLabel({ name: 'x', deploy: { state: 'running' } }), /dep-run/);
  assert.match(plotLabel({ name: 'x', deploy: { state: 'odd' } }), /dep-dim/);
});

test('the HUD: the Farm controls and SDK actions share the same accessible, escaped UI', t => {
  const ctx = vm.createContext({ window: { Agentville: {} } });
  for (const file of ['pixel-text.js', 'pixel-hud.js']) vm.runInContext(readFileSync(new URL(`../../web/worlds/sdk/ui/${file}`, import.meta.url), 'utf8'), ctx);
  const old = globalThis.Agentville; globalThis.Agentville = ctx.window.Agentville; t.after(() => { globalThis.Agentville = old; });
  const nouns = { agent: 'player', agents: 'players', repo: 'court', repos: 'courts', place: '<i>club</i>' };
  const scene = {
    agents: [{ id: 'a', state: 'waiting', cost: 1.5, compactions: 2 }, { id: 'b', state: 'turn', question: 'Ok?', cost: 0.25 }],
    chrome: { counts: { waiting: 1, working: 0, yourTurn: 1, idle: 0, stale: 0, collisions: 0 }, asking: 1, agents: 2, oldestWaiting: Date.now() - 180_000, ram: { usedMb: 2048, totalMb: 16384 }, cpu: { used: 40, cores: 8 }, errors: ['git: <script>'] },
    plan: { windows: [{ kind: 'five_hour', pct: 30 }, { kind: 'seven_day', pct: 95 }] }, accounts: [],
  };
  const html = hudHtml({ scene, nouns, still: false, zoom: 1.5, saysOn: true, skyMode: 'live', follow: false, canFollow: false, restingHidden: 2, bell: true, awake: false, nav: { theme: 'dark', side: true, live: false }, panelOpen: true, menuOpen: true });
  assert.match(html, /\$1\.75/);
  assert.match(html, /2 compacted/);
  assert.match(html, /data-do="state:waiting"/);
  assert.match(html, /class="px-kpi" disabled[^>]*><span class="px-kpi-ico k-work"/, 'a count of none can not be clicked');
  assert.match(html, /oldest 3m/);
  assert.match(html, /2\.0 GB/);
  assert.match(html, /WEEK.*?px-bar.*?class="bad" style="width:95%"/);
  assert.match(html, /2 need you/);
  assert.match(html, /git: &lt;script&gt;/);
  assert.ok(!html.includes('<i>club</i>') && html.includes('&lt;i&gt;club&lt;/i&gt;'), "the world's nouns are text");
  assert.match(html, /data-do="follow"[^>]*disabled/);
  assert.match(html, /hidden \(2\)/);
  assert.match(html, /data-do="nav:side"[^>]*aria-pressed="true"/);
  assert.match(html, /px-live off/);
  assert.match(html, />150%</);
  assert.match(html, /class="px-menu" role="group" aria-label="Menu">/);
  const folded = hudHtml({ scene: null, nouns, panelOpen: false, menuOpen: false, own: true });
  assert.match(folded, /px-stats own folded/);
  assert.match(folded, /class="px-menu" role="group" aria-label="Menu" hidden>/);
  const two = hudHtml({ scene: { ...scene, accounts: [{ key: 'a', name: 'work', plan: { weekly: { pct: 10 }, fiveHour: { pct: 5 } } }, { key: 'b', name: '', plan: null }] }, nouns, panelOpen: true });
  assert.match(two, /WORK/);
  assert.match(two, /ACC 2/, 'an account with no name is numbered');
  assert.ok(!two.includes('5-hour limit'), 'with several accounts, each has its own row');
});

test('how to read a world: the signs, the same in every world, with the world\'s own words for what its agents do', () => {
  const w = world({ nouns: { agent: 'player', agents: 'players', repo: 'court', repos: 'courts' }, help: 'Players <rally>.', steps: { test: { glyph: '🎾', verb: 'serving' } } });
  const html = helpHtml(w);
  assert.match(html, /<p>Players &lt;rally&gt;\.<\/p>/);
  assert.match(html, /<dt>players<\/dt>/);
  assert.match(html, /<dt>🎾<\/dt><dd>serving<\/dd>/);
  assert.match(html, /Over each player/);
  assert.ok(!helpHtml(world()).includes('<p>'), 'no words of its own: only the signs');
});

test('raster sprites use nearest filtering, atlas UVs and owned geometry without changing model loading', async t => {
  const old = globalThis.createImageBitmap;
  globalThis.createImageBitmap = async () => ({ width: 128, height: 256, close() {} });
  t.after(() => { globalThis.createImageBitmap = old; });
  const assets = makeAssets({ bytes: async () => new ArrayBuffer(1) });
  const mesh = await assets.sprite('assets/tile.png', [2, 4], [32, 64, 32, 64]);
  assert.equal(mesh.material.map.magFilter, THREE.NearestFilter);
  assert.equal(mesh.material.map.minFilter, THREE.NearestFilter);
  assert.equal(mesh.material.map.generateMipmaps, false);
  assert.deepEqual([...mesh.geometry.attributes.uv.array], [.25, .75, .5, .75, .25, .5, .5, .5]);
  mesh.userData.frame([0, 0, 128, 256]);
  assert.deepEqual([...mesh.geometry.attributes.uv.array], [0, 1, 1, 1, 0, 0, 1, 0]);
  mesh.geometry.dispose(); mesh.material.dispose(); assets.dispose();
});
