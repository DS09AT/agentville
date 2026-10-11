// One world for everyone who watches: the collector moves a world (its agents' walks, its animals, their gags,
// what is asked of them, and the world's own things) and tells every browser where everyone is, so all who look
// at the dashboard see the same thing at the same moment. The world's own code runs as it runs in a browser's
// frame (the SDK and world.js, never drawn), twenty steps a second, and only while someone watches. Colyseus
// carries it: a room for each world, its state sent as binary changes.
//
// A built-in world's code is this repo's: it runs in the collector's own process (live-world.mjs). A world from
// your folder is yours: it runs shut in, inside QuickJS (a JavaScript engine in WebAssembly, the same on every
// system) in a thread of its own (spawnWorld, live-child.mjs), started when the first browser shows it and
// stopped when the last one leaves, a few at a time at most.
//
// What goes out is made from the guest's snapshot (server.mjs, guestSnapshot): who is where, in what state,
// with what tool. Nothing an agent or you said is in a room, so a guest's room and yours are the same room. A
// world from your folder is given less still: the private scene (numbers for names), made here, before it gets
// it. The helper's lines for the animals are written from what goes on here: they go to this computer's own browser
// only (a message beside the state); a guest reads the world's own line in their place.
//
// Anyone watching may ask an animal for one of its actions (an agent walks over and does it, for all to see):
// it moves no agent and reaches nothing but the world's own figures. Everything an agent can be asked stays
// on the dashboard's HTTP actions, which a guest can't call. A room also says who is watching: each browser
// once, under a name the room gives it and its user may change.
import vm from 'node:vm';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { matchMaker, Room } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { schema, t } from '@colyseus/schema';
import { loadWorld, SDK, TICK_MS } from './live-world.mjs';

/** The built-in worlds: their code is this repo's, and runs in the collector's own process. */
export const LIVE_WORLDS = ['farm', 'factory'];
/** A world from your folder: its key. */
export const OWN_WORLD = /^u\/[a-z0-9][a-z0-9-]{0,39}$/;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const ACT_GAP_MS = 300, JOBS_EACH = 4; // one thing asked of the animals at a time, and so many under way, for each one watching
const NAME_GAP_MS = 1000, NAME_MAX = 24; // a name changed once a second at most, and so long
const REPLIES_MAX = 500, REPLY_MS = 120_000; // answers kept, so a thing asked twice (its rid) is done once
const GONE_MS = 4000; // a browser that left (a reload, a dropped connection) keeps its place among the watchers this long
const OWN_MAX = 6; // worlds from your folder moved at once (a thread each); a seventh is moved by its own browsers until one stops
const OWN_FAILS = 3, OWN_REST_MS = 300_000; // a world of yours that failed this often is left alone this long
const CHILD = new URL('./live-child.mjs', import.meta.url);

// An agent: where it is and where it is going (x, y in eighths of a world pixel; tx, ty in pixels), its bits
// (1 walking, 2 its hat off, 4 away at an animal, 8|16 the way it faces, 32|64 the way it steps) and its zone.
const Body = schema({ x: t.int16(), y: t.int16(), tx: t.int16(), ty: t.int16(), bits: t.uint8(), zone: t.string() }, 'Body');
// An animal: where it is (eighths), its bits (animals.js, state()), its pose, how high it sits, the den it sleeps in (-1: none).
const Animal = schema({ x: t.int16(), y: t.int16(), bits: t.uint8(), pose: t.string(), lift: t.uint8(), den: t.int8() }, 'Animal');
// Someone watching: its name, whether it is this computer's own browser, since when (ms), and whether it looks just now (a tab in sight).
const Viewer = schema({ name: t.string(), host: t.boolean(), since: t.float64(), on: t.boolean() }, 'Viewer');
const WorldState = schema({
  t: t.float64(), // the world's clock, in seconds
  wall: t.float64(), // the collector's time of day at that moment (ms): what goes by the clock goes by this one, in every browser
  flights: t.string(), // messages on their way between agents, as JSON: [[from, to, when it set off (the world's clock)]]
  bodies: t.map(Body),
  animals: t.map(Animal),
  says: t.map('string'), // animal id → the line it says
  taken: t.string(), // what the animals have taken ('bucket')
  over: t.string(), // how many stand over each place's cap, as JSON
  spare: t.uint8(), // how many of those could step out for a job
  jobs: t.uint8(), // the jobs under way
  shared: t.map('string'), // what the world itself shares (its share() hook): key → JSON
  viewers: t.map(Viewer), // who is watching, each browser once: its number in this room → who it is
  names: t.string(), // a world from your folder: the stand-ins its private scene uses (JSON, [[what, stand-in]]), so every page's are the same
}, 'WorldState');

const instances = new Map(); // a tracker server's side of this, by its id
let booted = null, seq = 0;
/** The matchmaker, set up once for this process: the first time someone watches. */
function boot() {
  booted ??= (async () => {
    await matchMaker.setup();
    matchMaker.defineRoomType('world', WorldRoom).filterBy(['world', 'live']);
    await matchMaker.accept();
  })();
  return booted;
}

/** A built-in world, run in this process without a page. Every call in is cut off when it never returns. */
export function makeWorld(key, webDir, { warn = () => {} } = {}) {
  if (!LIVE_WORLDS.includes(key)) throw new Error(`no such world: ${key}`);
  return loadWorld({ webDir, worldFile: join(webDir, 'worlds', key, 'world.js'), scenes: 'snapshot', timeout: 250, warn });
}

/* ---------- a world from your folder: a thread of its own, shut in ---------- */

let threads = 0;
/**
 * A world from your folder, started in a thread of its own, inside QuickJS: what makeWorld gives, but every call
 * answers later (a promise), and one that is not answered in time ends the thread. The thread is handed the text
 * of the SDK and of world.js, and nothing else: no environment, no arguments, a small heap. `onGone(why)` when it
 * is no more.
 */
export function spawnWorld({ worldFile, webDir, warn = () => {}, onGone = () => {} }) {
  const workerData = { sdk: SDK.map(f => [f, readFileSync(join(webDir, f), 'utf8')]), world: readFileSync(worldFile, 'utf8') };
  const worker = new Worker(CHILD, { workerData, env: {}, argv: [], execArgv: [], stdin: false, stdout: true, stderr: true, resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
  worker.stdout.resume(); // (nothing of ours writes there: read away, never shown)
  worker.stderr.resume();
  const waiting = new Map(); // call number → { resolve, reject, timer }
  const thread = ++threads;
  let n = 0, gone = null;
  const end = why => {
    if (gone) return;
    gone = why;
    for (const w of waiting.values()) { clearTimeout(w.timer); w.reject(new Error(why)); }
    waiting.clear();
    void worker.terminate().catch(() => {});
    onGone(why);
  };
  const expect = (i, ms) => new Promise((resolve, reject) => waiting.set(i, { resolve, reject, timer: setTimeout(() => end('it did not answer'), ms) }));
  worker.on('message', m => {
    const w = waiting.get(m?.i);
    if (!w) return;
    waiting.delete(m.i);
    clearTimeout(w.timer);
    if ('e' in m) { w.reject(new Error(String(m.e))); if (m.e === 'it did not answer') end('it did not answer'); } // cut off inside QuickJS: half a step is no state to go on from
    else w.resolve(m.o);
  });
  worker.on('error', err => end(`it could not run: ${err.message}`));
  worker.on('exit', () => end('it stopped'));
  const ready = expect(0, 5000); // the thread says so once the world is loaded
  ready.catch(() => {});
  const call = (f, a, ms = 1000) => {
    if (gone) return Promise.reject(new Error(gone));
    const i = ++n, answer = expect(i, ms);
    worker.postMessage({ i, f, a });
    return answer;
  };
  return {
    ready, thread, alive: () => !gone,
    scene: json => call('scene', json, 2000), chatter: () => Promise.resolve(), // (no helper's lines: they are written from what is said here)
    step: async k => { const st = await call('step', k); for (const line of Array.isArray(st?.said) ? st.said.slice(0, 20) : []) warn(String(line).slice(0, 300)); return st; },
    ask: a => call('ask', a), touch: id => call('touch', String(id)),
    stop: () => end('stopped'),
  };
}

/**
 * Scenes for the worlds from your folder: private ones (web/scene.js, privateScene), made here so their processes
 * never hold a name. One table of stand-ins for this collector: every room's world, and every page, numbers alike.
 */
function makePrivatizer(webDir) {
  const window = {};
  const context = vm.createContext({ window });
  vm.runInContext(readFileSync(join(webDir, 'scene.js'), 'utf8'), context, { filename: 'scene.js' });
  vm.runInContext('window.priv = json => JSON.stringify(window.AgentvilleScene.privateScene(window.AgentvilleScene.toScene(JSON.parse(json)))); window.names = () => JSON.stringify(window.AgentvilleScene.standIns());', context);
  return { scene: json => window.priv(json), names: () => window.names() };
}

/* ---------- what a world from your folder says is looked at before it goes on to anyone ---------- */

const num = (v, lo, hi) => (Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : 0);
const text = (v, max) => String(v ?? '').slice(0, max);
const rows = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter(Array.isArray) : []);
/** A state as engine.js makes it (state()), from a process that may say anything: kept to what a state is, and to sizes that are a world's. */
export function cleanState(st) {
  const fx = (Array.isArray(st?.fx) ? st.fx : []).slice(0, 40).map(e => (Array.isArray(e?.pop)
    ? { pop: [num(e.pop[0], -2000, 4000), num(e.pop[1], -2000, 4000), text(e.pop[2], 40), text(e.pop[3], 12)] }
    : Array.isArray(e?.at) ? { fx: text(e.fx, 16), at: [num(e.at[0], -2000, 4000), num(e.at[1], -2000, 4000)] } : null)).filter(Boolean);
  const shared = {};
  for (const [k, v] of Object.entries(st?.shared && typeof st.shared === 'object' ? st.shared : {}).slice(0, 16)) {
    if (!/^[a-z][a-zA-Z0-9]{0,23}$/.test(k)) continue;
    let json;
    try { json = JSON.stringify(v); } catch { continue; }
    if (json !== undefined && json.length <= 16_384) shared[k] = v;
  }
  const over = {};
  for (const [k, v] of Object.entries(st?.over && typeof st.over === 'object' ? st.over : {}).slice(0, 32)) over[text(k, 60)] = num(v, 0, 9999);
  return {
    t: num(st?.t, 0, 1e9), wall: num(st?.wall, 0, 1e15),
    flights: rows(st?.flights, 20).map(f => [text(f[0], 200), text(f[1], 200), num(f[2], 0, 1e9)]),
    bodies: rows(st?.bodies, 400).map(b => [text(b[0], 200), num(b[1], -4000, 4000), num(b[2], -4000, 4000), num(b[3], -4000, 4000), num(b[4], -4000, 4000), num(b[5], 0, 255) | 0, text(b[6], 200)]),
    animals: st?.animals && typeof st.animals === 'object' ? {
      ones: rows(st.animals.ones, 200).map(a => [text(a[0], 24), num(a[1], -4000, 4000), num(a[2], -4000, 4000), num(a[3], 0, 255) | 0, text(a[4], 24), num(a[5], 0, 255), num(a[6], -1, 100) | 0]),
      says: rows(st.animals.says, 4).map(s => [text(s[0], 24), text(s[1], 40), s[2] === null ? null : text(s[2], 40)]),
      taken: (Array.isArray(st.animals.taken) ? st.animals.taken : []).slice(0, 8).map(k => text(k, 16)),
    } : null,
    over, spare: num(st?.spare, 0, 255) | 0,
    jobs: (Array.isArray(st?.jobs) ? st.jobs : []).slice(0, 60).map(j => ({ by: typeof j?.by === 'string' ? j.by.slice(0, 40) : null })),
    shared, fx,
  };
}

/* ---------- who is watching ---------- */

const FIRST = ['Amber', 'Brisk', 'Calm', 'Dapper', 'Eager', 'Fair', 'Gentle', 'Hazel', 'Ivory', 'Jolly', 'Keen', 'Lucky', 'Merry', 'Nimble', 'Olive', 'Proud', 'Quiet', 'Russet', 'Sunny', 'Tidy', 'Umber', 'Vivid', 'Witty', 'Young'];
const SECOND = ['Badger', 'Crane', 'Dove', 'Egret', 'Finch', 'Goat', 'Heron', 'Ibis', 'Jay', 'Kestrel', 'Lark', 'Marten', 'Newt', 'Otter', 'Plover', 'Quail', 'Robin', 'Stoat', 'Tern', 'Vole', 'Wren', 'Yak'];
const hashOf = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
/** A name as someone may give it: one line of plain text, its spaces single, 24 characters at most; '' when nothing is left. */
export function plainName(v) {
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX).trim();
}
/** That name, or it with the first number after it that no one else here has ("Sam", "Sam 2"…): names are told apart whatever their capitals. */
export function freeName(name, taken) {
  const has = n => taken.some(o => o.toLowerCase() === n.toLowerCase());
  if (!has(name)) return name;
  for (let k = 2; ; k++) { const n = `${name.slice(0, NAME_MAX - String(k).length - 1).trim()} ${k}`; if (!has(n)) return n; }
}
/** The name a browser is given: two words picked by its own key, so it is the same when it comes back. */
export const givenName = key => { const h = hashOf(String(key)); return `${FIRST[h % FIRST.length]} ${SECOND[(h >>> 8) % SECOND.length]}`; };

const eighths = v => Math.max(-32768, Math.min(32767, Math.round(v * 8)));
const whole = v => Math.max(-32768, Math.min(32767, Math.round(v)));
/** A field set only when it changed: an unchanged one is not sent again. */
const put = (o, k, v) => { if (o[k] !== v) o[k] = v; };
const ANIMAL = /^[a-z]{1,16}-\d{1,3}$/, RID = /^[\w-]{1,40}$/;

class WorldRoom extends Room {
  async onCreate(options) {
    const live = instances.get(options?.live);
    if (!live) throw new Error('no such dashboard');
    this.live = live;
    this.key = options.world;
    this.own = OWN_WORLD.test(this.key); // a world from your folder: a thread of its own
    this.state = new WorldState();
    Object.assign(this.state, { t: 0, wall: Date.now(), flights: '[]', taken: '', over: '{}', spare: 0, jobs: 0, names: '[]' });
    this.patchRate = TICK_MS;
    this.autoDispose = true;
    this.maxClients = 1000; // one room for a world, whoever watches: a second room would be a second world
    this.maxMessagesPerSecond = 30; // more than that from one browser and it is cut off
    this.late = 0; // time not yet stepped (ms)
    this.failed = 0;
    this.busy = false; // a step asked of a world's process, not answered yet
    this.asked = []; // the jobs under way: { by, … } (engine.js, state())
    this.replies = new Map(); // rid → { at, re }
    this.pending = new Map(); // rid → the answer on its way (a world in a thread of its own answers later)
    this.lines = new Map(); // animal id → the helper's line it says (for this computer's browser only)
    this.chatterAt = null;
    this.watchers = new Map(); // a browser's own key → { id (its number here), clients: Set, gone: timer }
    this.nextViewer = 0;
    if (this.own) {
      const file = live.ownFile(this.key);
      if (!file) throw new Error('no such world');
      this.sim = live.start(this.key, file, why => { if (this.sim) { this.sim = null; live.log(`live: ${this.key} is moved by its browsers again: ${why}`); try { this.disconnect().catch(() => {}); } catch { /* still being made */ } } });
      await this.sim.ready;
    } else {
      this.sim = makeWorld(this.key, live.webDir, { warn: m => live.log(`live: ${this.key}: ${m}`) });
    }
    live.rooms.add(this);
    await this.feed(live.guestJson(), live.chatter());
    try { const st = await this.sim.step(0); this.show(this.own ? cleanState(st) : st); } catch (err) { this.fail(err); } // how it stands now: whoever joins is told at once, not a step later
    this.onMessage('act', (client, m) => this.act(client, m));
    this.onMessage('touch', (client, m) => this.touched(client, m));
    this.onMessage('name', (client, m) => this.named(client, m));
    this.onMessage('see', (client, m) => this.seen(client, m));
    this.setSimulationInterval(ms => this.tick(ms), TICK_MS);
  }
  /** Who it is: this computer's own browser (the dashboard's token, from this computer), or a guest. The address is the socket's (createLive strips the headers that could say otherwise). */
  onAuth(client, options, context) {
    const live = instances.get(options?.live);
    if (!live) throw new Error('no such dashboard');
    return { host: LOOPBACK.has(context?.ip) && typeof options.token === 'string' && options.token === live.token };
  }
  onJoin(client, options, auth) {
    const host = auth?.host === true, key = typeof options?.viewer === 'string' && /^[\w-]{8,64}$/.test(options.viewer) ? options.viewer : `one-${client.sessionId}`;
    client.userData = { at: 0, host, key, on: options?.on !== false };
    let w = this.watchers.get(key);
    if (!w) {
      w = { id: `v${++this.nextViewer}`, clients: new Set(), gone: null };
      this.watchers.set(key, w);
      const v = new Viewer(), others = [...this.state.viewers.values()].map(o => o.name);
      Object.assign(v, { name: freeName(plainName(options?.name) || givenName(key), others), host, since: Date.now(), on: true });
      this.state.viewers.set(w.id, v);
    }
    clearTimeout(w.gone);
    w.gone = null;
    w.clients.add(client);
    this.look(w);
    client.send('you', { id: w.id, host });
    if (host && this.lines.size) client.send('says', [...this.lines]);
  }
  onLeave(client) {
    const key = client.userData?.key, w = this.watchers.get(key);
    if (!w) return;
    w.clients.delete(client);
    this.look(w);
    if (w.clients.size) return;
    w.gone = setTimeout(() => { // not back (a reload is back in a moment): it watches no more
      if (w.clients.size) return;
      this.watchers.delete(key);
      this.state.viewers.delete(w.id);
    }, GONE_MS);
    w.gone.unref?.();
  }
  onDispose() {
    for (const w of this.watchers.values()) clearTimeout(w.gone);
    this.live?.rooms.delete(this);
    const sim = this.sim;
    this.sim = null;
    sim?.stop?.();
  }
  /** A watcher looks just now when one of its tabs is in sight. */
  look(w) { const v = this.state.viewers.get(w.id); if (v) put(v, 'on', [...w.clients].some(c => c.userData?.on)); }
  /** The dashboard's newest snapshot, as the guest sees it: the scene everyone's world is made from (a private one, for a world from your folder). */
  async feed(json, chatter) {
    if (!this.sim) return;
    try {
      if (this.own) {
        await this.sim.scene(this.live.private.scene(json));
        if (this.sim) put(this.state, 'names', this.live.private.names());
        return;
      }
      this.sim.scene(json);
      if (chatter && chatter.at !== this.chatterAt) { this.chatterAt = chatter.at; this.sim.chatter(chatter.lines); }
    } catch (err) { this.fail(err); }
  }
  tick(ms) {
    if (!this.sim) return;
    this.late = Math.min(this.late + ms, 4 * TICK_MS); // never more than four steps behind: a stall is not caught up in a burst
    const n = Math.floor(this.late / TICK_MS);
    if (!n) return;
    if (this.own) { // a thread of its own answers when it has stepped: no second step is asked meanwhile
      if (this.busy) return;
      this.late -= n * TICK_MS;
      this.busy = true;
      this.sim.step(n).then(st => { this.busy = false; this.failed = 0; if (this.sim) this.show(cleanState(st)); }, err => { this.busy = false; this.fail(err); });
      return;
    }
    this.late -= n * TICK_MS;
    let st;
    try { st = this.sim.step(n); } catch (err) { this.fail(err); return; }
    this.failed = 0;
    this.show(st);
  }
  /** A world that keeps failing is closed: its watchers' browsers move it themselves again. */
  fail(err) {
    if (!this.sim) return;
    this.live.log(`live: the ${this.key} failed: ${err?.message ?? err}`);
    if (++this.failed >= 5) { if (this.own) this.live.trouble(this.key); try { this.disconnect().catch(() => {}); } catch { /* still being made: it is never joined */ } }
  }
  /** The state everyone is sent, brought up to how the world stands. */
  show(st) {
    const s = this.state;
    s.t = st.t;
    s.wall = st.wall;
    put(s, 'flights', JSON.stringify(st.flights ?? []));
    const seen = new Set();
    for (const [id, x, y, tx, ty, bits, zone] of st.bodies) {
      seen.add(id);
      let b = s.bodies.get(id);
      if (!b) { b = new Body(); s.bodies.set(id, b); }
      put(b, 'x', eighths(x)); put(b, 'y', eighths(y)); put(b, 'tx', whole(tx)); put(b, 'ty', whole(ty)); put(b, 'bits', bits); put(b, 'zone', String(zone ?? ''));
    }
    for (const id of [...s.bodies.keys()]) if (!seen.has(id)) s.bodies.delete(id);
    const says = new Map(), lines = new Map();
    if (st.animals) {
      const there = new Set();
      for (const [id, x, y, bits, pose, lift, den] of st.animals.ones) {
        there.add(id);
        let a = s.animals.get(id);
        if (!a) { a = new Animal(); s.animals.set(id, a); }
        put(a, 'x', eighths(x)); put(a, 'y', eighths(y)); put(a, 'bits', bits); put(a, 'pose', String(pose ?? 'stand')); put(a, 'lift', Math.max(0, Math.min(255, Math.round(lift)))); put(a, 'den', den);
      }
      for (const id of [...s.animals.keys()]) if (!there.has(id)) s.animals.delete(id);
      for (const [id, said, plain] of st.animals.says) { // the helper's line is this computer's alone: a guest reads the world's own (plain), or nothing
        if (plain === null) says.set(id, said);
        else { lines.set(id, said); if (plain) says.set(id, plain); }
      }
      put(s, 'taken', st.animals.taken.join(','));
    }
    for (const [id, said] of says) if (s.says.get(id) !== said) s.says.set(id, said);
    for (const id of [...s.says.keys()]) if (!says.has(id)) s.says.delete(id);
    if (lines.size !== this.lines.size || [...lines].some(([id, said]) => this.lines.get(id) !== said)) {
      this.lines = lines;
      for (const c of this.clients) if (c.userData?.host) c.send('says', [...lines]);
    }
    put(s, 'over', JSON.stringify(st.over ?? {}));
    put(s, 'spare', Math.min(255, st.spare ?? 0));
    put(s, 'jobs', Math.min(255, st.jobs.length));
    this.asked = st.jobs;
    const shared = st.shared ?? {};
    for (const [k, v] of Object.entries(shared)) { const json = JSON.stringify(v); if (s.shared.get(k) !== json) s.shared.set(k, json); }
    for (const k of [...s.shared.keys()]) if (!(k in shared)) s.shared.delete(k);
    for (const e of st.fx ?? []) this.broadcast('fx', { ...e, t: st.t }); // with its moment: a browser shows it when that is the moment it draws
  }
  /** An answer kept under its rid: the same thing asked again (a browser that sent it twice) gets the same answer, and is not done again. */
  once(client, kind, rid, answer) {
    const now = Date.now(), known = this.replies.get(`${kind}:${rid}`);
    if (known && now - known.at < REPLY_MS) { client.send(kind, known.re); return true; }
    if (answer) {
      this.replies.set(`${kind}:${rid}`, { at: now, re: answer });
      if (this.replies.size > REPLIES_MAX) this.replies.delete(this.replies.keys().next().value);
      client.send(kind, answer);
    }
    return false;
  }
  /**
   * Something asked of an animal: { rid, animal, act, doer? }. Asked twice (the same rid: a browser that sent it again
   * after its connection dropped), it is done once and answered the same. One at a time for each watcher, and a few under way.
   */
  act(client, m) {
    const rid = typeof m?.rid === 'string' && RID.test(m.rid) ? m.rid : null;
    const animal = typeof m?.animal === 'string' && ANIMAL.test(m.animal) ? m.animal : null;
    if (!rid || !animal || !Number.isInteger(m.act) || m.act < 0 || m.act > 7 || !this.sim) return;
    if (this.once(client, 're', rid)) return;
    const under = this.pending.get(rid); // asked again while the first asking is still with the world's process: the same answer, when it comes
    if (under) { under.then(re => { if (re) client.send('re', re); }); return; }
    const now = Date.now(), who = client.userData;
    const mine = this.asked.filter(j => j.by === client.sessionId).length;
    if (now - who.at < ACT_GAP_MS || mine >= JOBS_EACH) { client.send('re', { rid, animal, ok: false, why: 'slow' }); return; } // not kept: asked again later, it is looked at again
    who.at = now;
    const done = r => {
      const re = { rid, animal, ok: r?.ok === true, ...(typeof r?.doer === 'string' ? { doer: r.doer.slice(0, 200) } : r?.ok === true ? { doer: null } : {}), ...(Number.isInteger(r?.wait) ? { wait: r.wait } : {}), ...(typeof r?.why === 'string' ? { why: r.why.slice(0, 16) } : {}) };
      if (re.ok && re.doer) this.asked = [...this.asked, { by: client.sessionId }]; // counted at once: the next step says the rest
      this.once(client, 're', rid, re);
      return re;
    };
    let r;
    try { r = this.sim.ask({ animal, act: m.act, doer: typeof m.doer === 'string' && m.doer.length <= 200 ? m.doer : null, by: client.sessionId }); } catch (err) { this.fail(err); return; }
    if (typeof r?.then !== 'function') { done(r); return; }
    this.pending.set(rid, r.then(done, err => { this.fail(err); return null; }).finally(() => this.pending.delete(rid)));
  }
  /** A shy visitor, touched by someone: it bolts, for everyone. */
  touched(client, m) {
    const who = client.userData;
    if (typeof m?.animal !== 'string' || !ANIMAL.test(m.animal) || !this.sim || Date.now() - (who.touchedAt ?? 0) < ACT_GAP_MS) return;
    who.touchedAt = Date.now();
    try { Promise.resolve(this.sim.touch(m.animal)).catch(err => this.fail(err)); } catch (err) { this.fail(err); }
  }
  /**
   * A watcher names itself: { rid, name }. One line of plain text; a name someone else here has gets a number after
   * it. Answered with the name it now has; sent again (the same rid), answered the same and changed no further.
   */
  named(client, m) {
    const rid = typeof m?.rid === 'string' && RID.test(m.rid) ? m.rid : null, w = this.watchers.get(client.userData?.key), v = w && this.state.viewers.get(w.id);
    if (!rid || !v) return;
    if (this.once(client, 'named', rid)) return;
    const now = Date.now(), who = client.userData, name = plainName(m.name);
    if (!name) { client.send('named', { rid, ok: false, why: 'empty' }); return; }
    if (now - (who.namedAt ?? 0) < NAME_GAP_MS) { client.send('named', { rid, ok: false, why: 'slow' }); return; }
    who.namedAt = now;
    put(v, 'name', freeName(name, [...this.state.viewers.entries()].filter(([id]) => id !== w.id).map(([, o]) => o.name)));
    this.once(client, 'named', rid, { rid, ok: true, name: v.name });
  }
  /** A tab says whether it is in sight: a watcher looks while one of its tabs is. */
  seen(client, m) {
    if (typeof m?.on !== 'boolean' || !client.userData) return;
    client.userData.on = m.on;
    const w = this.watchers.get(client.userData.key);
    if (!w) return;
    this.look(w);
    client.send('you', { id: w.id, host: client.userData.host }); // (again: a page that was not listening yet when it joined asks this way)
  }
}

/**
 * A tracker server's side of the rooms: the matchmaking request its page sends (joinOrCreate, reconnect), the
 * WebSocket its page then opens (on the server's own port), and the snapshots the rooms are fed.
 * `allowed(req)`: the request is to one of this dashboard's own names, from one of its own pages.
 * `ownFile(key)`: the real path of world.js of a world from your folder, or null when there is no such world.
 */
export function createLive({ httpServer, token, lan = false, webDir, getGuestJson, getChatter = () => null, ownFile = () => null, allowed = () => true, log = () => {} }) {
  const id = `d${++seq}${Math.random().toString(36).slice(2, 8)}`;
  const troubled = new Map(); // a world of yours → { n: how often it failed, until: left alone till then }
  const selfDrawn = new Set(); // worlds of yours that draw themselves (Agentville.raw): nothing in them to move, until their files change
  let privatizer = null, running = 0;
  const me = {
    token, lan, webDir, rooms: new Set(), log, guestJson: getGuestJson, chatter: getChatter, ownFile,
    get private() { return (privatizer ??= makePrivatizer(webDir)); },
    /** A world of yours, started in its own thread; counted, so only a few run at once. */
    start(key, file, onGone) {
      running++;
      return spawnWorld({ worldFile: file, webDir, warn: m => log(`live: ${key}: ${m}`), onGone: why => {
        running--;
        if (why !== 'stopped') me.trouble(key);
        onGone(why);
      } });
    },
    /** A world of yours failed (its thread ended, or its steps kept throwing): after a few times it is left alone for a while. */
    trouble(key) { const tr = troubled.get(key) ?? { n: 0, until: 0 }; tr.n++; if (tr.n >= OWN_FAILS) { tr.until = Date.now() + OWN_REST_MS; tr.n = 0; } troubled.set(key, tr); },
  };
  let transport = null;
  /** The transport, attached to the server the first time someone watches: until then the server has no WebSocket at all. */
  function attach() {
    if (transport) return;
    instances.set(id, me);
    transport = new WebSocketTransport({ noServer: true, maxPayload: 2048, pingInterval: 5000, pingMaxRetries: 3 });
    transport.attachToServer(httpServer, {
      filter(req) {
        const ok = allowed(req) && (lan || LOOPBACK.has(req.socket.remoteAddress));
        for (const h of ['x-real-ip', 'x-forwarded-for', 'x-client-ip']) delete req.headers[h]; // who it is, is the socket's address: never what a header claims
        if (!ok) req.socket.destroy();
        return ok;
      },
    });
  }
  /** May this world be moved here now? Why not, else null. */
  function refused(key) {
    if (LIVE_WORLDS.includes(key)) return null;
    if (!OWN_WORLD.test(key) || !ownFile(key)) return 'no such world';
    if (selfDrawn.has(key)) return 'it draws itself: there is nothing here to move';
    if ([...me.rooms].some(r => r.key === key)) return null; // it runs already: one more watcher costs nothing
    if ((troubled.get(key)?.until ?? 0) > Date.now()) return 'it failed too often: left alone for a few minutes';
    if (running >= OWN_MAX) return `${OWN_MAX} worlds of yours are moved here already`;
    return null;
  }
  return {
    /**
     * `POST /matchmake/<method>/<name>`: a seat in a world's room ({ world } in the body; the token makes it this computer's
     * own; viewer and name say who watches), or back in the seat a dropped connection had. Answers as Colyseus's own
     * route does. The caller has checked the host and the origin, and read the body.
     */
    async matchmake(method, name, body) {
      if (method === 'joinOrCreate' && name === 'world') {
        const world = typeof body?.world === 'string' ? body.world : '', why = refused(world);
        if (why) return { status: why === 'no such world' ? 404 : 503, body: { code: why === 'no such world' ? 404 : 503, error: why } };
        attach();
        await boot();
        const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
        try { return { status: 200, body: await matchMaker.joinOrCreate('world', { world, token: str(body.token, 200), viewer: str(body.viewer, 64), name: str(body.name, 100), on: body.on !== false, live: id }) }; }
        catch (err) {
          if (/draws itself/.test(String(err?.message))) { selfDrawn.add(world); return { status: 503, body: { code: 503, error: 'it draws itself: there is nothing here to move' } }; }
          log(`live: no seat in the ${world}: ${err?.message ?? err}`);
          return { status: 400, body: { code: err?.code ?? 400, error: String(err?.message ?? err) } }; // its page moves the world itself
        }
      }
      if (method === 'reconnect' && transport && /^[\w-]{1,40}$/.test(name)) {
        try { return { status: 200, body: await matchMaker.reconnect(name, body ?? {}) }; }
        catch (err) { return { status: 400, body: { code: err?.code ?? 400, error: String(err?.message ?? err) } }; }
      }
      return { status: 404, body: { code: 404, error: 'not found' } };
    },
    /** A new snapshot: every room's world gets its scene (the guest's JSON, made once for all of them: `guestJson()`). */
    publish(guestJson, chatter) { for (const room of me.rooms) void room.feed(guestJson(), chatter); },
    /** A world's files changed: its room closes (its thread with it), and its pages, reloading, open a new one. */
    reload(key) { if (key === '*') selfDrawn.clear(); else selfDrawn.delete(key); troubled.delete(key); for (const room of me.rooms) if (key === '*' || room.key === key) { try { room.disconnect().catch(() => {}); } catch { /* still being made */ } } },
    watching: () => me.rooms.size > 0,
    /** How many look at each world just now (what its chip says): { world: count }, for the list of worlds. */
    online: () => Object.fromEntries([...me.rooms].map(room => [room.key, [...room.state.viewers.values()].filter(v => v.on).length])),
    /** How many worlds from your folder are moved here now, a thread each (tests, and the log). */
    running: () => running,
    async stop() {
      const mine = instances.delete(id);
      for (const room of me.rooms) for (const timer of Object.values(room._reservedSeatTimeouts ?? {})) clearTimeout(timer); // a seat given and never taken would keep a closing process waiting for it
      await Promise.all([...me.rooms].map(room => room.disconnect().catch(() => {})));
      transport?.shutdown();
      transport = null;
      if (mine && !instances.size && booted) { // the last dashboard of this process is closing: the matchmaker's own timers go too (it is set up again if another opens)
        const was = booted;
        booted = null;
        await was.then(() => matchMaker.gracefullyShutdown()).catch(() => {});
      }
    },
  };
}
