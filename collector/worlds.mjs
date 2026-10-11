// Worlds on disk. The built-in ones live in web/worlds/<key>/, the SDK in web/worlds/sdk/; each world is
// a folder with world.json and what that names (docs/worlds.md, "What a world is"). This serves a world's
// files from inside its own folder only (no way out through .., a hidden name or a symlink), and writes the
// page its sandboxed frame loads.
//
// Two kinds of world run for now. A world of api 2 is the standard: its world.json describes it, the SDK
// draws it with three.js. A world of api 1 is drawn by the pixel engine in web/worlds/legacy/, kept while
// the worlds made for it are moved over: everything here that serves it is marked LEGACY, and
// web/worlds/legacy/README.md lists what goes with it.
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync, statSync, watch } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, isAbsolute, join, sep } from 'node:path';
import { readManifest } from '../web/worlds/sdk/core/manifest.js';

export const API_VERSION = 2;
export const LEGACY_API = 1; // LEGACY: the pixel engine's worlds
export const WORLD_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const RESERVED = new Set(['sdk', 'legacy', 'starter', 'legacy-starter', 'test', 'u']);
const HIDDEN = new Set(['starter', 'legacy-starter']); // built in and runnable (the test page, new-world's template), never in the list
const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.glb': 'model/gltf-binary',
};
// three.js, which draws the worlds of api 2: the files of the installed package the SDK loads, each under
// the name the frame asks for (/world/sdk/three/…), and nothing else of it.
const THREE_FILES = {
  'three/three.module.js': 'build/three.module.js', 'three/three.core.js': 'build/three.core.js',
  'three/addons/loaders/GLTFLoader.js': 'examples/jsm/loaders/GLTFLoader.js',
  'three/addons/utils/BufferGeometryUtils.js': 'examples/jsm/utils/BufferGeometryUtils.js',
  'three/addons/utils/SkeletonUtils.js': 'examples/jsm/utils/SkeletonUtils.js',
};
let threeDir;
/** Where the three package is installed, or null where it is not (no `npm install` yet): a world of api 2 then can't draw. */
function threeRoot() {
  if (threeDir === undefined) {
    try { threeDir = dirname(dirname(createRequire(import.meta.url).resolve('three'))); } catch { threeDir = null; }
  }
  return threeDir;
}
// The frame: a sandbox of its own even when opened in a tab, scripts only from the dashboard, no request
// a world can read (no fetch, event stream, form or worker; pictures, fonts and sounds only from the
// dashboard), and no other page loaded in a frame it makes. Only the dashboard may embed it. What a
// frame can still signal (a connection hint, WebRTC, its one leaving request) is in docs/worlds.md,
// "The gaps".
export const FRAME_CSP = "sandbox allow-scripts; default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'none'; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/;
/**
 * The policy a frame's page is served with: FRAME_CSP, and for a frame with an import map (a world of api 2:
 * it tells the browser where `three` is) that one inline block, by its hash. No other inline script runs.
 */
export function frameCsp(html) {
  const map = IMPORT_MAP.exec(html);
  return map ? FRAME_CSP.replace("script-src 'self'", `script-src 'self' 'sha256-${createHash('sha256').update(map[1]).digest('base64')}'`) : FRAME_CSP;
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** A frame's template with its `__NAME__` marks filled in, in one pass: what is written in is never read for marks again, so a world's name or its world.json can't stand in for one. */
const fill = (html, parts) => html.replace(/__([A-Z]+)__/g, (mark, name) => (Object.hasOwn(parts, name) ? parts[name] : mark));
const NOUN_KEYS = ['agent', 'agents', 'repo', 'repos', 'place', 'start', 'diary'];
const MAX_JSON = 64 * 1024;
const NOT_FOUND = { status: 404, error: 'not found' };

/** What is wrong with a world.json (as parsed), or null. */
export function checkWorldJson(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return 'world.json is not a JSON object.';
  if (typeof j.name !== 'string' || !j.name.trim() || j.name.length > 40) return 'world.json needs a "name", up to 40 characters.';
  if (j.icon !== undefined && (typeof j.icon !== 'string' || [...j.icon].length > 8)) return 'world.json: "icon" is one emoji.';
  if (j.description !== undefined && (typeof j.description !== 'string' || j.description.length > 140)) return 'world.json: "description" is up to 140 characters.';
  if (!Number.isInteger(j.api) || j.api < 1) return `world.json needs "api": ${API_VERSION}.`;
  if (j.api > API_VERSION) return `This world needs a newer Agentville (it was made for api ${j.api}; this one has ${API_VERSION}).`;
  if (j.nouns !== undefined && (!j.nouns || typeof j.nouns !== 'object' || Array.isArray(j.nouns) || NOUN_KEYS.some(k => j.nouns[k] !== undefined && (typeof j.nouns[k] !== 'string' || j.nouns[k].length > 30)))) return 'world.json: "nouns" are short words.';
  if (j.api !== LEGACY_API) { try { readManifest(j); return null; } catch (err) { return err.message; } }
  // LEGACY: what only a world of the pixel engine says
  if (j.taken !== undefined && (!Array.isArray(j.taken) || j.taken.length > 16 || j.taken.some(k => typeof k !== 'string' || !/^[a-z][a-z0-9-]{0,23}$/.test(k)))) return 'world.json: "taken" is a list of up to 16 short kind names (the shapes this world already uses for data).';
  return null;
}

const identOf = p => { try { const s = statSync(p); return `${s.dev}:${s.ino}`; } catch { return null; } };
/**
 * Is `target` the folder `folder`, or a folder above it, however it is spelled (capitals, a firmlink, a link)?
 * Decided by what the folder IS (device and inode), not by its name: the folder's path is tried from every
 * depth under `target`, and a match with the folder's own identity means target holds it.
 */
function holds(target, folder) {
  let r;
  try { r = realpathSync(folder); } catch { return false; }
  const id = identOf(r);
  if (!id) return false;
  const parts = r.split(sep).filter(Boolean);
  for (let i = 0; i <= parts.length; i++) if (identOf(join(target, ...parts.slice(i))) === id) return true;
  return false;
}

/** Where your worlds live: worldsDir (a leading ~ is home; a relative one is under home), else ~/.agentville/worlds. Never your home or above it. */
export function worldsDirOf(cfg, home, note = () => {}) {
  const fallback = join(home, '.agentville', 'worlds'), w = cfg?.worldsDir;
  if (typeof w !== 'string' || !w.trim()) return fallback;
  const t = w.trim();
  let dir;
  if (t === '~') dir = home;
  else if (t.startsWith('~/')) dir = join(home, t.slice(2));
  else if (isAbsolute(t)) dir = t;
  else {
    dir = join(home, t);
    if (dir !== home && !dir.startsWith(home + sep)) { note(`worldsDir "${t}" is outside your home folder; using ${fallback}`); return fallback; }
  }
  if (holds(dir, home)) { note(`worldsDir "${t}" is your home folder or above it; using ${fallback}`); return fallback; }
  return dir;
}

export function makeWorlds({ builtinDir, userDir = null, home = null }) {
  /** Is a folder of yours (a link, maybe) the worlds folder, your home, or a folder above either, however spelled? */
  const tooBroad = dir => Boolean((userDir && holds(dir, userDir)) || (home && holds(dir, home)));
  /** Does the folder hold a regular world.json that really is inside it? */
  function holdsJson(dir) {
    try {
      const root = realpathSync(dir), r = realpathSync(join(dir, 'world.json'));
      return r.startsWith(root + sep) && statSync(r).isFile();
    } catch { return false; }
  }
  const NAME_ERR = "A world's folder name is lowercase letters, digits and dashes (up to 40).";
  const BROAD_ERR = "This folder is a link to a folder that holds other things; link to the world's own folder.";
  const DEAD_ERR = "This folder is a link to something that isn't there.";
  /** A world's folder from its key ('sdk' is the SDK's, 'u/<name>' one of yours); null for a key that names none. */
  function dirOf(key) {
    if (key === 'sdk' || key === 'legacy') return join(builtinDir, key); // (LEGACY: 'legacy', the pixel engine's files)
    if (key.startsWith('u/')) {
      const name = key.slice(2);
      if (!userDir || !WORLD_NAME.test(name)) return null;
      try { if (!readdirSync(userDir).includes(name)) return null; } catch { return null; } // the exact name, as the list sees it (not a case-insensitive disk's idea of it)
      const dir = join(userDir, name);
      return !tooBroad(dir) && holdsJson(dir) ? dir : null; // a folder with no world.json of its own serves nothing
    }
    return WORLD_NAME.test(key) && (!RESERVED.has(key) || HIDDEN.has(key)) ? join(builtinDir, key) : null;
  }
  /** One of a world's files: { real, type, size }; anything else is a plain 404, saying nothing about what is there. */
  function file(key, rel) {
    const dir = dirOf(key), type = TYPES[extname(rel).toLowerCase()];
    if (!dir || !type || rel.split('/').some(p => p === '' || p === '..' || p.startsWith('.'))) return NOT_FOUND;
    try {
      if (key === 'sdk' && rel.startsWith('three/')) { // three.js: from the installed package, by name
        if (!Object.hasOwn(THREE_FILES, rel) || !threeRoot()) return NOT_FOUND;
        const real = realpathSync(join(threeRoot(), THREE_FILES[rel]));
        return { real, type, size: statSync(real).size };
      }
      const root = realpathSync(dir), real = realpathSync(join(dir, rel)), st = statSync(real);
      if (!real.startsWith(root + sep) || !st.isFile()) return NOT_FOUND;
      return { real, type, size: st.size };
    } catch {
      return NOT_FOUND;
    }
  }
  function describe(key, builtIn) {
    let j = null, error = null;
    const meta = file(key, 'world.json'); // through the folder check: a world.json linked out of the folder counts as missing
    if (key.startsWith('u/') && !dirOf(key)) error = tooBroad(join(userDir, key.slice(2))) ? BROAD_ERR : 'world.json is missing.';
    else if (meta.size > MAX_JSON) error = 'world.json is too large (over 64 KB).';
    else try { if (!meta.real) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); j = JSON.parse(readFileSync(meta.real, 'utf8')); }
    catch (err) { error = err.code === 'ENOENT' ? 'world.json is missing.' : `world.json can't be read: ${String(err.message).slice(0, 120)}`; }
    const api = Number.isInteger(j?.api) ? j.api : null;
    error ??= checkWorldJson(j);
    if (!error && api === LEGACY_API && !file(key, 'world.js').real) error = 'world.js is missing (or is a link out of the folder).'; // LEGACY
    if (!error && api !== LEGACY_API) {
      const gone = readManifest(j).assets.find(a => !file(key, a).real);
      if (gone) error = `${gone} is missing (or is a link out of the folder).`;
      else if (!threeRoot()) error = 'three.js is not installed: install Agentville again.';
    }
    return {
      key, builtIn, error, api,
      name: typeof j?.name === 'string' && j.name.trim() ? j.name.slice(0, 40) : key.replace(/^u\//, ''),
      icon: typeof j?.icon === 'string' && j.icon.trim() &&[...j.icon].length <= 8 ? j.icon : '🧩',
      description: typeof j?.description === 'string' ? j.description.slice(0, 140) : '',
      nouns: !error && j.nouns ? Object.fromEntries(NOUN_KEYS.filter(k => typeof j.nouns[k] === 'string').map(k => [k, j.nouns[k]])) : {},
      taken: !error && Array.isArray(j?.taken) ? [...j.taken] : [], // LEGACY: the shapes it uses for data: its creatures can't (docs/worlds-legacy.md, "Creatures")
      preview: file(key, 'preview.png').real ? `/world/${key}/preview.png` : null,
    };
  }
  /** The folders in a directory, each judged on its own: a broken link (dangling or a loop) is an entry with an error, never the end of the list. */
  const folders = dir => {
    let names;
    try { names = readdirSync(dir).filter(n => !n.startsWith('.')).sort(); } catch { return []; }
    const out = [];
    for (const name of names) {
      try { if (statSync(join(dir, name)).isDirectory()) out.push({ name }); }
      catch { try { if (lstatSync(join(dir, name)).isSymbolicLink()) out.push({ name, dead: true }); } catch { /* gone meanwhile */ } }
    }
    return out;
  };
  /** Every world: the built-in ones (the farm first), then yours (A to Z), each with what is wrong with it, if anything. */
  function list() {
    const built = folders(builtinDir).map(f => f.name).filter(n => WORLD_NAME.test(n) && !RESERVED.has(n)).sort((a, b) => (a === 'farm' ? -1 : b === 'farm' ? 1 : a.localeCompare(b)));
    const out = built.map(n => describe(n, true));
    for (const f of userDir ? folders(userDir) : []) {
      const bad = error => ({ key: null, builtIn: false, name: f.name.slice(0, 40), icon: '🧩', description: '', nouns: {}, taken: [], preview: null, error });
      out.push(f.dead ? bad(DEAD_ERR) : WORLD_NAME.test(f.name) ? describe(`u/${f.name}`, false) : bad(NAME_ERR));
    }
    return out;
  }
  /** A world that can run, as list() describes it; null for one that can't (or isn't). */
  function info(key) {
    if (!dirOf(key) || key === 'sdk') return null;
    const w = HIDDEN.has(key) ? describe(key, true) : list().find(x => x.key === key);
    return w && !w.error ? w : null;
  }
  /** The page a world's frame loads (the SDK's frame.html filled in), or null for a world that can't run. */
  function frame(key) {
    const w = info(key);
    if (!w) return null;
    if (w.api === LEGACY_API) { // LEGACY: the pixel engine's frame
      return fill(readFileSync(join(builtinDir, 'legacy', 'frame.html'), 'utf8'), { TITLE: esc(w.name), BASE: `/world/${key}/` });
    }
    // Every address in it is relative to the frame's own (/world/<key>/), so a guest's pass in the path carries over.
    const worlds = key.startsWith('u/') ? '../../' : '../';
    const script = name => `<script src="${name}.js" crossorigin="anonymous"></script>`;
    const world = JSON.stringify({ key, manifest: JSON.parse(readFileSync(file(key, 'world.json').real, 'utf8')) }).replaceAll('<', '\\u003c'); // (a "<" could end the block it is written into)
    return fill(readFileSync(join(builtinDir, 'sdk', 'frame.html'), 'utf8'), {
      TITLE: esc(w.name), ROOT: `${worlds}../`, WORLDS: worlds, WORLD: world,
      SIM: file(key, 'sim.js').real ? script('sim') : '', // its own code, where it has any: rules for who stands where,
      VIEW: file(key, 'view.js').real ? script('view') : '', // and looks of its own
    });
  }
  /**
   * What the collector moves a world with (collector/live.mjs): { api, json, sim } for a world of api 2 (its
   * world.json, and its sim.js or null), { api, world } for one of the pixel engine (its world.js); null for a
   * world that can't run. Real paths, inside the world's folder.
   */
  function source(key) {
    const w = info(key);
    if (!w) return null;
    return w.api === LEGACY_API ? { api: w.api, world: file(key, 'world.js').real } : { api: w.api, json: file(key, 'world.json').real, sim: file(key, 'sim.js').real ?? null };
  }
  return { dirOf, file, info, list, frame, source, userDir };
}

/**
 * Watches the built-in worlds and your folder, and calls onChange(key) once per burst of changes: a
 * world's key, or '*' (the SDK changed, or your folder appeared). Your folder may not exist yet: it is
 * looked for again every 5 s. A world folder that is a link is not followed (the watcher doesn't).
 * Returns a function that stops watching.
 */
export function watchWorlds({ builtinDir, userDir }, onChange, { quietMs = 200 } = {}) {
  const timers = new Map(), watchers = [];
  let retry = null, stopped = false;
  const bump = key => {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); if (!stopped) onChange(key); }, quietMs));
  };
  const keyOf = (rel, mine) => {
    const top = String(rel ?? '').split(/[\\/]/)[0];
    if (!top) return null;
    if (mine) return WORLD_NAME.test(top) ? `u/${top}` : null;
    if (top === 'sdk' || top === 'legacy') return '*';
    return WORLD_NAME.test(top) && (!RESERVED.has(top) || HIDDEN.has(top)) ? top : null;
  };
  const watchDir = (dir, mine) => {
    try {
      const w = watch(dir, { recursive: true }, (_event, rel) => { const key = keyOf(rel, mine); if (key) bump(key); });
      w.on('error', () => {});
      watchers.push(w);
      return true;
    } catch {
      return false;
    }
  };
  watchDir(builtinDir, false);
  if (userDir && !watchDir(userDir, true)) {
    retry = setInterval(() => {
      if (existsSync(userDir) && watchDir(userDir, true)) { clearInterval(retry); retry = null; bump('*'); }
    }, 5000);
    retry.unref?.();
  }
  return () => {
    stopped = true;
    clearInterval(retry);
    for (const t of timers.values()) clearTimeout(t);
    for (const w of watchers) w.close();
  };
}
