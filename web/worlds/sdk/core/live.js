// The simulation as the collector calls it: text in, text out. A world of api 2 is moved inside QuickJS, in a
// thread of its own (collector/live-world.mjs, loadSimShutIn), and only strings cross that border: the
// world's manifest and each scene come in as JSON, each state goes out as JSON, in the room's own measure
// (core/wire.js). No DOM and no three.js.
import { readManifest } from './manifest.js';
import { makeSim } from './sim.js';
import { toWire } from './wire.js';

/**
 * `manifest`: the text of a world.json of api 2; `hooks`: the world's sim.js, or {}; `stepS`: how long one step
 * is (s); `said()`: what the world wrote to its console since the last step (a few lines), handed out with the state.
 */
export function makeLiveSim(manifest, hooks, stepS, { said = () => [], now } = {}) {
  const sim = makeSim(readManifest(JSON.parse(manifest)), hooks, now ? { now } : {});
  return {
    scene(json) { sim.scene(JSON.parse(json)); return 'null'; },
    step(n) { for (let i = 0; i < n; i++) sim.step(stepS); return JSON.stringify({ ...toWire(sim.state()), said: said() }); },
    // A world of api 2 has no animals yet: nothing to ask, no one to touch.
    ask() { return '{"ok":false,"why":"gone"}'; },
    touch() { return 'false'; },
  };
}
