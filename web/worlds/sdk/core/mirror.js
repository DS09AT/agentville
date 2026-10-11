// What the collector says a world looks like, twenty times a second, played back a moment late: of the two
// states either side of the moment shown, everyone is put part of the way between, so they glide though the
// states come in steps. A browser shows a world the collector moves through this. No DOM and no three.js.

const LEAP_M = 0.75; // two states this far apart are no step: it was put somewhere, and is shown there at the half

/** Two points a state apart, part of the way (k, 0 to 1). */
export const glide = (x0, z0, x1, z1, k) => (Math.abs(x1 - x0) + Math.abs(z1 - z0) > LEAP_M ? (k < 0.5 ? [x0, z0] : [x1, z1]) : [x0 + (x1 - x0) * k, z0 + (z1 - z0) * k]);

/**
 * States (core/wire.js, fromWire) in, the world at a moment out. `reach(state)` is called with each state as
 * its moment comes, in order, once: what the world itself shares (its `w` and `wk`) is taken there. `delay` (s): how
 * late the world is shown, so that there is a state on either side.
 */
export function makeMirror(reach = () => {}, delay = 0.1) {
  const buf = [];
  let skew = null;
  const use = st => { if (!st.used) { st.used = true; reach(st); } };
  return {
    get ready() { return buf.length > 0; },
    /** A state has come; `now` is this page's clock (s). */
    push(st, now) {
      const d = now - st.t;
      skew = skew == null || d < skew ? d : skew + (d - skew) * 0.02; // the quickest state to arrive says how the clocks stand; a slow drift is followed
      const next = { ...st, byId: new Map(st.bodies.map(b => [b.id, b])) };
      if (buf.length && st.t === buf.at(-1).t) { // the same moment again (someone joined the room): the newer word for it, with what the older one alone said of the world's own things
        const old = buf.at(-1);
        if (old.used) { next.used = true; reach(st); } else { next.w = old.w || st.w ? { ...old.w, ...st.w } : null; next.wk = st.wk ?? old.wk ?? null; }
        buf[buf.length - 1] = next;
        return;
      }
      if (buf.length && st.t < buf.at(-1).t) { for (const o of buf) use(o); buf.length = 0; skew = d; } // its clock went back: a new room
      buf.push(next);
      while (buf.length > 8) use(buf.shift());
    },
    /** The world at this moment, or null before the first state. `still`: as it comes to stand, everyone where they are going. */
    at(now, still = false) {
      if (!buf.length) return null;
      const last = buf.at(-1), rt = still ? last.t : Math.max(buf[0].t, Math.min(last.t, now - skew - delay));
      let i = buf.length - 1;
      while (i > 0 && buf[i].t > rt) i--;
      const p = buf[i], q = buf[Math.min(i + 1, buf.length - 1)], k = q.t > p.t ? (rt - p.t) / (q.t - p.t) : 0;
      for (let n = 0; n <= i; n++) use(buf[n]);
      const bodies = p.bodies.map(b => {
        if (still) return { ...b, x: b.tx, z: b.tz, walk: false };
        const z = q.byId.get(b.id), [x, zz] = z ? glide(b.x, b.z, z.x, z.z, k) : [b.x, b.z];
        return { ...b, x, z: zz };
      });
      return { t: rt, wall: p.wall == null ? null : p.wall + (rt - p.t) * 1000, bodies, flights: p.flights, over: p.over };
    },
  };
}
