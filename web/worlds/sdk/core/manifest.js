// world.json, for a world of api 2: what it may say, and the world read from it with every default filled in.
// One reader does both, so what is checked and what is used can't drift: readManifest throws what is wrong
// (one sentence, naming the field), checkManifest gives that sentence or null. The collector lists a world by
// it, the frame and the simulation build the world from it, check-world reports it. Lengths are metres on the
// ground: x to the right, z towards the viewer, from the ground's far left corner. No DOM and no three.js.
import { STEPS, STEP_NAMES } from './steps.js';

export const API = 2;
export const BEDS_MAX = 18; // the collector gives each repo one of this many beds (collector/derive/beds.mjs)
export const ASSET = /^assets\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*(?:\/[A-Za-z0-9][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)*)*\.(glb|png|webp|jpe?g)$/;
const MODEL = /\.glb$/;
const PLACE_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const VIEWS = { iso: { yaw: 45, pitch: 35 }, tilt: { yaw: 0, pitch: 55 }, top: { yaw: 0, pitch: 90 }, orbit: { yaw: 35, pitch: 30 } };
const SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'plane'];
const OPENS = ['session', 'board', 'repos', 'help'];
const SHOWS = ['deploy', 'context', 'collision', 'busy'];
const CLIPS = ['idle', 'walk', 'work', 'wait', 'sleep'];
const NOUNS = { agent: 'agent', agents: 'agents', repo: 'repo', repos: 'repos', place: 'world', start: 'start', diary: 'Diary' };
export const REACH = 450; // metres from the corner, either way: as far as a point may lie (core/wire.js sends no farther)
const INSTANCES_MAX = 4000, PATH_POINTS_MAX = 256; // (a walk is planned over every point of the paths: few enough to plan at once)
const KNOWN = ['name', 'icon', 'description', 'api', 'author', 'nouns', 'ground', 'camera', 'sky', 'speed', 'spawn', 'plots', 'places', 'paths', 'prefabs', 'scenery', 'figure', 'steps', 'help'];

const fail = message => { throw new Error(`world.json: ${message}`); };
const isObj = v => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isNum = v => typeof v === 'number' && Number.isFinite(v);

function num(v, lo, hi, what, fallback) {
  if (v === undefined && fallback !== undefined) return fallback;
  if (!isNum(v) || v < lo || v > hi) fail(`"${what}" is a number from ${lo} to ${hi}.`);
  return v;
}
function point(v, what) {
  if (!Array.isArray(v) || v.length !== 2 || !v.every(n => isNum(n) && Math.abs(n) <= REACH)) fail(`"${what}" is a point on the ground, [x, z] in metres.`);
  return [v[0], v[1]];
}
function points(v, what, min, max) {
  if (!Array.isArray(v) || v.length < min || v.length > max) fail(`"${what}" is a list of ${min} to ${max} points [x, z].`);
  return v.map((p, i) => point(p, `${what}[${i}]`));
}
function color(v, what, fallback) {
  if (v === undefined && fallback !== undefined) return fallback;
  if (typeof v !== 'string' || !COLOR.test(v)) fail(`"${what}" is a colour like "#3f7d3a".`);
  return v.toLowerCase();
}
function text(v, max, what, fallback = '') {
  if (v === undefined) return fallback;
  if (typeof v !== 'string' || v.length > max) fail(`"${what}" is text of up to ${max} characters.`);
  return v;
}
function asset(v, what, pattern = ASSET) {
  if (typeof v !== 'string' || v.length > 120 || !ASSET.test(v) || !pattern.test(v)) fail(`"${what}" names a file in the world's assets folder, like "assets/tree.glb"${pattern === MODEL ? ' (a .glb model)' : ''}.`);
  return v;
}
function obj(v, what) {
  if (!isObj(v)) fail(`"${what}" is an object.`);
  return v;
}

/** Which way those standing somewhere look: [dx, dz], or { "to": [x, z] } for a point they all look at. Null: towards the viewer. */
function face(v, what) {
  if (v === undefined) return null;
  if (isObj(v) && v.to !== undefined) return { to: point(v.to, `${what}.to`) };
  if (Array.isArray(v) && v.length === 2 && v.every(isNum) && (v[0] !== 0 || v[1] !== 0)) return { dir: [v[0], v[1]] };
  return fail(`"${what}" is a direction [dx, dz], or { "to": [x, z] }.`);
}

/** A place's spots: given one by one, or laid out in a row, a grid or a ring. */
function spots(p, what) {
  const kinds = ['spots', 'row', 'grid', 'ring'].filter(k => p[k] !== undefined);
  if (kinds.length !== 1) fail(`"${what}" has exactly one of "spots", "row", "grid" or "ring".`);
  if (p.spots) return points(p.spots, `${what}.spots`, 1, 64);
  const within = list => (list.every(([x, z]) => Math.abs(x) <= REACH && Math.abs(z) <= REACH) ? list : fail(`"${what}" has spots more than ${REACH} m from the ground's corner.`));
  const g = obj(p[kinds[0]], `${what}.${kinds[0]}`), at = `${what}.${kinds[0]}`;
  const count = num(g.count, 1, 64, `${at}.count`);
  if (!Number.isInteger(count)) fail(`"${at}.count" is a whole number.`);
  if (p.ring) {
    const [cx, cz] = point(g.center, `${at}.center`), r = num(g.radius, 0.5, 100, `${at}.radius`);
    return within(Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2; return [cx + Math.sin(a) * r, cz + Math.cos(a) * r]; }));
  }
  const [x0, z0] = point(g.from, `${at}.from`), [dx, dz] = point(g.step, `${at}.step`);
  if (p.row) return within(Array.from({ length: count }, (_, i) => [x0 + dx * i, z0 + dz * i]));
  const cols = num(g.cols, 1, 16, `${at}.cols`);
  if (!Number.isInteger(cols)) fail(`"${at}.cols" is a whole number.`);
  return within(Array.from({ length: count }, (_, i) => [x0 + dx * (i % cols), z0 + dz * Math.floor(i / cols)]));
}

/**
 * One thing that stands in the world: a plain shape, a model, or a prefab ("use"). `ctx`: { prefabs (their names,
 * or null inside a prefab: its parts use none), shows (it stands on a plot: it may show the repo's state), assets }.
 */
function item(v, what, ctx) {
  const it = obj(v, what);
  const kinds = ['shape', 'model', 'use'].filter(k => it[k] !== undefined);
  if (kinds.length !== 1) fail(`"${what}" has exactly one of "shape", "model" or "use".`);
  if (it.at !== undefined && it.each !== undefined) fail(`"${what}" has "at" or "each", not both.`);
  const out = {
    at: it.each !== undefined ? points(it.each, `${what}.each`, 1, 400) : [it.at === undefined ? [0, 0] : point(it.at, `${what}.at`)],
    y: num(it.y, -50, 200, `${what}.y`, 0),
    turn: (num(it.turn, -360, 360, `${what}.turn`, 0) * Math.PI) / 180,
    glow: it.glow === true,
    opens: null, tip: text(it.tip, 80, `${what}.tip`), shows: null,
  };
  if (it.opens !== undefined) {
    if (!OPENS.includes(it.opens)) fail(`"${what}.opens" is one of ${OPENS.join(', ')}.`);
    if (!ctx.prefabs) fail(`"${what}.opens" belongs on the thing that uses the prefab, not on its parts.`);
    out.opens = it.opens;
  }
  if (it.shows !== undefined) {
    if (!ctx.shows) fail(`"${what}.shows" is for what stands on a plot ("plots.scenery").`);
    if (!SHOWS.includes(it.shows)) fail(`"${what}.shows" is one of ${SHOWS.join(', ')}.`);
    out.shows = it.shows;
  }
  if (it.shape !== undefined) {
    if (!SHAPES.includes(it.shape)) fail(`"${what}.shape" is one of ${SHAPES.join(', ')}.`);
    const flat = it.shape === 'plane', n = flat ? 2 : 3, s = it.size;
    if (!Array.isArray(s) || s.length !== n || !s.every(d => isNum(d) && d >= 0.01 && d <= 400)) fail(`"${what}.size" is ${flat ? '[width, depth]' : '[width, height, depth]'} in metres.`);
    return { ...out, kind: 'shape', shape: it.shape, size: flat ? [s[0], 0, s[1]] : [...s], color: color(it.color, `${what}.color`, '#c3cbd2'), opacity: num(it.opacity, 0.05, 1, `${what}.opacity`, 1) };
  }
  const scale = num(it.scale, 0.01, 100, `${what}.scale`, 1);
  if (it.model !== undefined) {
    const model = asset(it.model, `${what}.model`, MODEL);
    ctx.assets.add(model);
    return { ...out, kind: 'model', model, scale };
  }
  if (!ctx.prefabs) fail(`"${what}" is part of a prefab: it can't use another.`);
  if (typeof it.use !== 'string' || !ctx.prefabs.includes(it.use)) fail(`"${what}.use" names one of the prefabs${ctx.prefabs.length ? ` (${ctx.prefabs.join(', ')})` : ': there are none'}.`);
  return { ...out, kind: 'use', use: it.use, scale };
}
function items(v, what, max, ctx) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max) fail(`"${what}" is a list of up to ${max} things.`);
  return v.map((it, i) => item(it, `${what}[${i}]`, ctx));
}

/**
 * The world a world.json of api 2 describes, every default filled in. Throws an Error naming the first thing
 * wrong with it. Its name, icon and description are the collector's to check (collector/worlds.mjs): here they
 * are only read.
 */
export function readManifest(j) {
  if (!isObj(j)) fail('it is not a JSON object.');
  if (j.api !== API) fail(`this reader is for "api": ${API}.`);
  const assets = new Set();
  const given = isObj(j.nouns) ? j.nouns : {};
  const nouns = Object.fromEntries(Object.entries(NOUNS).map(([k, plain]) => [k, typeof given[k] === 'string' && given[k].trim() ? given[k].trim().slice(0, 30) : plain]));

  const g = j.ground === undefined ? {} : obj(j.ground, 'ground');
  const size = g.size === undefined ? [48, 32] : g.size;
  if (!Array.isArray(size) || size.length !== 2 || !size.every(n => isNum(n) && n >= 8 && n <= 400)) fail('"ground.size" is [width, depth] in metres, each from 8 to 400.');
  const ground = { w: size[0], d: size[1], color: color(g.color, 'ground.color', '#5d9b46') };

  const c = j.camera === undefined ? {} : obj(j.camera, 'camera');
  if (c.view !== undefined && !Object.hasOwn(VIEWS, c.view)) fail(`"camera.view" is one of ${Object.keys(VIEWS).join(', ')}.`);
  const view = c.view ?? 'iso';
  const camera = { view, yaw: num(c.yaw, -180, 180, 'camera.yaw', VIEWS[view].yaw), pitch: num(c.pitch, 10, 90, 'camera.pitch', VIEWS[view].pitch) };

  const s = j.sky === undefined ? {} : obj(j.sky, 'sky');
  const sky = { day: color(s.day, 'sky.day', '#bfe3ff'), night: color(s.night, 'sky.night', '#0c1330') };

  const prefabNames = j.prefabs === undefined ? [] : Object.keys(obj(j.prefabs, 'prefabs'));
  if (prefabNames.length > 32 || prefabNames.some(n => !PLACE_NAME.test(n))) fail('"prefabs" has up to 32 prefabs, named in lowercase letters, digits and dashes.');
  const prefabs = Object.fromEntries(prefabNames.map(n => {
    const parts = items(j.prefabs[n], `prefabs.${n}`, 24, { prefabs: null, shows: false, assets });
    if (!parts.length) fail(`"prefabs.${n}" has at least one part.`);
    return [n, parts];
  }));

  let plots = null;
  if (j.plots !== undefined) {
    const p = obj(j.plots, 'plots');
    if ((p.at === undefined) === (p.grid === undefined)) fail('"plots" has "at" (each plot\'s centre) or "grid", one of the two.');
    const max = num(p.max, 1, BEDS_MAX, 'plots.max', BEDS_MAX);
    if (!Number.isInteger(max)) fail('"plots.max" is a whole number.');
    let at;
    if (p.at !== undefined) at = points(p.at, 'plots.at', 1, BEDS_MAX);
    else {
      const gr = obj(p.grid, 'plots.grid'), [x0, z0] = point(gr.origin, 'plots.grid.origin'), [dx, dz] = point(gr.step, 'plots.grid.step');
      const cols = num(gr.cols, 1, 6, 'plots.grid.cols', 3);
      if (!Number.isInteger(cols)) fail('"plots.grid.cols" is a whole number.');
      at = Array.from({ length: max }, (_, i) => [x0 + dx * (i % cols), z0 + dz * Math.floor(i / cols)]);
      if (!at.every(([x, z]) => Math.abs(x) <= REACH && Math.abs(z) <= REACH)) fail(`"plots.grid" has plots more than ${REACH} m from the ground's corner.`);
    }
    const sz = p.size === undefined ? [8, 6] : p.size;
    if (!Array.isArray(sz) || sz.length !== 2 || !sz.every(n => isNum(n) && n >= 0.5 && n <= 200)) fail('"plots.size" is [width, depth] in metres.');
    plots = {
      at: at.slice(0, max), size: [sz[0], sz[1]],
      work: p.work === undefined ? [[0, 0], [-1.2, 0.6], [1.2, 0.6], [-1.2, -0.6], [1.2, -0.6], [0, 1.2]] : points(p.work, 'plots.work', 1, 12),
      face: face(p.face, 'plots.face'),
      label: p.label === undefined ? [0, sz[1] / 2 + 0.6] : point(p.label, 'plots.label'),
      scenery: items(p.scenery, 'plots.scenery', 40, { prefabs: prefabNames, shows: true, assets }),
      empty: items(p.empty, 'plots.empty', 40, { prefabs: prefabNames, shows: false, assets }),
    };
  }

  const pl = obj(j.places ?? fail('"places" is missing: a world needs at least "wait" and "idle".'), 'places');
  const placeNames = Object.keys(pl);
  if (placeNames.length > 16 || placeNames.some(n => !PLACE_NAME.test(n))) fail('"places" has up to 16 places, named in lowercase letters, digits and dashes.');
  for (const need of ['wait', 'idle']) if (!placeNames.includes(need)) fail(`"places.${need}" is missing: a world needs at least "wait" and "idle".`);
  const places = Object.fromEntries(placeNames.map(n => {
    const p = obj(pl[n], `places.${n}`);
    return [n, { spots: spots(p, `places.${n}`), face: face(p.face, `places.${n}.face`), name: text(p.name, 30, `places.${n}.name`) }];
  }));

  if (j.paths !== undefined && (!Array.isArray(j.paths) || j.paths.length > 32)) fail('"paths" is a list of up to 32 paths, each a list of points.');
  const paths = (j.paths ?? []).map((p, i) => points(p, `paths[${i}]`, 2, 64));
  if (paths.reduce((n, p) => n + p.length, 0) > PATH_POINTS_MAX) fail(`"paths" has up to ${PATH_POINTS_MAX} points in all.`);

  const scenery = items(j.scenery, 'scenery', 400, { prefabs: prefabNames, shows: false, assets });
  const count = list => list.reduce((n, it) => n + it.at.length * (it.kind === 'use' ? prefabs[it.use].reduce((parts, p) => parts + p.at.length, 0) : 1), 0);
  if (count(scenery) + (plots ? plots.at.length * (count(plots.scenery) + count(plots.empty)) : 0) > INSTANCES_MAX) fail(`it puts more than ${INSTANCES_MAX} things in the world.`);

  const f = j.figure === undefined ? {} : obj(j.figure, 'figure');
  const clipsGiven = f.clips === undefined ? {} : obj(f.clips, 'figure.clips');
  const figure = {
    model: f.model === undefined ? null : asset(f.model, 'figure.model', MODEL),
    height: num(f.height, 0.5, 4, 'figure.height', 1.7),
    tint: text(f.tint, 40, 'figure.tint'),
    hand: text(f.hand, 40, 'figure.hand'),
    clips: Object.fromEntries(CLIPS.map(k => [k, text(clipsGiven[k], 40, `figure.clips.${k}`, k)])),
  };
  if (figure.model) assets.add(figure.model);

  const st = j.steps === undefined ? {} : obj(j.steps, 'steps');
  for (const k of Object.keys(st)) if (!STEP_NAMES.includes(k)) fail(`"steps.${k}" is not a step: the steps are ${STEP_NAMES.join(', ')}.`);
  const steps = Object.fromEntries(STEP_NAMES.map(k => {
    const own = st[k] === undefined ? {} : obj(st[k], `steps.${k}`);
    if (own.glyph !== undefined && (typeof own.glyph !== 'string' || !own.glyph.trim() || [...own.glyph].length > 8)) fail(`"steps.${k}.glyph" is an emoji or a letter or two.`);
    const model = own.model === undefined ? null : asset(own.model, `steps.${k}.model`, MODEL);
    if (model) assets.add(model);
    return [k, { glyph: own.glyph ?? STEPS[k].glyph, verb: text(own.verb, 40, `steps.${k}.verb`, STEPS[k].verb) || STEPS[k].verb, model }];
  }));

  return {
    api: API, name: typeof j.name === 'string' ? j.name.slice(0, 40) : '', nouns, ground, camera, sky,
    speed: num(j.speed, 0.2, 10, 'speed', 1.6),
    spawn: j.spawn === undefined ? null : point(j.spawn, 'spawn'),
    plots, places, paths, prefabs, scenery, figure, steps,
    help: text(j.help, 600, 'help'),
    assets: [...assets].sort(),
  };
}

/** What is wrong with a world.json of api 2 (as parsed), in a sentence; null when it reads. */
export function checkManifest(j) {
  try { readManifest(j); return null; } catch (err) { return err.message; }
}

/** The fields of a world.json that this version does not read: a typo, most often. */
export const unknownFields = j => (isObj(j) ? Object.keys(j).filter(k => !KNOWN.includes(k)) : []);
