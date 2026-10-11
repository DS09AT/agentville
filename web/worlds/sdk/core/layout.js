// The ground plan of a world, from its manifest: every place's spots with the way those standing there look,
// each repo's plot by its bed, and the way from one point to another along the world's paths. The simulation
// places and walks agents by it, the stage builds on it. No DOM and no three.js.
import { dist } from './util.js';

const DIRECT_WITHIN = 4; // metres: a walk this short goes straight there, paths or not
const DETOUR_MAX = 2.5; // a way by the paths this many times the straight one is no way: it goes straight

/** The heading (radians; 0 looks along +z) of someone at (x, z) who looks as `face` says; null when nothing says. */
function headingOf(face, x, z) {
  if (!face) return null;
  const [dx, dz] = face.to ? [face.to[0] - x, face.to[1] - z] : face.dir;
  return dx === 0 && dz === 0 ? null : Math.atan2(dx, dz);
}

/**
 * The way along the paths: from a point to the nearest path, along the paths (the shortest way), off again to
 * where it goes. Without paths, or when the paths lie farther off than the place itself or lead a long way
 * round, straight there.
 */
function makeRouter(paths) {
  if (!paths.length) return (from, to) => [to];
  const nodes = [], index = new Map(), segments = [];
  const nodeOf = p => {
    const k = `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
    if (!index.has(k)) { index.set(k, nodes.length); nodes.push({ x: p[0], z: p[1], next: [] }); }
    return index.get(k);
  };
  // Each stretch of a path, cut wherever another stretch meets or crosses it: paths join where they touch,
  // whether or not a point was written there.
  const stretches = paths.flatMap(path => path.slice(1).map((q, i) => [path[i], q])).filter(([p, q]) => dist(p[0], p[1], q[0], q[1]) > 0.001);
  stretches.forEach(([p, q], n) => {
    const dx = q[0] - p[0], dz = q[1] - p[1], cuts = [0, 1];
    stretches.forEach(([r, t], m) => {
      if (m === n) return;
      const ex = t[0] - r[0], ez = t[1] - r[1], cross = dx * ez - dz * ex;
      if (Math.abs(cross) < 1e-9) return; // side by side: they meet at their ends, if at all
      const k = ((r[0] - p[0]) * ez - (r[1] - p[1]) * ex) / cross, u = ((r[0] - p[0]) * dz - (r[1] - p[1]) * dx) / cross;
      if (k > 1e-6 && k < 1 - 1e-6 && u > -1e-6 && u < 1 + 1e-6) cuts.push(k);
    });
    cuts.sort((a, b) => a - b);
    for (let i = 1; i < cuts.length; i++) {
      const a = nodeOf([p[0] + dx * cuts[i - 1], p[1] + dz * cuts[i - 1]]), b = nodeOf([p[0] + dx * cuts[i], p[1] + dz * cuts[i]]);
      if (a === b) continue;
      const len = dist(nodes[a].x, nodes[a].z, nodes[b].x, nodes[b].z);
      nodes[a].next.push([b, len]);
      nodes[b].next.push([a, len]);
      segments.push([a, b, len]);
    }
  });
  if (!segments.length) return (from, to) => [to];
  /** The point of the paths nearest to (x, z): on which segment, and how far along it (0 to 1). */
  function nearest(x, z) {
    let best = null;
    for (let s = 0; s < segments.length; s++) {
      const [a, b, len] = segments[s], A = nodes[a], B = nodes[b];
      const t = Math.max(0, Math.min(1, ((x - A.x) * (B.x - A.x) + (z - A.z) * (B.z - A.z)) / (len * len)));
      const px = A.x + (B.x - A.x) * t, pz = A.z + (B.z - A.z) * t, d = dist(x, z, px, pz);
      if (!best || d < best.d) best = { s, t, x: px, z: pz, d };
    }
    return best;
  }
  return (from, to) => {
    const direct = dist(from[0], from[1], to[0], to[1]);
    if (direct <= DIRECT_WITHIN) return [to];
    const on = nearest(from[0], from[1]), off = nearest(to[0], to[1]);
    if (on.d + off.d >= direct) return [to];
    // The shortest way over the paths' points (Dijkstra), from where it steps on (S) to where it steps off (T).
    const N = nodes.length, S = N, T = N + 1, cost = new Array(N + 2).fill(Infinity), prev = new Array(N + 2).fill(-1), done = new Array(N + 2).fill(false);
    const [sa, sb, slen] = segments[on.s], [ta, tb, tlen] = segments[off.s];
    const fromS = [[sa, on.t * slen], [sb, (1 - on.t) * slen]], toT = new Map([[ta, off.t * tlen], [tb, (1 - off.t) * tlen]]);
    if (on.s === off.s) fromS.push([T, Math.abs(on.t - off.t) * slen]);
    cost[S] = 0;
    for (;;) {
      let u = -1;
      for (let i = 0; i < N + 2; i++) if (!done[i] && (u < 0 || cost[i] < cost[u])) u = i;
      if (u < 0 || cost[u] === Infinity || u === T) break;
      done[u] = true;
      const next = u === S ? fromS : toT.has(u) ? [...nodes[u].next, [T, toT.get(u)]] : nodes[u].next;
      for (const [v, len] of next) if (cost[u] + len < cost[v]) { cost[v] = cost[u] + len; prev[v] = u; }
    }
    if (cost[T] === Infinity || on.d + cost[T] + off.d > direct * DETOUR_MAX) return [to]; // the two paths do not meet, or only a long way round
    const way = [];
    for (let u = prev[T]; u >= 0 && u !== S; u = prev[u]) way.unshift([nodes[u].x, nodes[u].z]);
    const out = [[on.x, on.z], ...way, [off.x, off.z], to];
    return out.filter((p, i) => i === 0 ? dist(from[0], from[1], p[0], p[1]) > 0.01 : dist(out[i - 1][0], out[i - 1][1], p[0], p[1]) > 0.01);
  };
}

/** The ground plan of a world read by readManifest (core/manifest.js). */
export function makeLayout(world) {
  const places = new Map(Object.entries(world.places).map(([name, p]) => [name, { name, label: p.name, face: p.face, spots: p.spots.map(([x, z]) => ({ x, z })) }]));
  const plots = world.plots;
  /** The plot of the repo in bed `bed` (the collector's number for it), or null: no such bed here. */
  const plotAt = bed => (plots && Number.isInteger(bed) && bed >= 0 && bed < plots.at.length ? { bed, x: plots.at[bed][0], z: plots.at[bed][1] } : null);
  /** Where the i-th agent at a plot stands: the plot's work spots in turn; past the last, the same spots a step nearer the viewer. */
  function workSpot(plot, i) {
    const n = plots.work.length, [dx, dz] = plots.work[i % n];
    return { x: plot.x + dx, z: plot.z + dz + Math.floor(i / n) * 1.2 };
  }
  /** The way those at a plot look: "plots.face", a point they look at being measured from the plot's centre. */
  const plotFace = plot => (plots.face?.to ? { to: [plot.x + plots.face.to[0], plot.z + plots.face.to[1]] } : plots.face);
  const first = places.get('wait').spots[0];
  return {
    world, places, plotAt, workSpot,
    plotCount: plots ? plots.at.length : 0,
    spawn: world.spawn ?? [first.x, first.z],
    route: makeRouter(world.paths),
    /** Where someone in `zone` stands at spot `i` (a place's name, or 'plot:<bed>'), or null. */
    spot(zone, i) {
      if (zone.startsWith('plot:')) { const plot = plotAt(Number(zone.slice(5))); return plot ? workSpot(plot, i) : null; }
      return places.get(zone)?.spots[i] ?? null;
    },
    /** The heading (radians; 0 looks along +z) of someone standing at (x, z) in `zone`, or null: the world does not say, and it looks at the viewer. */
    heading(zone, x, z) {
      if (zone.startsWith('plot:')) { const plot = plotAt(Number(zone.slice(5))); return plot ? headingOf(plotFace(plot), x, z) : null; }
      return places.has(zone) ? headingOf(places.get(zone).face, x, z) : null;
    },
  };
}
