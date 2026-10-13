// Worlds of api 2 on disk and on their way to the browser (collector/worlds.mjs, server.mjs): how one is
// listed, the page its frame loads and the policy that page is served with, three.js by name and nothing
// else of it, a model's bytes; and the worlds that come with Agentville, checked as any world is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { FILE_LINKS, SYSTEM_FILE, link } from './portable.mjs';
import { createTrackerServer } from '../server.mjs';
import { API_VERSION, FRAME_CSP, checkWorldJson, frameCsp, makeWorlds } from '../worlds.mjs';
import { readManifest } from '../../web/worlds/sdk/core/manifest.js';
import { checkSim } from '../../scripts/lib/sim-check.mjs';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url)), ROOT = fileURLToPath(new URL('../../', import.meta.url));
const builtinDir = `${WEB}worlds`;
const temps = [], servers = [];
after(async () => { for (const s of servers) await s.close(); for (const t of temps) rmSync(t, { recursive: true, force: true }); });
/** A folder of your worlds: { name: { 'world.json': object | text, 'sim.js': text, … } }; `starter: true` copies the starter first. */
function folder(worlds) {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-sdk-worlds-'));
  temps.push(dir);
  for (const [name, files] of Object.entries(worlds)) {
    if (files.starter) cpSync(`${builtinDir}/starter`, join(dir, name), { recursive: true }); else mkdirSync(join(dir, name));
    for (const [f, text] of Object.entries(files)) {
      if (f === 'starter') continue;
      mkdirSync(join(dir, name, f, '..'), { recursive: true });
      writeFileSync(join(dir, name, f), typeof text === 'string' || Buffer.isBuffer(text) ? text : JSON.stringify(text));
    }
  }
  return dir;
}
const TINY = { api: 2, name: 'Tiny', places: { wait: { spots: [[4, 4]] }, idle: { spots: [[20, 4]] } } };
const get = (port, path, headers = {}) => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, headers }, res => { const chunks = []; res.on('data', c => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) })); });
  req.on('error', reject);
  req.end();
});
async function serve(userDir = null) {
  const none = async () => ({ status: 404, error: 'none' });
  const srv = createTrackerServer({ port: 0, token: 'tok', webFile: `${WEB}index.html`, worlds: makeWorlds({ builtinDir, userDir }), getSnapshot: () => ({ generatedAt: Date.now(), agents: [], repos: [] }), getFeed: () => [], getConversation: async () => null, actions: {}, readFile: none, listFiles: none, repoTouched: none });
  servers.push(srv);
  return srv.listen();
}

/* ---------- on disk ---------- */

test('world.json: api 2 is the one to write; what is wrong with one is said as the SDK says it', () => {
  assert.equal(API_VERSION, 2);
  assert.equal(checkWorldJson(TINY), null);
  assert.equal(checkWorldJson({ name: 'x' }), 'world.json needs "api": 2.');
  assert.match(checkWorldJson({ ...TINY, api: 3 }), /needs a newer Agentville \(it was made for api 3; this one has 2\)/);
  assert.equal(checkWorldJson({ ...TINY, places: { wait: TINY.places.wait } }), 'world.json: "places.idle" is missing: a world needs at least "wait" and "idle".');
  assert.equal(checkWorldJson({ ...TINY, name: '' }), 'world.json needs a "name", up to 40 characters.', 'its name, icon and description are checked as ever');
  assert.equal(checkWorldJson({ ...TINY, nouns: { place: 'x'.repeat(31) } }), 'world.json: "nouns" are short words.');
  assert.equal(checkWorldJson({ name: 'Old', api: 1 }), null, 'LEGACY: a world of the pixel engine still reads');
});

test('a world of api 2 is listed with its api; it needs no code of its own, but every file it names', () => {
  const dir = folder({
    plain: { 'world.json': TINY },
    full: { 'world.json': { ...TINY, name: 'Full', nouns: { place: 'club' }, scenery: [{ model: 'assets/tree.glb' }] }, 'assets/tree.glb': 'glb', 'sim.js': '', 'view.js': '' },
    'no-tree': { 'world.json': { ...TINY, figure: { model: 'assets/person.glb' } } },
    typo: { 'world.json': { ...TINY, camera: { view: 'fisheye' } } },
  });
  if (FILE_LINKS) link(SYSTEM_FILE, join(dir, 'no-tree', 'assets-link.glb'));
  const w = makeWorlds({ builtinDir, userDir: dir }), by = Object.fromEntries(w.list().map(x => [x.key, x]));
  assert.deepEqual([by['u/plain'].api, by['u/plain'].error, by['u/full'].error, by['u/full'].nouns], [2, null, null, { place: 'club' }]);
  assert.equal(by['u/no-tree'].error, 'assets/person.glb is missing (or is a link out of the folder).');
  assert.equal(by['u/typo'].error, 'world.json: "camera.view" is one of iso, tilt, top, orbit.');
  assert.deepEqual([by.farm.api, by.factory.api, by.tennis.api], [1, 1, 2]);
  assert.deepEqual(w.source('u/plain'), { api: 2, json: join(dir, 'plain', 'world.json').replace(/^\/var\//, '/private/var/'), sim: null });
  assert.ok(w.source('u/full').sim.endsWith(join('full', 'sim.js')));
  assert.equal(w.source('u/typo'), null, 'a world that can not run has nothing to be moved with');
  assert.ok(w.source('farm').world.endsWith(join('farm', 'world.js')), 'LEGACY: a world of the pixel engine is moved with its world.js');
  assert.deepEqual([w.file('u/full', 'assets/tree.glb').type, w.file('u/full', 'assets/tree.glb').size], ['model/gltf-binary', 3]);
});

test("the frame's page: the SDK by addresses relative to its own, the world's code only where it has any, its world.json written in", () => {
  const dir = folder({ plain: { 'world.json': { ...TINY, description: 'It says </script><script>alert(1)</script> & <b>' } }, full: { starter: true } });
  const w = makeWorlds({ builtinDir, userDir: dir });
  const builtIn = w.frame('tennis'), plain = w.frame('u/plain'), full = w.frame('u/full');
  assert.match(builtIn, /<script type="importmap">\{"imports":\{"three":"\.\.\/sdk\/three\/three\.module\.js","three\/addons\/":"\.\.\/sdk\/three\/addons\/"\}\}<\/script>/);
  assert.deepEqual([...builtIn.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]), ['../../base.css', '../sdk/world.css', '../sdk/ui/world-ui.css', '../sdk/bridge.js', '../../brand.js', '../sdk/ui/pixel-text.js', '../sdk/ui/pixel-hud.js', '../sdk/plugins.js', 'sim.js', 'view.js', '../sdk/runtime.js'], 'the tennis club keeps the SDK frame and registers its rules and sprites');
  assert.deepEqual([...plain.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]), ['../../../base.css', '../../sdk/world.css', '../../sdk/ui/world-ui.css', '../../sdk/bridge.js', '../../../brand.js', '../../sdk/ui/pixel-text.js', '../../sdk/ui/pixel-hud.js', '../../sdk/plugins.js', '../../sdk/runtime.js'], 'one of yours is a folder deeper; with no code of its own, none is loaded');
  assert.ok(full.includes('<script src="sim.js" crossorigin="anonymous"></script><script src="view.js" crossorigin="anonymous"></script>'));
  assert.ok(!/(?:src|href)="\//.test(builtIn + plain), "no address starts at the server's root: a guest's pass in the path carries over");
  const block = /<script type="application\/json" id="world">([\s\S]*?)<\/script>/.exec(plain)[1];
  assert.ok(!block.includes('<'), 'nothing in it can end the block it is written into');
  const config = JSON.parse(block);
  assert.equal(config.key, 'u/plain');
  assert.equal(config.manifest.description, 'It says </script><script>alert(1)</script> & <b>');
  assert.doesNotThrow(() => readManifest(config.manifest));
  assert.match(w.frame('farm'), /\/world\/legacy\/engine\.js/, "LEGACY: a world of the pixel engine gets the pixel engine's frame");
  // A world named after the template's own marks: its name is its title and nothing more
  const marks = makeWorlds({ builtinDir, userDir: folder({ marks: { 'world.json': { ...TINY, name: '__WORLD__ __SIM__ __WORLDS__', description: '__VIEW__ __ROOT__' }, 'view.js': '' } }) }).frame('u/marks');
  assert.ok(marks.includes('<title>__WORLD__ __SIM__ __WORLDS__</title>'));
  assert.equal(JSON.parse(/<script type="application\/json" id="world">([\s\S]*?)<\/script>/.exec(marks)[1]).manifest.description, '__VIEW__ __ROOT__');
  assert.equal(marks.replace(/<title>.*<\/title>/, '').replace(/id="world">[\s\S]*?<\/script>/, '').match(/__[A-Z]+__/), null, 'and every mark of the template itself is filled in');
  assert.match(marks, /<script src="view\.js" crossorigin="anonymous"><\/script>\r?\n/);
});

test("a frame's policy: the one every world has, and for a frame with an import map that one block by its hash", () => {
  const w = makeWorlds({ builtinDir });
  const html = w.frame('tennis'), map = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
  const hash = `'sha256-${createHash('sha256').update(map).digest('base64')}'`;
  assert.equal(frameCsp(html), FRAME_CSP.replace("script-src 'self'", `script-src 'self' ${hash}`));
  for (const part of ['sandbox allow-scripts', "default-src 'none'", "connect-src 'none'", "worker-src 'none'", "frame-src 'none'", "form-action 'none'"]) assert.ok(frameCsp(html).includes(part), part);
  assert.ok(!/unsafe-inline'; style|unsafe-eval|wasm/.test(frameCsp(html).split('style-src')[0]), 'no inline script but that one, no eval');
  assert.equal(frameCsp(w.frame('farm')), FRAME_CSP, 'LEGACY: a frame without an import map has the policy as it always was');
  assert.notEqual(frameCsp(html), frameCsp(html.replace('"three"', '"three" ')), 'a block changed by a letter is another block');
});

test('three.js is served from the installed package by name: the files the SDK loads, and nothing else of it', () => {
  const w = makeWorlds({ builtinDir });
  for (const f of ['three/three.module.js', 'three/three.core.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/utils/SkeletonUtils.js']) {
    const got = w.file('sdk', f);
    assert.ok(got.real?.includes(`${sep}node_modules${sep}three${sep}`) && got.size > 1000 && got.type === 'text/javascript; charset=utf-8', f);
  }
  for (const f of ['three/package.json', 'three/three.webgpu.js', 'three/addons/loaders/DRACOLoader.js', 'three/../../../package.json', 'three/addons/../three.cjs', 'three/src/Three.js']) assert.equal(w.file('sdk', f).status, 404, f);
  assert.equal(w.file('tennis', 'three/three.module.js').status, 404, "only under the SDK's name");
  // every module the SDK's files and three's own name is one of those served
  const served = new Set(['three/three.module.js', 'three/three.core.js', 'three/addons/loaders/GLTFLoader.js', 'three/addons/utils/BufferGeometryUtils.js', 'three/addons/utils/SkeletonUtils.js']);
  const imports = f => [...readFileSync(w.file('sdk', f).real, 'utf8').matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);
  for (const f of served) for (const spec of imports(f)) {
    const to = spec === 'three' ? 'three/three.module.js' : posix.join(f, '..', spec);
    assert.ok(served.has(to), `${f} imports ${spec}`);
  }
});

test('served: the frame with its policy, the SDK as modules a sandboxed frame may load, a model as bytes that only the page can read', async () => {
  const port = await serve();
  const frame = await get(port, '/world/tennis/');
  assert.equal(frame.status, 200);
  assert.equal(frame.headers['content-security-policy'], frameCsp(String(frame.body)));
  assert.match(frame.headers['content-security-policy'], /script-src 'self' 'sha256-[A-Za-z0-9+/=]+';/);
  const fromFrame = { origin: 'null', 'sec-fetch-dest': 'script' };
  for (const path of ['/world/sdk/runtime.js', '/world/sdk/core/sim.js', '/world/sdk/stage/stage.js', '/world/sdk/three/three.module.js', '/world/sdk/three/addons/loaders/GLTFLoader.js', '/world/tennis/view.js']) {
    const r = await get(port, path, fromFrame);
    assert.deepEqual([r.status, r.headers['content-type'], r.headers['access-control-allow-origin']], [200, 'text/javascript; charset=utf-8', 'null'], path);
  }
  const model = await get(port, '/world/tennis/assets/player.glb');
  assert.deepEqual([model.status, model.headers['content-type'], model.body.readUInt32LE(0)], [200, 'model/gltf-binary', 0x46546c67]);
  const fetched = await get(port, '/world/tennis/assets/player.glb', { origin: 'null', 'sec-fetch-dest': 'empty' });
  assert.equal(fetched.headers['access-control-allow-origin'], undefined, "a frame's own fetch of it could not be read, were its policy to let it try");
  assert.equal((await get(port, '/world/sdk/frame.html')).status, 404, "the frame's page is served filled in, never as it is");
  assert.equal((await get(port, '/world/sdk/three/package.json')).status, 404);
});

/* ---------- the worlds that come with Agentville ---------- */

for (const key of ['starter', 'tennis']) {
  test(`the ${key}: its world.json reads, every file it names is there, and its simulation runs the whole tour`, async () => {
    const dir = join(builtinDir, key), j = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'));
    assert.equal(checkWorldJson(j), null);
    assert.ok(readFileSync(join(dir, 'world.json'), 'utf8').split('\n').length <= 120, 'short enough to read at once');
    const r = await checkSim({ dir });
    assert.deepEqual([r.json, r.errors], [null, []]);
    assert.ok(r.ran >= 30, `${r.ran} stops`);
    assert.deepEqual(r.notes.filter(n => !/view\.js is read for syntax only/.test(n)), [], 'no place too small for a stop, nothing off the ground, no field it does not know');
  });
}

test("the starter is new-world's template and never in the list; it shows every hook file a world may have", () => {
  const w = makeWorlds({ builtinDir });
  assert.ok(!w.list().some(x => x.key === 'starter'));
  assert.equal(w.info('starter')?.api, 2);
  for (const [file, kind] of [['sim.js', 'sim'], ['view.js', 'view']]) {
    const A = {};
    const ctx = vm.createContext({ globalThis: null, Agentville: A });
    vm.runInContext('globalThis = this;', ctx);
    vm.runInContext(readFileSync(`${builtinDir}/sdk/plugins.js`, 'utf8'), ctx);
    vm.runInContext(readFileSync(`${builtinDir}/starter/${file}`, 'utf8'), ctx);
    assert.ok(Object.keys(ctx.Agentville.plugins[kind]).length > 0, `${file} registers its hooks`);
    assert.ok(readFileSync(`${builtinDir}/starter/${file}`, 'utf8').split('\n').length <= 40, `${file} is short`);
  }
});

test("the models the built-in worlds ship with are what scripts/world-assets.mjs makes", () => {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'world-assets.mjs'), '--check'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /same {2}tennis\/assets\/player\.glb/);
});

/* ---------- check-world, for a world of api 2 ---------- */

test('check-world: what is wrong with world.json, a file it names that is not there, a sim.js that throws (with its stop and line), a view.js that does not parse', async () => {
  const dir = folder({
    typo: { 'world.json': { ...TINY, speed: 99 } },
    unread: { 'world.json': '{ not json' },
    lost: { 'world.json': { ...TINY, scenery: [{ model: 'assets/tree.glb' }], senery: [] } },
    throws: { 'world.json': TINY, 'sim.js': "Agentville.sim({\n  place(ctx, a) {\n    if (a.state === 'stale') throw new Error('no place for the stale');\n  },\n});", 'view.js': 'Agentville.view({ setup(ctx) { );' },
    hangs: { 'world.json': TINY, 'sim.js': 'Agentville.sim({ tick() { while (true) {} } });' },
    small: { 'world.json': { ...TINY, places: { ...TINY.places, far: { spots: [[400, 4]] } } }, 'sim.js': "Agentville.sim({ place: (ctx, a) => (a.id === 'a3' ? null : undefined), tick() { console.warn('ticking'); } });" },
  });
  assert.equal((await checkSim({ dir: join(dir, 'typo') })).json, 'world.json: "speed" is a number from 0.2 to 10.');
  assert.match((await checkSim({ dir: join(dir, 'unread') })).json, /world\.json can't be read/);
  assert.equal((await checkSim({ dir: join(dir, 'nowhere') })).json, 'world.json is missing.');
  const lost = await checkSim({ dir: join(dir, 'lost') });
  assert.deepEqual(lost.errors, [{ stop: '(loading)', message: 'assets/tree.glb is missing.', where: 'world.json' }]);
  assert.equal(lost.notes[0], 'world.json: "senery" is not a field this version reads');
  assert.ok(lost.notes.includes('idle has 21 more than it has spots at "steps": they are counted, not shown'), 'a place too small for a stop of the tour is pointed out, with the stop');
  const t = await checkSim({ dir: join(dir, 'throws') });
  assert.deepEqual(t.errors[0], { stop: '(loading)', message: "view.js does not parse: unexpected token in expression: ')'", where: 'view.js:1' });
  assert.deepEqual(t.errors.slice(1).map(e => [e.stop, e.message, e.where]), [['everyone', 'no place for the stale', 'sim.js:3'], ['stale', 'no place for the stale', 'sim.js:3'], ['day', 'no place for the stale', 'sim.js:3'], ['night', 'no place for the stale', 'sim.js:3'], ['private', 'no place for the stale', 'sim.js:3']]);
  const h = await checkSim({ dir: join(dir, 'hangs'), callMs: 150 });
  assert.deepEqual(h.errors.map(e => [e.stop, e.message]).slice(-1), [['(stopped)', 'three stops did not answer: the rest of the tour was skipped']]);
  assert.equal(h.errors.length, 4);
  const s = await checkSim({ dir: join(dir, 'small') });
  assert.deepEqual(s.errors, []);
  assert.equal(s.notes[0], 'places.far has spots off the ground (48 × 32 m)');
  assert.ok(s.notes.includes('1 not shown at "everyone": sim.js\'s place() gave them no place'), s.notes.join(' | '));
  assert.equal(s.notes.at(-1), 'its console: ticking');
});

test('check-world, the command: a world of api 2 is checked contained, its own code where it can reach nothing; exit 1 with a ✗ line for a problem', () => {
  const dir = folder({ club: { starter: true }, bad: { 'world.json': TINY, 'sim.js': "Agentville.sim({ scene() { throw new Error('\\x1b[31mred'); } });" }, out: { 'world.json': TINY } });
  writeFileSync(join(dir, 'secret.txt'), 'the neighbour');
  if (FILE_LINKS) link(join(dir, 'secret.txt'), join(dir, 'out', 'sim.js'));
  const run = name => spawnSync(process.execPath, [join(ROOT, 'scripts', 'check-world.mjs'), `u/${name}`, '--worlds', dir], { encoding: 'utf8', timeout: 60_000 });
  const ok = run('club');
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /^check-world: u\/club \(/);
  assert.match(ok.stdout, /· contained: it can read only the SDK and this world's folder, and can't write or start programs; the world's own code runs where it can reach nothing/);
  assert.match(ok.stdout, /✓ \d+ stops of the tour/);
  const bad = run('bad');
  assert.equal(bad.status, 1, bad.stdout + bad.stderr);
  assert.match(bad.stdout, /✗ 0 stops of the tour: 34 problems\n {2}✗ everyone \(and 33 more stops\): red \(sim\.js:1\)\n/, 'with its stop and line, said once for all the stops it happens at');
  assert.ok(!bad.stdout.includes('\x1b'), "no control sequence of the world's reaches your terminal");
  if (FILE_LINKS) {
    const out = run('out');
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stdout, /✗ \(loading\): sim\.js is a link out of the world's folder, or not a file\./);
    assert.ok(!out.stdout.includes('neighbour'));
  }
});

/* ---------- the guide (docs/worlds.md) says what the code does ---------- */

const guide = readFileSync(join(ROOT, 'docs', 'worlds.md'), 'utf8').replace(/\r\n/g, '\n'); // normalize Windows line ends
const blocks = lang => [...guide.matchAll(new RegExp('```' + lang + '\\n([\\s\\S]*?)```', 'g'))].map(m => m[1]);

test("the guide's world.json examples read as written: the whole world, and each piece put into one", () => {
  const pieces = blocks('json');
  assert.ok(pieces.length >= 7, `${pieces.length} examples`);
  let whole = 0;
  for (const text of pieces) {
    const t = text.trim();
    const j = t.startsWith('{') ? JSON.parse(t) : t.startsWith('"wait"') ? { ...TINY, places: JSON.parse(`{${t}}`) } : { ...TINY, ...JSON.parse(`{${t}}`) };
    if (t.startsWith('{')) whole++;
    assert.equal(checkWorldJson(j), null, t.slice(0, 60));
  }
  assert.equal(whole, 1, 'the smallest world, whole');
});

test("the guide's table of steps is the SDK's: each step's sign and word", async () => {
  const { STEPS } = await import('../../web/worlds/sdk/core/steps.js');
  for (const [name, { glyph, verb }] of Object.entries(STEPS)) {
    const cell = name === 'planMode' ? `| \`planMode\` | ${glyph} drawing up plans |` : `| \`${name}\` | ${glyph} ${verb} |`;
    assert.ok(guide.includes(cell), cell);
  }
});

test("the guide's sim.js examples run where the collector runs them, and its view.js examples parse", async () => {
  const { CORE, PLUGINS, loadSimShutIn, syntaxProblem } = await import('../live-world.mjs');
  const core = CORE.map(f => [f, readFileSync(`${WEB}worlds/sdk/core/${f}`, 'utf8')]), plugins = readFileSync(WEB + PLUGINS, 'utf8');
  const js = blocks('js'), sims = js.filter(t => t.includes('Agentville.sim(')), views = js.filter(t => t.includes('Agentville.view('));
  assert.deepEqual([sims.length, views.length], [2, 1]);
  for (const sim of sims) {
    const w = await loadSimShutIn({ core, plugins, manifest: JSON.stringify({ ...TINY, places: { ...TINY.places, board: { spots: [[9, 9]] } } }), sim });
    try {
      w.scene(JSON.stringify({ agents: [{ id: 'a', name: 'a', state: 'working', mode: 'plan' }], repos: [], mail: [] }));
      const st = w.step(4);
      assert.ok(st.bodies[0][6] === 'board' || Number.isFinite(st.shared?.ball), sim.slice(0, 60));
    } finally { w.stop(); }
  }
  for (const view of views) assert.equal(await syntaxProblem(view, 'view.js'), null);
});

test('the guide names the limits the code has', async () => {
  const { BEDS_MAX } = await import('../../web/worlds/sdk/core/manifest.js');
  assert.equal(BEDS_MAX, 18);
  assert.match(guide, /a number from 0\s+to 17/);
  assert.match(guide, /64 MB of memory, 3 s to load and 0\.8 s a step/);
  assert.match(guide, /16 keys, names of\s+letters and digits up to 24, 16 KB each/);
  assert.match(guide, /16 MB at most/);
  for (const reserved of ['sdk', 'legacy', 'starter', 'legacy-starter', 'test', 'u']) assert.ok(guide.includes(`\`${reserved}\``), reserved);
  assert.match(readFileSync(`${WEB}worlds.js`, 'utf8'), /ASSET_BYTES_MAX = 16 \* 1024 \* 1024/);
  assert.match(readFileSync(join(ROOT, 'collector', 'live-world.mjs'), 'utf8'), /memoryMb = 64, loadMs = 3000, callMs = 800/);
});

/* ---------- the SDK's layers ---------- */

test("the SDK's layers stay apart: the simulation knows no three.js and no page, the stage and the HUD build on it, nothing builds on the pixel engine", async () => {
  const { readdirSync } = await import('node:fs');
  const sdk = `${builtinDir}/sdk`, importsOf = f => [...readFileSync(f, 'utf8').matchAll(/^\s*import\b[^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]);
  const files = dir => readdirSync(join(sdk, dir)).filter(f => f.endsWith('.js')).map(f => join(sdk, dir, f));
  for (const f of files('core')) {
    for (const spec of importsOf(f)) assert.match(spec, /^\.\/[a-z]+\.js$/, `${f} imports ${spec}: the simulation imports only its own modules`);
    assert.doesNotMatch(readFileSync(f, 'utf8'), /\b(?:document|window|requestAnimationFrame|localStorage|fetch)\b\s*[.(]/, `${f} reaches for the page: it runs on the collector too`);
  }
  for (const f of files('ui')) for (const spec of importsOf(f)) assert.match(spec, /^\.\.\/core\/[a-z]+\.js$/, `${f} imports ${spec}: the HUD builds on the simulation's words only`);
  for (const f of files('stage')) for (const spec of importsOf(f)) assert.match(spec, /^(three|three\/addons\/[\w/]+\.js|\.\/[a-z]+\.js|\.\.\/core\/[a-z]+\.js)$/, `${f} imports ${spec}`);
  for (const spec of importsOf(join(sdk, 'runtime.js'))) assert.match(spec, /^\.\/(core|stage|ui)\/[a-z]+\.js$/, `runtime.js imports ${spec}`);
  for (const dir of ['core', 'stage', 'ui']) for (const f of files(dir)) assert.doesNotMatch(readFileSync(f, 'utf8'), /legacy\//, `${f} names the pixel engine`);
  const { CORE } = await import('../live-world.mjs');
  assert.deepEqual([...CORE].sort(), readdirSync(join(sdk, 'core')).filter(f => f !== 'mirror.js').sort(), 'the collector is handed every module of the simulation (all but the mirror, which only a browser plays back)');
});
