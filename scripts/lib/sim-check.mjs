// check-world for a world of api 2: its world.json read as the SDK reads it, the files it names looked for,
// and its simulation (the SDK's, with the world's sim.js) run through every stop of the tour
// (web/worlds/test/tour.js) as the collector runs it: inside QuickJS, where the world's code can reach
// nothing but the language. What it throws is reported with its stop and its line. view.js draws, and
// there is nothing to draw on here: it is read for syntax only, and looked at on the test page.
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { CORE, PLUGINS, loadSimShutIn, syntaxProblem } from '../../collector/live-world.mjs';
import { checkWorldJson } from '../../collector/worlds.mjs';
import { readManifest, unknownFields } from '../../web/worlds/sdk/core/manifest.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WEB = join(ROOT, 'web');
const TOUR = join(WEB, 'worlds', 'test', 'tour.js'), SCENE = join(WEB, 'scene.js');
const CORE_FILES = CORE.map(f => join(WEB, 'worlds', 'sdk', 'core', f));
const QUICKJS = ['quickjs-emscripten-core', '@jitl/quickjs-ffi-types', '@jitl/quickjs-wasmfile-release-sync'].map(p => join(ROOT, 'node_modules', ...p.split('/')));
/** Every file and folder a check reads besides the world's own folder: this module and what it imports, the SDK's simulation, the tour, and QuickJS. */
export const FILES = [fileURLToPath(import.meta.url), join(ROOT, 'package.json'), join(ROOT, 'collector', 'live-world.mjs'), join(ROOT, 'collector', 'worlds.mjs'), join(ROOT, 'scripts', 'lib', 'plain-text.mjs'), ...CORE_FILES, join(WEB, PLUGINS), SCENE, TOUR, ...QUICKJS];
const FRAMES = 8;

/** The tour's stops, each with its scenes as the collector would hand them to the world (JSON; private ones at the private stop). */
function tour() {
  const g = {};
  g.window = g;
  const ctx = vm.createContext(g);
  vm.runInContext(readFileSync(SCENE, 'utf8'), ctx);
  vm.runInContext(readFileSync(TOUR, 'utf8'), ctx);
  return JSON.parse(vm.runInContext('JSON.stringify(window.AgentvilleTour.stops.map(s => ({ name: s.name, scenes: s.frames.map(f => { const scene = window.AgentvilleScene.toScene(f); return JSON.stringify(s.private ? window.AgentvilleScene.privateScene(scene) : scene); }) })))', ctx));
}

/** A file of the world's that must be a regular file really inside its folder: its real path, or null when it is not there; throws when it leads out. */
function inside(dir, name) {
  try { lstatSync(join(dir, name)); } catch { return null; }
  const out = new Error(`${name} is a link out of the world's folder, or not a file.`);
  let real;
  try { real = realpathSync(join(dir, name)); } catch { throw out; } // (a link out of the folder can not even be followed from a contained check)
  if (!real.startsWith(realpathSync(dir) + sep) || !statSync(real).isFile()) throw out;
  return real;
}
/** Such a file's text, or null when it is not there. */
const own = (dir, name) => { const real = inside(dir, name); return real === null ? null : readFileSync(real, 'utf8'); };

/**
 * Checks the world in `dir`. Gives { json (what is wrong with world.json, or null), errors: [{ stop, message, where }],
 * notes: [text] (pointers: they never fail a world), ran (stops run) }.
 */
export async function checkSim({ dir, callMs = 2000 } = {}) {
  const out = { json: null, errors: [], notes: [], ran: 0 };
  let text, j;
  try { text = own(dir, 'world.json'); if (text === null) throw new Error('world.json is missing.'); j = JSON.parse(text); } catch (err) { out.json = err instanceof SyntaxError ? `world.json can't be read: ${err.message}` : err.message; return out; }
  out.json = checkWorldJson(j);
  if (out.json) return out;
  const world = readManifest(j);
  for (const f of unknownFields(j)) out.notes.push(`world.json: "${f}" is not a field this version reads`);
  for (const a of world.assets) { try { if (inside(dir, a) === null) out.errors.push({ stop: '(loading)', message: `${a} is missing.`, where: 'world.json' }); } catch (err) { out.errors.push({ stop: '(loading)', message: err.message, where: 'world.json' }); } }
  const outside = [...Object.entries(world.places).flatMap(([name, p]) => p.spots.map(s => [`places.${name}`, s])), ...(world.plots?.at ?? []).map(s => ['plots', s])].filter(([, [x, z]]) => x < 0 || z < 0 || x > world.ground.w || z > world.ground.d);
  for (const name of new Set(outside.map(o => o[0]))) out.notes.push(`${name} has spots off the ground (${world.ground.w} × ${world.ground.d} m)`);

  let sim = null, view = null;
  try { sim = own(dir, 'sim.js'); view = own(dir, 'view.js'); } catch (err) { out.errors.push({ stop: '(loading)', message: err.message, where: '' }); return out; }
  if (view !== null) {
    const why = await syntaxProblem(view, 'view.js');
    if (why) out.errors.push({ stop: '(loading)', message: `view.js does not parse: ${why.replace(/\s*\(at [\s\S]*$/, '')}`, where: /view\.js:\d+/.exec(why)?.[0] ?? 'view.js' });
    out.notes.push('view.js is read for syntax only: look at what it draws on the test page');
  }
  const core = CORE_FILES.map((f, i) => [CORE[i], readFileSync(f, 'utf8')]), plugins = readFileSync(join(WEB, PLUGINS), 'utf8');
  // What QuickJS says of an error ends in where it was thrown, "(at place (sim.js:3:11))": that goes into `where`, as file and line.
  const problem = (stop, err) => ({ stop, message: String(err?.message ?? err).replace(/\s*\(at [\s\S]*$/, ''), where: /sim\.js:\d+/.exec(String(err?.message ?? err))?.[0] ?? '' });
  const full = new Map(), said = new Set(); // zone → { more, stop }: the most it was over, and where
  let hidden = null;
  for (const stop of tour()) {
    let box;
    try { box = await loadSimShutIn({ core, plugins, manifest: text, sim, callMs }); } catch (err) { out.errors.push(problem('(loading)', err)); break; } // sim.js throws as it loads: every stop would say the same
    try {
      let st = null, shown = 0;
      for (const scene of stop.scenes) { box.scene(scene); st = box.step(FRAMES); shown = JSON.parse(scene).agents.length; }
      out.ran++;
      for (const line of st.said ?? []) said.add(line);
      for (const [zone, more] of Object.entries(st.over ?? {})) if (more > (full.get(zone)?.more ?? 0)) full.set(zone, { more, stop: stop.name });
      const missing = shown - st.bodies.length - Object.values(st.over ?? {}).reduce((t, n) => t + n, 0);
      if (missing > 0 && (!hidden || missing > hidden.n)) hidden = { n: missing, stop: stop.name };
    } catch (err) {
      out.errors.push(problem(stop.name, err));
      if (/did not answer/.test(err?.message) && out.errors.filter(e => /did not answer/.test(e.message)).length >= 3) { out.errors.push({ stop: '(stopped)', message: 'three stops did not answer: the rest of the tour was skipped', where: '' }); box.stop(); break; }
    }
    box.stop();
  }
  for (const [zone, { more, stop }] of full) out.notes.push(`${zone} has ${more} more than it has spots at "${stop}": they are counted, not shown`);
  if (hidden) out.notes.push(`${hidden.n} not shown at "${hidden.stop}": sim.js's place() gave them no place`);
  for (const line of [...said].slice(0, 5)) out.notes.push(`its console: ${line}`);
  return out;
}
