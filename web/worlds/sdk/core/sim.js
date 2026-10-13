// The simulation: who stands where, and how they walk there. It reads a world's ground plan (core/layout.js)
// and each scene (web/scene.js), gives every agent a spot by its state, walks it there along the paths, and
// says how the world stands. Nothing in it draws: the collector runs it for everyone who watches, a browser
// runs the very same code when it moves a world itself, and the stage only shows what it says. A world adds
// its own rules as hooks (docs/worlds.md, "sim.js"). No DOM and no three.js.
import { bedsOf, eventsOf } from './events.js';
import { makeLayout } from './layout.js';
import { REACH } from './manifest.js';
import { dist, seededRandom } from './util.js';

export const FLIGHT_S = 2.4; // a message from one agent to another is this long on its way
const PLOT_CAP = 48; // agents shown at one plot; more are counted, as at any place

/** The place an agent goes to by its state, when the world's own rule says nothing: a name of `places`, or 'plot'. */
export function defaultPlace(agent, places, hasPlot) {
  const has = name => Object.hasOwn(places, name);
  if (agent.nap) return 'idle';
  if (agent.state === 'working') return hasPlot ? 'plot' : has('work') ? 'work' : 'idle';
  if (agent.state === 'waiting') return 'wait';
  if (agent.state === 'turn') return has('turn') ? 'turn' : 'wait';
  if (agent.state === 'stale') return has('stale') ? 'stale' : 'idle';
  return 'idle';
}

/**
 * A world, moved. `world`: what readManifest gave; `hooks`: the world's sim.js ({ place, scene, tick, share },
 * each optional, each handed `ctx` first); `now`: the time of day in ms.
 */
export function makeSim(world, hooks = {}, { now = () => Date.now() } = {}) {
  const layout = makeLayout(world), random = seededRandom(20_260_101);
  const bodies = new Map(); // agent id → { id, x, z, tx, tz, path, walk, zone }
  const held = new Map(); // agent id → { zone, i }: the spot it has, kept while it stays in that zone
  const keptBeds = new Map(), flights = [], fx = [];
  let scene = null, beds = new Map(), T = 0, opened = false, over = {};
  const plotOf = key => layout.plotAt(beds.get(key));
  const ctx = {
    world, layout, random, now, plotOf,
    get scene() { return scene; },
    get time() { return T; },
    body: id => bodies.get(id) ?? null,
  };
  const hook = (name, ...args) => (typeof hooks[name] === 'function' ? hooks[name](ctx, ...args) : undefined);
  const pop = (x, z, text, cls = '') => { if (fx.length < 40) fx.push({ pop: [x, z, String(text).slice(0, 40), String(cls).slice(0, 12)] }); };

  /** Where an agent belongs: { zone } (a place's name, or 'plot:<bed>'), { at, zone } (a point of the world's own), or null: not shown. */
  function wanted(agent) {
    const own = hook('place', agent);
    if (own === null) return null;
    if (typeof own === 'string' && layout.places.has(own)) return { zone: own };
    if (own && typeof own === 'object') {
      if (typeof own.plot === 'string' && plotOf(own.plot)) return { zone: `plot:${plotOf(own.plot).bed}` };
      if (Array.isArray(own.at) && own.at.length === 2 && own.at.every(n => Number.isFinite(n) && Math.abs(n) <= REACH)) return { at: [own.at[0], own.at[1]], zone: typeof own.zone === 'string' ? own.zone.slice(0, 60) : '' };
    }
    const plot = agent.repo ? plotOf(agent.repo) : null, name = defaultPlace(agent, world.places, Boolean(plot));
    return { zone: name === 'plot' ? `plot:${plot.bed}` : name };
  }

  /** Everyone gets a spot: the one it has while it stays in its zone, else the first free one there; no free one, and it is counted (`over`). */
  function place() {
    const want = new Map(scene.agents.map(a => [a.id, wanted(a)]));
    const taken = new Map(); // zone → Set of spots in use
    const spotsOf = zone => { if (!taken.has(zone)) taken.set(zone, new Set()); return taken.get(zone); };
    for (const [id, h] of held) { if (want.get(id)?.zone !== h.zone || want.get(id).at) held.delete(id); else spotsOf(h.zone).add(h.i); }
    over = {};
    const there = new Set();
    for (const a of scene.agents) {
      const w = want.get(a.id);
      if (!w) continue;
      let to;
      if (w.at) to = { x: w.at[0], z: w.at[1] };
      else {
        let h = held.get(a.id);
        if (!h) {
          const cap = w.zone.startsWith('plot:') ? PLOT_CAP : layout.places.get(w.zone).spots.length, used = spotsOf(w.zone);
          let i = 0;
          while (i < cap && used.has(i)) i++;
          if (i >= cap) { over[w.zone] = (over[w.zone] ?? 0) + 1; continue; }
          h = { zone: w.zone, i };
          held.set(a.id, h);
          used.add(i);
        }
        to = layout.spot(h.zone, h.i);
      }
      there.add(a.id);
      let b = bodies.get(a.id);
      if (!b) {
        const [sx, sz] = opened ? layout.spawn : [to.x, to.z]; // those here when the world opens stand in place; later ones walk in
        b = { id: a.id, x: sx, z: sz, tx: NaN, tz: NaN, path: [], walk: false, zone: w.zone };
        bodies.set(a.id, b);
      }
      b.zone = w.zone;
      if (to.x !== b.tx || to.z !== b.tz) { b.tx = to.x; b.tz = to.z; b.path = layout.route([b.x, b.z], [to.x, to.z]); }
    }
    for (const id of [...bodies.keys()]) if (!there.has(id)) { bodies.delete(id); held.delete(id); }
    if (there.size) opened = true;
  }

  function walk(b, dt) {
    let left = world.speed * dt;
    while (b.path.length && left > 0) {
      const [qx, qz] = b.path[0], d = dist(b.x, b.z, qx, qz);
      if (d <= left) { b.x = qx; b.z = qz; b.path.shift(); left -= d; }
      else { b.x += ((qx - b.x) / d) * left; b.z += ((qz - b.z) / d) * left; left = 0; }
    }
    b.walk = b.path.length > 0;
  }

  return {
    layout,
    /** A new scene: everyone is placed afresh, and what happened since the last one pops up where it happened. */
    scene(next) {
      const events = eventsOf(scene, next);
      scene = next;
      beds = bedsOf(next.repos, keptBeds, world.plots?.at.length);
      const own = hook('scene', next);
      place();
      for (const e of [...events.filter(e => e.pop || e.kind === 'mail'), ...(Array.isArray(own) ? own.slice(0, 20) : [])]) {
        if (!e || typeof e !== 'object') continue;
        if (e.kind === 'mail') { if (bodies.has(e.from) && bodies.has(e.to) && flights.length < 20) flights.push({ from: e.from, to: e.to, start: T }); continue; }
        const b = e.agent ? bodies.get(e.agent) : null, plot = e.repo ? plotOf(e.repo) : null;
        const at = b ? [b.x, b.z] : plot ? [plot.x, plot.z] : Array.isArray(e.at) && e.at.length === 2 && e.at.every(Number.isFinite) ? e.at : null;
        if (at && e.text) pop(at[0], at[1], e.text, e.cls);
      }
    },
    /** The world moves on by dt seconds. */
    step(dt) {
      T += dt;
      for (const b of bodies.values()) walk(b, dt);
      for (let i = flights.length - 1; i >= 0; i--) {
        const f = flights[i], to = bodies.get(f.to);
        if (to && bodies.has(f.from) && T - f.start < FLIGHT_S) continue;
        if (to && bodies.has(f.from)) pop(to.x, to.z, '✉', 'good');
        flights.splice(i, 1);
      }
      if (scene && hook('tick', dt) === true) place();
    },
    /** How the world stands, with what there is to show since the last asking (fx). Lengths in metres. */
    state() {
      return {
        t: T, wall: now(),
        bodies: [...bodies.values()].map(b => ({ id: b.id, x: b.x, z: b.z, tx: Number.isFinite(b.tx) ? b.tx : b.x, tz: Number.isFinite(b.tz) ? b.tz : b.z, walk: b.walk, zone: b.zone })),
        flights: flights.map(f => [f.from, f.to, f.start]),
        over: { ...over },
        shared: hook('share') ?? null,
        fx: fx.splice(0),
      };
    },
    /** Everyone where they are going, at once, and no message left in the air (motion off). */
    settle() {
      for (const b of bodies.values()) { if (Number.isFinite(b.tx)) { b.x = b.tx; b.z = b.tz; } b.path = []; b.walk = false; }
      flights.length = 0;
    },
    beds: () => beds,
  };
}
