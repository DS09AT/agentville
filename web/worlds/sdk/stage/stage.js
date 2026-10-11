// The stage: a world of api 2, drawn with three.js. It builds the ground, the scenery and each repo's plot
// from the world's manifest, keeps a figure for every agent where the simulation says it is, lights it all by
// the time of day, and draws a frame when asked. It decides nothing: who stands where comes from the
// simulation (core/sim.js) or, for a world the collector moves, from what the collector sends.
// A world adds looks of its own as hooks (docs/worlds.md, "view.js").
import * as THREE from 'three';
import { FLIGHT_S } from '../core/sim.js';
import { stepOf } from '../core/steps.js';
import { makeAssets } from './assets.js';
import { makeCamera } from './camera.js';
import { makeFigures, moveOf } from './figures.js';
import { makeScenery } from './scenery.js';

const turnTo = (from, to, k) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * k; // the short way round

/**
 * `canvas`: where it draws; `world`, `layout`: the manifest read and its ground plan; `bytes(path)`: a promise of
 * one of the world's files; `view`: the world's view.js hooks, or {}; `changed()`: something came in late (a
 * model loaded): draw again; `onError(message)`: something of the world's failed.
 */
export function makeStage({ canvas, world, layout, bytes, view = {}, changed = () => {}, onError = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  const size = () => [canvas.clientWidth || 1, canvas.clientHeight || 1];
  const rig = makeCamera({ world, size });
  const assets = makeAssets({ bytes });
  const scenery = makeScenery({ world, assets, changed, onError });
  const figures = makeFigures({ world, assets, changed, onError });
  const { w, d } = world.ground, span = Math.max(w, d);

  // Light: the sky's from above and the ground's from below, and a sun that casts the shadows.
  const skyLight = new THREE.HemisphereLight('#ffffff', world.ground.color, 1.6), sun = new THREE.DirectionalLight('#fff4e0', 2.2);
  sun.position.set(w / 2 - span * 0.5, span * 1.1, d / 2 + span * 0.7);
  sun.target.position.set(w / 2, 0, d / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -span * 0.8, right: span * 0.8, top: span * 0.8, bottom: -span * 0.8, near: 1, far: span * 4 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(skyLight, sun, sun.target);

  // The ground, and more land round it so the world does not end at its own edge.
  const land = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: world.ground.color }));
  land.scale.set(w, 1, d);
  land.position.set(w / 2, 0, d / 2);
  land.receiveShadow = true;
  const around = new THREE.Mesh(land.geometry, new THREE.MeshLambertMaterial({ color: new THREE.Color(world.ground.color).multiplyScalar(0.82) }));
  around.scale.set(span * 12, 1, span * 12);
  around.position.set(w / 2, -0.03, d / 2);
  around.receiveShadow = true;
  const fixed = scenery.build(world.scenery);
  scene.add(around, land, fixed);
  const front = (world.camera.yaw * Math.PI) / 180; // the way someone looks when their place does not say: at the viewer

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.58, 28).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd43b', transparent: true, opacity: 0.9 })); // at the feet of the agent picked
  ring.visible = false;
  scene.add(ring);
  const letter = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.05, 0.24), new THREE.MeshLambertMaterial({ color: '#fff4d6' })); // a message on its way; copied for each
  const letters = [];

  const day = new THREE.Color(world.sky.day), dark = new THREE.Color(world.sky.night);
  scene.background = day.clone();
  let light = 1;

  const people = new Map(); // agent id → { figure, agent, x, z, heading, walk, zone, prop, propFor }
  let agents = new Map(), repos = [], beds = new Map(), plots = new Map(), plotsKey = '', selected = null, T = 0;
  let facts = null, bodiesNow = [], sharedNow = {}; // the dashboard's scene, where everyone is, and what the world's sim.js shares
  // What a world's view.js is handed. world, layout, scene, time and plotOf are what its sim.js is handed under the same names.
  const ctx = {
    THREE, root: scene, camera: rig.camera, world, layout, assets,
    get scene() { return facts; },
    get bodies() { return bodiesNow; },
    get shared() { return sharedNow; },
    /** The plot of a repo, by its key: { bed, x, z } (its centre), or null when it has none. */
    plotOf: key => layout.plotAt(beds.get(key)),
    get time() { return T; },
    get light() { return light; },
    /** Draw again: for a world's own thing that changed outside a frame (motion off draws no frames by itself). */
    invalidate: changed,
  };
  const failed = new Set();
  /** One of the world's own hooks, called; what it throws is reported once and the world goes on without it. */
  function hook(name, ...args) {
    if (typeof view[name] !== 'function' || failed.has(name)) return undefined;
    try { return view[name](ctx, ...args); } catch (err) { failed.add(name); onError(`view.js, ${name}(): ${err?.message ?? err}`); return undefined; }
  }
  hook('setup');

  /**
   * A figure for an agent: the world's own (its figure hook: an Object3D, or { object, animate?, setStale?, setKids?,
   * dispose? }), else the kit's or the model the manifest names. What a world made, it frees itself.
   */
  function figureFor(agent) {
    const own = hook('figure', agent), made = own?.isObject3D ? { object: own } : own;
    if (!made?.object?.isObject3D) return figures.create(agent);
    return { height: world.figure.height, hand: made.object, animate() {}, setStale() {}, setKids() {}, ...made, dispose() { made.object.removeFromParent(); made.dispose?.(); } };
  }
  /** What an agent holds for its step, where the manifest gives the step a model: put in its hand, taken away with the step. */
  function hold(p) {
    const step = p.agent.state === 'working' && !p.walk ? stepOf(p.agent) : null, model = step ? world.steps[step]?.model : null;
    if (model === p.propFor) return;
    p.propFor = model;
    if (p.prop) { p.prop.removeFromParent(); p.prop = null; }
    if (!model) return;
    assets.model(model).then(({ scene: made }) => {
      if (p.propFor !== model || people.get(p.agent.id) !== p) return;
      p.prop = made;
      p.figure.hand.add(made);
      changed();
    }, err => onError(`${model}: ${err?.message ?? err}`));
  }

  /** Each plot as its repo stands: built again only when what it shows has changed. */
  function buildPlots() {
    if (!world.plots) return;
    const used = new Map(repos.filter(r => layout.plotAt(beds.get(r.key))).map(r => [beds.get(r.key), r]));
    const stateOf = bed => {
      const r = used.get(bed);
      if (!r) return null;
      const here = [...agents.values()].filter(a => a.repo === r.key);
      return { deploy: r.deploy?.state ?? null, context: Math.round(Math.max(0, ...here.map(a => a.contextPct ?? 0)) * 20) / 20, collision: Boolean(r.collision), busy: here.some(a => a.state === 'working') };
    };
    const states = world.plots.at.map((_, bed) => stateOf(bed)), key = JSON.stringify(states);
    if (key === plotsKey) return;
    plotsKey = key;
    for (const g of plots.values()) scenery.release(g);
    plots = new Map(states.map((state, bed) => {
      const g = scenery.build(state ? world.plots.scenery : world.plots.empty, world.plots.at[bed], state);
      scene.add(g);
      return [bed, g];
    }));
  }

  const v = new THREE.Vector3(), ray = new THREE.Raycaster(), pointer = new THREE.Vector2(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** A point of the world on the screen: [x, y] in CSS pixels of the canvas, or null when it is out of view. */
  function project(x, y, z) {
    v.set(x, y, z).project(rig.camera);
    if (v.z < -1 || v.z > 1) return null;
    const [fw, fh] = size();
    return [(v.x * 0.5 + 0.5) * fw, (-v.y * 0.5 + 0.5) * fh];
  }

  return {
    rig, project,
    /** The dashboard's newest scene, and each repo's bed: who there is, and how each plot stands. */
    setScene(next, bedOf) {
      facts = next;
      agents = new Map(next.agents.map(a => [a.id, a]));
      repos = next.repos;
      beds = bedOf;
      for (const p of people.values()) if (agents.has(p.agent.id)) p.agent = agents.get(p.agent.id);
      buildPlots();
      hook('scene', next);
    },
    /** Where everyone is now ([{ id, x, z, walk, zone }]): each gets a figure, and one no longer there loses it. */
    setBodies(bodies, shared) {
      bodiesNow = bodies;
      if (shared) sharedNow = shared;
      const there = new Set();
      for (const b of bodies) {
        const agent = agents.get(b.id);
        if (!agent) continue;
        there.add(b.id);
        let p = people.get(b.id);
        if (!p) {
          const figure = figureFor(agent);
          p = { figure, agent, x: b.x, z: b.z, heading: front, to: front, walk: false, zone: b.zone, prop: null, propFor: null, fresh: true };
          figure.object.position.set(b.x, 0, b.z);
          scene.add(figure.object);
          people.set(b.id, p);
        }
        const dx = b.x - p.x, dz = b.z - p.z;
        p.to = b.walk ? (Math.hypot(dx, dz) > 0.002 ? Math.atan2(dx, dz) : p.to) : layout.heading(b.zone, b.x, b.z) ?? front; // the way it goes; standing, the way its place looks
        Object.assign(p, { x: b.x, z: b.z, walk: b.walk, zone: b.zone });
      }
      for (const [id, p] of people) if (!there.has(id)) { p.prop?.removeFromParent(); p.figure.dispose(); people.delete(id); }
    },
    setSelected(id) { selected = id; },
    /** An agent's figure as it stands ({ x, z }, kept up to date), or null: for the view to follow. */
    personOf: id => people.get(id) ?? null,
    /** The time of day: `k` from 0 (night) to 1 (day). */
    setLight(k) {
      light = k;
      scene.background.copy(dark).lerp(day, k);
      skyLight.intensity = 1 + 0.6 * k;
      sun.intensity = 0.35 + 1.85 * k;
      sun.color.set(k < 0.5 ? '#9fb4ff' : '#fff4e0');
      scenery.setNight(1 - k);
    },
    /** Where each agent shown is: its id, its head on the screen, and its feet ([x, y] in CSS pixels; null out of view). */
    marks() {
      return [...people.values()].map(p => ({ id: p.agent.id, head: project(p.x, p.figure.height * (moveOf(p.agent, p.walk) === 'sleep' ? 0.72 : 1.08), p.z), feet: project(p.x, 0, p.z) }));
    },
    /** Each plot in use: its bed, its repo, and where its label sits on the screen. */
    plotMarks() {
      if (!world.plots) return [];
      return repos.flatMap(r => { const plot = layout.plotAt(beds.get(r.key)); return plot ? [{ bed: plot.bed, repo: r, at: project(plot.x + world.plots.label[0], 0, plot.z + world.plots.label[1]) }] : []; });
    },
    /** What is under a point of the canvas: { agent: id }, { opens, tip }, { plot: bed }, { tip }, or null. */
    pick(px, py) {
      let best = null, bestD = 16;
      for (const m of this.marks()) { // an agent: the pointer within a few pixels of the line from its feet to its head
        if (!m.head || !m.feet) continue;
        const [ax, ay] = m.feet, [bx, by] = m.head, len2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / len2)), dd = Math.hypot(px - (ax + (bx - ax) * t), py - (ay + (by - ay) * t));
        if (dd < bestD) { bestD = dd; best = m.id; }
      }
      if (best) return { agent: best };
      const [fw, fh] = size();
      pointer.set((px / fw) * 2 - 1, -(py / fh) * 2 + 1);
      ray.setFromCamera(pointer, rig.camera);
      let tip = null;
      for (const hit of ray.intersectObjects([fixed, ...plots.values()], true)) {
        const meta = scenery.metaOf(hit);
        if (meta?.opens) return meta;
        if (meta?.tip) { tip = { tip: meta.tip }; break; }
      }
      if (world.plots && ray.ray.intersectPlane(groundPlane, v)) {
        const [pw, pd] = world.plots.size;
        for (const r of repos) { const plot = layout.plotAt(beds.get(r.key)); if (plot && Math.abs(v.x - plot.x) <= pw / 2 && Math.abs(v.z - plot.z) <= pd / 2) return { plot: plot.bed, ...(tip ?? {}) }; }
      }
      return tip;
    },
    /**
     * A frame: everyone turned and moved as they are, the messages on their way, the view where it is going, and
     * all of it drawn. `dt`: seconds since the last frame (0: as it stands, nothing eased); `t`: the world's clock;
     * `flights`: messages on their way, as [from, to, when it set off].
     */
    frame(dt, t, flights = []) {
      T = t;
      const k = dt ? 1 - Math.exp(-dt * 12) : 1;
      for (const p of people.values()) {
        p.heading = p.fresh ? p.to : turnTo(p.heading, p.to, k);
        p.fresh = false;
        p.figure.object.position.set(p.x, 0, p.z);
        p.figure.object.rotation.y = p.heading;
        p.figure.setStale(p.agent.state === 'stale');
        p.figure.animate(moveOf(p.agent, p.walk), t, k);
        p.figure.setKids(Math.min(4, p.agent.kids?.length ?? 0), t);
        hold(p);
      }
      const picked = selected ? people.get(selected) : null;
      ring.visible = Boolean(picked);
      if (picked) ring.position.set(picked.x, 0.04, picked.z);
      const flying = flights.filter(([from, to, start]) => people.has(from) && people.has(to) && t - start >= 0 && t - start < FLIGHT_S);
      while (letters.length < flying.length) { const m = letter.clone(); letters.push(m); scene.add(m); }
      letters.forEach((m, i) => {
        m.visible = i < flying.length;
        if (!m.visible) return;
        const [from, to, start] = flying[i], a = people.get(from), z = people.get(to), u = (t - start) / FLIGHT_S, e = u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2;
        m.position.set(a.x + (z.x - a.x) * e, a.figure.height * 1.1 + Math.sin(Math.PI * u) * 2.2, a.z + (z.z - a.z) * e);
        m.rotation.y = Math.atan2(z.x - a.x, z.z - a.z);
      });
      rig.update(dt);
      hook('frame', dt);
      renderer.render(scene, rig.camera);
    },
    /** What the last frame took to draw (the browser test reads it): figures shown, draw calls, triangles, and the geometries and textures held. */
    stats: () => ({ figures: people.size, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }),
    /** The canvas has a new size. */
    resize() {
      const [fw, fh] = size();
      renderer.setSize(fw, fh, false);
      rig.resize();
    },
    dispose() {
      hook('dispose');
      for (const p of people.values()) { p.prop?.removeFromParent(); p.figure.dispose(); }
      people.clear();
      for (const g of [fixed, ...plots.values()]) scenery.release(g);
      for (const m of [land, around, ring, letter]) m.material.dispose();
      land.geometry.dispose(); ring.geometry.dispose(); letter.geometry.dispose();
      scenery.dispose();
      figures.dispose();
      assets.dispose();
      renderer.dispose();
    },
  };
}
