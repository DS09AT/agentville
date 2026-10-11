// How a world's state goes from the collector to the browsers. The room that carries it (collector/live.mjs)
// was made for worlds measured in pixels: whole numbers, positions to an eighth. A world of api 2 is measured
// in metres, so here its lengths are multiplied by 8 on the way out and divided again on the way in: a
// position is then exact to 1/64 m, a place it walks to to 1/8 m, and a world may be 500 m across. Only this
// file knows the factor. No DOM and no three.js.

const K = 8;

/** A state of the simulation (core/sim.js, state()), as the room takes it (collector/live.mjs, show()). */
export function toWire(s) {
  return {
    t: s.t, wall: s.wall,
    flights: s.flights,
    bodies: s.bodies.map(b => [b.id, b.x * K, b.z * K, b.tx * K, b.tz * K, b.walk ? 1 : 0, b.zone]),
    animals: null, over: s.over, spare: 0, jobs: [],
    shared: s.shared,
    fx: s.fx.map(e => ({ pop: [e.pop[0] * K, e.pop[1] * K, e.pop[2], e.pop[3]] })),
  };
}

/** A state as the page hands it on (web/live.js, hand()), in metres again; `w` (what the world shares, only what changed, as JSON) and `wk` (the keys it shares now, said when one is gone) are left as they are. */
export function fromWire(s) {
  return {
    t: s.t, wall: Number.isFinite(s.wl) ? s.wl : null,
    bodies: (Array.isArray(s.b) ? s.b : []).map(r => ({ id: r[0], x: r[1] / K, z: r[2] / K, tx: r[3] / K, tz: r[4] / K, walk: Boolean(r[5] & 1), zone: String(r[6] ?? '') })),
    flights: Array.isArray(s.f) ? s.f : [],
    over: s.o && typeof s.o === 'object' ? s.o : {},
    w: s.w ?? null,
    wk: Array.isArray(s.wk) ? s.wk : null,
  };
}

/** Something to show as the page hands it on ({ pop: [x, y, text, cls], t }), in metres; null for anything else. */
export function popFromWire(e) {
  return e && Number.isFinite(e.t) && Array.isArray(e.pop) && e.pop.length === 4 ? { t: e.t, x: e.pop[0] / K, z: e.pop[1] / K, text: String(e.pop[2]), cls: String(e.pop[3]) } : null;
}
