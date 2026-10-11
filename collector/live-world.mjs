// A world run without a page: never drawn, stepped by hand.
//
// A world of api 2 is moved by the SDK's simulation (web/worlds/sdk/core/), with the world's sim.js for its
// own rules. It runs in QuickJS, a JavaScript engine compiled to WebAssembly (loadSimShutIn), in a thread of
// its own (live-child.mjs): inside it there is nothing but JavaScript itself, no file, no network, no program,
// no environment, on macOS, Linux and Windows alike. Built-in worlds and yours run the same way.
//
// LEGACY: a world of the pixel engine is its frame's scripts and its world.js. The built-in ones run in the
// collector's own process, in a node:vm context (loadWorld); one from your folder in QuickJS (loadWorldShutIn).
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const TICK_MS = 50, STEP_S = TICK_MS / 1000;
/** The SDK's simulation: the modules of web/worlds/sdk/core/ a world of api 2 is moved with, and what its sim.js registers with. */
export const CORE = ['util.js', 'steps.js', 'manifest.js', 'events.js', 'layout.js', 'sim.js', 'wire.js', 'live.js'];
export const PLUGINS = 'worlds/sdk/plugins.js';
/** LEGACY: the pixel engine's frame scripts before world.js, in its frame.html's order. */
export const SDK = ['worlds/legacy/pixel.js', 'worlds/legacy/people.js', 'worlds/legacy/props.js', 'worlds/legacy/creatures.js', 'worlds/legacy/animals.js', 'worlds/sdk/grid.js', 'worlds/legacy/engine.js'];

/**
 * LEGACY. The world of the pixel engine in `worldFile`, loaded with its frame's scripts from `webDir`. `scenes`: 'snapshot' when it is given the dashboard's
 * snapshot (as JSON) and makes its scene from it (scene.js is loaded too), 'made' when it is given a scene already
 * made (a private one). Plain data goes in and out. `timeout` (ms), when given, cuts off a call that never returns
 * (the collector's own process must not hang; a shut-in process is killed from outside instead).
 */
export function loadWorld({ webDir, worldFile, scenes = 'snapshot', timeout = null, warn = () => {} }) {
  // As in a frame, the window is the scripts' global: a world may write Agentville.world(…) or window.Agentville.world(…).
  const window = { Agentville: { raw() {} }, devicePixelRatio: 1, console: { log() {}, info() {}, debug() {}, warn: m => warn(String(m)), error: m => warn(String(m)) } };
  window.window = window;
  const context = vm.createContext(window);
  const run = (code, filename) => vm.runInContext(code, context, { filename, ...(timeout ? { timeout: 2000 } : {}) });
  for (const f of [...(scenes === 'snapshot' ? ['scene.js'] : []), ...SDK]) run(readFileSync(join(webDir, f), 'utf8'), f);
  run('window.Agentville.world = hooks => { window.hooks = hooks; };', 'live');
  run(readFileSync(worldFile, 'utf8'), 'world.js');
  run(`(() => {
    if (!window.hooks) throw new Error('it draws itself (Agentville.raw): there is nothing here to move');
    const th = withDefaults(window.hooks), fx = [];
    const view = makePixelView(th, { get: () => null, set() {} }, { headless: true, onFx: e => fx.push(e) });
    window.sim = {
      scene(json) { view.update(th.fromScene(${scenes === 'snapshot' ? 'window.AgentvilleScene.toScene(JSON.parse(json))' : 'JSON.parse(json)'})); },
      chatter(json) { view.chatter(JSON.parse(json)); },
      step(n) { for (let i = 0; i < n; i++) view.step(${STEP_S}); const st = view.state(); st.fx = fx.splice(0); return st; },
      ask(json) { return JSON.stringify(view.ask(JSON.parse(json))); },
      touch(id) { return view.touch(id); },
    };
  })();`, 'live');
  const call = new vm.Script('window.out = window.sim[window.fn](window.arg);', { filename: 'live' });
  const sim = (fn, arg, ms) => { window.fn = fn; window.arg = arg; call.runInContext(context, timeout ? { timeout: ms ?? timeout } : {}); return window.out; };
  return {
    /** The scene, from the snapshot (or the scene made of it), as JSON. */
    scene: json => sim('scene', json, 1000),
    chatter: lines => sim('chatter', JSON.stringify(lines ?? [])),
    /** n steps on; how the world stands then (engine.js, state()), with what there is to show since the last call (fx). */
    step: n => sim('step', n),
    ask: a => JSON.parse(sim('ask', JSON.stringify(a))),
    touch: id => Boolean(sim('touch', String(id))),
  };
}

const CALLS = ['scene', 'step', 'ask', 'touch'];

/**
 * QuickJS with a memory of its own, to run a world's code shut in. `memoryMb` is all it may hold. Gives
 * { run(code, filename, ms, how?), give(name, value), modules(texts), stop() }: `run` gives the string the code
 * ends in (anything else: null) and throws what it threw, or 'it did not answer' when it took longer than `ms`.
 */
async function shutIn(memoryMb) {
  const [{ newQuickJSWASMModuleFromVariant, newVariant, shouldInterruptAfterDeadline }, { default: variant }] = await Promise.all([import('quickjs-emscripten-core'), import('@jitl/quickjs-wasmfile-release-sync')]);
  // A WebAssembly module of its own, with a memory of its own that can grow to memoryMb and no further: the engine
  // then has no more to give, and the world gets "out of memory". (QuickJS's own limit does not count what it holds
  // in this build, only how large one piece may be: it is set too, so no single piece is the whole of it.)
  const memory = new WebAssembly.Memory({ initial: 256, maximum: memoryMb * 16 }); // in pages of 64 KiB
  const QuickJS = await newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: memory }));
  const runtime = QuickJS.newRuntime();
  runtime.setMemoryLimit(memoryMb * 1024 * 1024 / 4);
  runtime.setMaxStackSize(1024 * 1024);
  const context = runtime.newContext();
  return {
    /** `how`: 'global' (a script), 'module', or 'compile' (a script that is read, and not run). */
    run(code, filename, ms, how = 'global') {
      runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms));
      const result = context.evalCode(code, filename, how === 'compile' ? { type: 'global', compileOnly: true } : { type: how });
      if (result.error) {
        const err = context.dump(result.error);
        result.error.dispose();
        throw new Error(typeof err === 'object' && err ? `${err.name === 'InternalError' && err.message === 'interrupted' ? 'it did not answer' : String(err.message ?? err.name ?? 'error')}${err.stack && err.message !== 'interrupted' ? ` (${String(err.stack).trim().split('\n')[0].trim()})` : ''}` : String(err));
      }
      const out = context.typeof(result.value) === 'string' ? context.getString(result.value) : null;
      result.value.dispose();
      const jobs = runtime.executePendingJobs(); // what its promises wait to do, as a page would after each task (within the same time)
      if (jobs.error) jobs.error.dispose(); // a rejection no one caught: the world's own business
      return out;
    },
    give(name, value) { const h = typeof value === 'number' ? context.newNumber(value) : context.newString(String(value)); context.setProp(context.global, name, h); h.dispose(); },
    /** The modules its code may import, by name, as text: these and no others. */
    modules(texts) { runtime.setModuleLoader(name => (texts.has(name) ? texts.get(name) : { error: new Error(`no module ${name}`) })); },
    stop() { try { context.dispose(); runtime.dispose(); } catch { /* it holds what it holds: its thread ends with it */ } },
  };
}

// As in a frame, the window is the scripts' global. What the world writes to its console is kept (a little) and handed out with its next step.
const WINDOW = `globalThis.window = globalThis; window.Agentville = { raw() {} }; window.devicePixelRatio = 1; window.__said = [];
  { const say = m => { if (window.__said.length < 20) window.__said.push(String(m).slice(0, 300)); }; window.console = { log() {}, info() {}, debug() {}, warn: say, error: say }; }`;

/** What the room calls a world shut in with: { scene, step, ask, touch, stop }. Text is all that goes in or out. */
function callsOf(box, callMs) {
  const call = (fn, arg) => {
    if (!CALLS.includes(fn)) throw new Error('no such call');
    box.give('arg', arg);
    return JSON.parse(box.run(`window.sim.${fn}(window.arg)`, 'live', callMs) ?? 'null');
  };
  return {
    scene: json => call('scene', String(json)),
    step: n => call('step', Number(n) || 0),
    ask: a => call('ask', JSON.stringify(a ?? {})),
    touch: id => Boolean(call('touch', String(id))),
    stop: () => box.stop(),
  };
}

/**
 * A world of api 2, inside QuickJS: the SDK's simulation (`core`: [[name, text]], the modules of CORE) on the
 * world's `manifest` (the text of its world.json), with its `sim` (the text of its sim.js, or null) registered
 * through `plugins` (the text of PLUGINS). It is given scenes already made and answers in JSON. A call that takes
 * longer than `callMs` is cut off (and throws: the world is done for then). Throws what the world threw while loading.
 */
export async function loadSimShutIn({ core, plugins, manifest, sim = null, memoryMb = 64, loadMs = 3000, callMs = 800 }) {
  const box = await shutIn(memoryMb);
  try {
    box.run(WINDOW, 'live', loadMs);
    box.run(plugins, 'plugins.js', loadMs);
    if (sim !== null) box.run(sim, 'sim.js', loadMs);
    box.modules(new Map(core.map(([name, code]) => [`core/${name}`, code])));
    box.give('__manifest', manifest);
    box.run(`import { makeLiveSim } from './live.js';
      globalThis.sim = makeLiveSim(globalThis.__manifest, globalThis.Agentville.plugins.sim ?? {}, ${STEP_S}, { said: () => globalThis.__said.splice(0) });`, 'core/shut-in.js', loadMs, 'module');
    if (box.run('typeof globalThis.sim', 'live', loadMs) !== 'object') throw new Error('its simulation did not start');
  } catch (err) {
    box.stop();
    throw err;
  }
  return callsOf(box, callMs);
}

/**
 * LEGACY. A world of the pixel engine in the text `world`, with its frame's scripts (`sdk`: [[name, text]], in the
 * frame's order), inside QuickJS. It is given a scene already made (a private one) and answers in JSON. Throws
 * what the world threw while loading.
 */
export async function loadWorldShutIn({ sdk, world, memoryMb = 64, loadMs = 3000, callMs = 800 }) {
  const box = await shutIn(memoryMb);
  try {
    box.run(WINDOW, 'live', loadMs);
    for (const [name, code] of sdk) box.run(code, name, loadMs);
    box.run('window.Agentville.world = hooks => { window.hooks = hooks; };', 'live', loadMs);
    box.run(world, 'world.js', loadMs);
    box.run(`(() => {
      if (!window.hooks) throw new Error('it draws itself (Agentville.raw): there is nothing here to move');
      const th = withDefaults(window.hooks), fx = [];
      const view = makePixelView(th, { get: () => null, set() {} }, { headless: true, onFx: e => fx.push(e) });
      window.sim = {
        scene(json) { view.update(th.fromScene(JSON.parse(json))); return 'null'; },
        step(n) { for (let i = 0; i < n; i++) view.step(${STEP_S}); const st = view.state(); st.fx = fx.splice(0); st.said = window.__said.splice(0); return JSON.stringify(st); },
        ask(json) { return JSON.stringify(view.ask(JSON.parse(json))); },
        touch(id) { return JSON.stringify(Boolean(view.touch(id))); },
      };
    })();`, 'live', loadMs);
  } catch (err) {
    box.stop();
    throw err;
  }
  return callsOf(box, callMs);
}

/** What keeps a script from being read as JavaScript (its first syntax error, with its line), or null: it is read shut in, and never run. */
export async function syntaxProblem(code, filename) {
  const box = await shutIn(16);
  try { box.run(code, filename, 2000, 'compile'); return null; } catch (err) { return err.message; } finally { box.stop(); }
}
