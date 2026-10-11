// A world from your folder, moved for everyone who watches: its code is yours, not the collector's, so it runs
// here, in a thread of its own, inside QuickJS (live-world.mjs, loadWorldShutIn): a JavaScript engine in
// WebAssembly, where there is no file, no network, no program and no environment to reach, on any system. The
// collector hands this thread the text of the SDK and of the world's world.js, and never a name or a word: it
// makes the world's scene private first. The two talk in messages:
//   in:  { i, f, a }  call f ('scene', 'step', 'ask', 'touch') with a; i is the call's number
//   out: { i, o }     what it returned, or { i, e } what it threw
// The first out, { i: 0 }, says the world is loaded (or why not). A world that hangs is cut off inside QuickJS,
// and the collector ends the thread besides; its browsers move it themselves from then on.
import { parentPort, workerData } from 'node:worker_threads';
import { loadWorldShutIn } from './live-world.mjs';

let world = null;
try {
  world = await loadWorldShutIn(workerData);
  parentPort.postMessage({ i: 0, o: true });
} catch (err) {
  parentPort.postMessage({ i: 0, e: String(err?.message ?? err).slice(0, 300) });
}
parentPort.on('message', m => {
  if (!world || typeof world[m?.f] !== 'function') { parentPort.postMessage({ i: m?.i, e: 'no such call' }); return; }
  try { parentPort.postMessage({ i: m.i, o: world[m.f](m.a) }); } catch (err) { parentPort.postMessage({ i: m.i, e: String(err?.message ?? err).slice(0, 300) }); }
});
