// A world of api 2, run in its frame. It reads the world's manifest (written into the frame's page by the
// collector), registers with the bridge (bridge.js) as any world does, and from then on joins three things:
// the simulation says where everyone is (core/sim.js here, or the collector's states through core/mirror.js),
// the stage draws it with three.js (stage/stage.js), and the HUD, tags and dialogs lie over it as HTML (ui/).
// Every world of api 2 runs through this file, so they all behave alike; a world differs by its world.json
// and by the hooks its sim.js and view.js register (plugins.js). The frame's module script.
import { bedsOf, eventsOf } from './core/events.js';
import { makeLayout } from './core/layout.js';
import { readManifest } from './core/manifest.js';
import { makeMirror } from './core/mirror.js';
import { makeSim } from './core/sim.js';
import { clip, esc } from './core/util.js';
import { fromWire, popFromWire } from './core/wire.js';
import { makeStage } from './stage/stage.js';
import { helpHtml, makeDialogs } from './ui/dialogs.js';
import { hudHtml } from './ui/hud.js';
import { makeOverlay } from './ui/overlay.js';

const A = window.Agentville;
const SKIES = ['live', 'day', 'night'];
const ACTIVE = new Set(['waiting', 'working', 'turn']);
const FRAME_MS = 33; // about thirty frames a second while nothing is being dragged: plenty, and easy on a laptop left open
const resting = a => a.state === 'idle' || a.state === 'stale';
/** How light it is at an hour of the day, from 0 (night) to 1 (day), with an hour or two of dawn and dusk. */
const lightAt = date => { const h = date.getHours() + date.getMinutes() / 60; return h >= 7 && h < 18 ? 1 : h >= 5 && h < 7 ? (h - 5) / 2 : h >= 18 && h < 20 ? 1 - (h - 18) / 2 : 0; };
// A hidden bubble stays hidden (as a 💬) while its agent is in the same situation: still waiting, or no new question or reply.
const sayKey = a => (a.state === 'waiting' ? 'waiting' : a.question ? `q:${a.question}` : `said:${a.said}`);

function start({ el, opts, prefs }, config) {
  const world = readManifest(config.manifest), layout = makeLayout(world), plugins = A.plugins ?? {}, nouns = world.nouns;
  const own = String(config.key).startsWith('u/');
  el.innerHTML = `<div class="wv"><canvas class="wv-canvas" aria-label="${esc(`The ${nouns.place}: every ${nouns.agent} is an agent, every ${nouns.repo} a repo`)}"></canvas><div class="wv-over"></div><div class="wv-hud px-hud"></div><div class="wv-loading"><span class="spinner"></span>Loading…</div></div>`;
  const root = el.firstElementChild, canvas = root.querySelector('canvas'), hudEl = root.querySelector('.wv-hud');
  const fail = (message, where = 'world') => A.send({ type: 'error', message: String(message).slice(0, 300), where });
  const bytes = path => opts.request('asset', { path }).then(r => { if (!r.ok || !(r.data instanceof ArrayBuffer)) throw new Error(r.error ?? `it could not be loaded (${r.status})`); return r.data; });

  let stage, running = false; // running: everything below is set up (a model that loads, or a hook, may ask for a frame before it is)
  try { stage = makeStage({ canvas, world, layout, bytes, view: plugins.view ?? {}, changed: () => { if (running) redraw(); }, onError: fail }); } catch (err) {
    root.querySelector('.wv-loading').textContent = 'This world is drawn with WebGL, which this browser has switched off.';
    fail(`WebGL: ${err?.message ?? err}`);
    return { scene() {}, select() {}, remote() {} };
  }
  const overlay = makeOverlay(root.querySelector('.wv-over'), { steps: world.steps, nouns });
  let scene = null, agents = new Map(), selected = null, hover = null, drawn = false;
  const dialogs = makeDialogs(root, { request: opts.request, nouns, colorOf: id => agents.get(id)?.color ?? '#9aa0a6', nameOf: id => agents.get(id)?.name });

  // This browser's own switches: they change how the world is shown, never where anyone is.
  let still = opts.still === true, saysOn = prefs.get('bubbles') !== 'off', restingShown = prefs.get('resting') !== 'hidden', panelOpen = prefs.get('panel') !== 'folded', menuOpen = false;
  let skyMode = SKIES.includes(prefs.get('sky')) ? prefs.get('sky') : 'live', bellOn = prefs.get('bell') === 'on';
  const zoomed = Number(prefs.get('zoom'));
  if (zoomed > 0) stage.rig.setZoom(zoomed);
  const closedSays = new Map(); // agent id → the situation its bubble was hidden in

  // Who moves the world: the collector (its states come through the mirror), or this page (its own simulation).
  let following = opts.remote === true, mirror = following ? makeMirror(reach) : null, sim = makeSim(world, plugins.sim ?? {});
  let heldTime = null;
  let T = 0, wall = null, flights = [], over = {}, shared = {}, lastState = null, simFailed = false;
  const keptBeds = new Map(), shows = [], log = [];
  let stoodAt = null; // with motion off, in a world the collector moves: where everyone stood in the frame last drawn
  let beds = new Map();
  /** A state of the collector's, as its moment comes: what the world itself shares is taken as it has it. */
  function reach(st) {
    for (const [k, json] of Object.entries(st.w ?? {})) { try { shared[k] = JSON.parse(json); } catch { /* not for us */ } }
    if (st.wk) for (const k of Object.keys(shared)) if (!st.wk.includes(k)) delete shared[k]; // what it shares no more
  }
  /** A scene for this page's own simulation; what a rule of the world's throws at it is said once. */
  function feed(next) {
    if (simFailed) return;
    try { sim.scene(next); } catch (err) { simFailed = true; fail(`sim.js: ${err?.message ?? err}`, 'sim.js'); }
  }
  const addLog = (who, state, text) => { log.unshift({ at: Date.now(), state, who, text }); log.length = Math.min(log.length, 8); opts.onDiary?.(log.map(l => ({ ...l }))); };
  const popAt = (x, z, text, cls) => { const at = stage.project(x, world.figure.height + 0.6, z); if (at && !still) overlay.pop(at[0], at[1], text, cls); };

  let hudHtmlNow = '', hudPressed = false; // the HUD as it is drawn: written again only when it says something else
  function renderHud() {
    const html = hudHtml({
      scene, nouns, own, orbit: !stage.rig.flat, still, zoom: stage.rig.zoom, saysOn, skyMode, follow: stage.rig.following, canFollow: Boolean(selected && lastState?.bodies.some(b => b.id === selected)),
      restingHidden: restingShown ? null : (scene?.agents ?? []).filter(resting).length, bell: bellOn, awake: prefs.get('awake') === 'on', nav: opts.navState?.() ?? {}, panelOpen, menuOpen,
    });
    if (html === hudHtmlNow || hudPressed) return; // (not while a button of it is held: the click would be lost with the button)
    const focused = document.activeElement?.closest?.('.wv-hud') ? document.activeElement.dataset.do : null;
    hudHtmlNow = html;
    hudEl.innerHTML = html;
    if (focused) hudEl.querySelector(`[data-do="${CSS.escape(focused)}"]`)?.focus?.(); // drawn anew, the keyboard stays where it was
    const panel = hudEl.querySelector('.px-stats');
    stage.rig.setSafe(panel.offsetLeft + panel.offsetWidth + 8, panel.offsetTop + panel.offsetHeight + 8); // the ground sits beside the panel or below it, not under it
  }

  /** How the world stands now: the collector's word for the moment shown, or this page's own simulation moved on by dt. */
  function stateNow(now, dt) {
    if (following) return mirror.at(now, still);
    if (!scene || simFailed) return null;
    let st;
    try {
      if (still) sim.settle(); else sim.step(dt);
      st = sim.state();
    } catch (err) { // a rule of the world's own threw: said once, and the world stands as it stood
      simFailed = true;
      fail(`sim.js: ${err?.message ?? err}`, 'sim.js');
      return null;
    }
    for (const e of st.fx) popAt(e.pop[0], e.pop[1], e.pop[2], e.pop[3]);
    if (st.shared) shared = st.shared;
    return st;
  }
  function draw(now, dt) {
    const st = stateNow(now, dt);
    if (st) {
      lastState = st;
      T = st.t;
      wall = st.wall;
      flights = st.flights;
      over = st.over;
      for (let i = 0; i < shows.length; i++) if (shows[i].t <= T + 1e-6 || shows[i].t > T + 2) { popAt(shows[i].x, shows[i].z, shows[i].text, shows[i].cls); shows.splice(i--, 1); } // what the collector said to show, at its moment
      stage.setBodies(restingShown ? st.bodies : st.bodies.filter(b => !agents.has(b.id) || !resting(agents.get(b.id))), shared);
    }
    stage.setSelected(selected);
    if (stage.rig.following && !stage.personOf(selected)) { stage.rig.follow(null); renderHud(); } // the one followed is gone (its session ended, or resting ones are hidden)
    stage.setLight(skyMode === 'day' ? 1 : skyMode === 'night' ? 0 : lightAt(new Date(wall ?? Date.now())));
    stage.frame(still ? 0 : dt, still ? (heldTime ??= T) : T, still ? [] : flights);
    const marks = stage.marks(), bubbles = new Map();
    for (const m of marks) {
      const a = agents.get(m.id), text = a && saysOn && ACTIVE.has(a.state) && !a.nap ? (a.state === 'waiting' ? a.ask : a.question || a.said) : '';
      if (text) bubbles.set(m.id, { text, min: m.compact && m.id !== selected && m.id !== hover || closedSays.get(m.id) === sayKey(a), toSidebar: a.state === 'waiting' || Boolean(a.question) || a.kind === 'codex' });
    }
    const placeMarks = [...layout.places.values()].flatMap(p => {
      const more = over[p.name] ?? 0;
      if (!p.label && !more) return [];
      const s = p.spots[0];
      return [{ name: p.name, text: `${p.label}${more ? ` +${more}` : ''}`.trim(), at: stage.project(s.x, 0, s.z + 0.9) }];
    });
    overlay.update({ marks, agents, selected, hover, bubbles, plotMarks: stage.plotMarks(), over, placeMarks, labels: stage.labels() });
    if (!drawn && scene) { drawn = true; root.querySelector('.wv-loading')?.remove(); }
  }

  // The loop: a frame at a time while the world moves; with motion off, a frame only when something changed.
  let raf = 0, last = 0, dragging = false;
  const visible = () => root.isConnected && !document.hidden;
  function frame(now) {
    raf = 0;
    if (still || !visible()) return;
    raf = requestAnimationFrame(frame);
    if (now - last < FRAME_MS && !dragging && !stage.rig.moving) return;
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    draw(now / 1000, dt);
  }
  const startLoop = () => { if (!raf && !still && visible()) { last = 0; raf = requestAnimationFrame(frame); } };
  /** Draws once, now: for motion off, and for whatever changed while no frame was due. */
  function redraw() { if (still) draw(performance.now() / 1000, 0); else startLoop(); }

  function setStill(next) {
    still = next;
    heldTime = next ? T : null;
    renderHud();
    if (still) { cancelAnimationFrame(raf); raf = 0; redraw(); } else startLoop();
    opts.onMotion?.(still);
  }
  function setRemote(on) {
    if (on === following) return;
    following = on;
    shows.length = 0;
    if (on) { mirror = makeMirror(reach); shared = {}; }
    else { mirror = null; wall = null; sim = makeSim(world, plugins.sim ?? {}); simFailed = false; if (scene) feed(scene); } // everyone finds their own way again, from their places
    redraw();
  }

  /** A building of the world, clicked ("opens" in world.json). */
  function openSpot(what) {
    if (what === 'session') opts.onStartSession?.();
    else if (what === 'repos') opts.onShowRepos?.();
    else if (what === 'help') dialogs.show(`How to read the ${nouns.place}`, helpHtml(world));
    else if (what === 'board') { const seen = new Set(); void dialogs.board((scene?.agents ?? []).filter(a => a.cwd && !seen.has(a.repo ?? a.cwd) && seen.add(a.repo ?? a.cwd)).slice(0, 8)); }
  }
  const openPlot = bed => { const r = scene?.repos.find(x => beds.get(x.key) === bed); if (r) void dialogs.repo(r); };
  const sw = (name, value) => { prefs.set(name, value); renderHud(); redraw(); };

  let dragged = false; // a drag has just ended: the click that follows it is not a pick
  root.addEventListener('click', e => {
    if (dragged) { dragged = false; return; }
    const t = e.target;
    if (dialogs.open && t.closest('.wv-dlg')) {
      const asked = dialogs.click(t);
      if (asked?.close) dialogs.close();
      if (asked?.doc) { dialogs.close(); opts.onOpenDoc?.(...asked.doc); }
      return;
    }
    const what = t.closest('[data-do]')?.dataset.do ?? '';
    // The Menu: its button opens and shuts it; a click anywhere else shuts it (and does what it does). In it, the
    // switches and zoom leave it open, to change several; a button that takes you elsewhere shuts it first.
    if (what === 'menu') { menuOpen = !menuOpen; renderHud(); if (menuOpen) hudEl.querySelector('.px-menu button:not(:disabled)')?.focus?.(); return; }
    if (menuOpen && (!t.closest('.px-menu') || what === 'help' || (what.startsWith('nav:') && what !== 'nav:theme'))) { menuOpen = false; renderHud(); }
    const [name, arg] = what.split(':');
    switch (name) {
      case 'panel': panelOpen = !panelOpen; sw('panel', panelOpen ? 'open' : 'folded'); return;
      case 'nav': opts.onNav?.(arg); renderHud(); return;
      case 'state': { const a = scene?.agents.find(x => x.state === arg); if (a) opts.onPickAgent?.(a.id); return; }
      case 'need': { const a = scene?.agents.find(x => x.state === 'waiting') ?? scene?.agents.find(x => x.question); if (a) opts.onPickAgent?.(a.id); return; }
      case 'follow': stage.rig.follow(stage.rig.following ? null : stage.personOf(selected)); renderHud(); redraw(); return;
      case 'resting': restingShown = !restingShown; sw('resting', restingShown ? 'shown' : 'hidden'); return;
      case 'bubbles': saysOn = !saysOn; if (saysOn) closedSays.clear(); sw('bubbles', saysOn ? 'on' : 'off'); return;
      case 'sky': skyMode = SKIES[(SKIES.indexOf(skyMode) + 1) % SKIES.length]; sw('sky', skyMode); return;
      case 'motion': setStill(!still); return;
      case 'bell': bellOn = !bellOn; prefs.set('bell', bellOn ? 'on' : 'off'); opts.onBell?.(bellOn); renderHud(); return;
      case 'awake': opts.onAwake?.(prefs.get('awake') !== 'on'); renderHud(); setTimeout(renderHud, 500); return; // the page keeps the screen on, and says in its settings whether it could
      case 'help': openSpot('help'); return;
      case 'zoom': stage.rig.zoomBy(Number(arg)); sw('zoom', String(stage.rig.zoom)); return;
      case 'say-close': { const id = t.closest('[data-say]').dataset.say, a = agents.get(id); if (a) closedSays.set(id, sayKey(a)); redraw(); return; }
      case 'say-open': closedSays.delete(t.closest('[data-say]').dataset.say); redraw(); return;
      default:
    }
    const tag = t.closest('[data-agent]');
    if (tag) { opts.onPickAgent?.(tag.dataset.agent); return; }
    const say = t.closest('[data-say]');
    if (say) { opts.onPickAgent?.(say.dataset.say, { from: 'say' }); return; }
    const label = t.closest('[data-label]');
    if (label) { const l = stage.labels().find(x => x.key === label.dataset.label); if (l?.agent) opts.onPickAgent?.(l.agent); else if (l?.detail) dialogs.show(l.title ?? 'Score', `<p>${esc(l.detail).replaceAll('\n', '<br>')}</p>`); return; }
    const plot = t.closest('[data-plot]');
    if (plot) { openPlot(Number(plot.dataset.plot)); return; }
    if (t !== canvas) return;
    const r = canvas.getBoundingClientRect(), hit = stage.pick(e.clientX - r.left, e.clientY - r.top);
    if (hit?.agent) opts.onPickAgent?.(hit.agent);
    else if (hit?.opens) openSpot(hit.opens);
    else if (hit?.plot !== undefined) openPlot(hit.plot);
  });

  // Dragging moves the view (with the right button or Alt, turns it, in a view that turns); two fingers pinch to zoom. A drag is never a click.
  const pointers = new Map();
  let pinch = 0, hoveredAt = 0;
  canvas.addEventListener('contextmenu', e => { if (!stage.rig.flat) e.preventDefault(); });
  canvas.addEventListener('pointerdown', e => { pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, moved: false, turn: e.button === 2 || e.altKey }); pinch = 0; });
  canvas.addEventListener('pointermove', e => {
    const p = pointers.get(e.pointerId);
    if (!p) { // no button down: what is under the pointer (looked up a few times a second, not for every pixel it moves)
      if (e.timeStamp - hoveredAt < 60) return;
      hoveredAt = e.timeStamp;
      const r = canvas.getBoundingClientRect(), hit = stage.pick(e.clientX - r.left, e.clientY - r.top), id = hit?.agent ?? null;
      canvas.style.cursor = hit?.agent || hit?.opens || hit?.plot !== undefined ? 'pointer' : '';
      canvas.title = hit?.tip ?? '';
      if (id !== hover) { hover = id; redraw(); }
      return;
    }
    if (e.pointerType === 'mouse' && !e.buttons) { release(e); return; } // its button was let go somewhere this canvas did not hear of
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (!p.moved && Math.hypot(dx, dy) < 5) return;
    if (!p.moved) { p.moved = dragging = true; canvas.setPointerCapture?.(e.pointerId); root.classList.add('panning'); }
    p.x = e.clientX; p.y = e.clientY;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()], apart = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch) stage.rig.setZoom(stage.rig.zoom * (apart / pinch));
      pinch = apart;
    } else if (p.turn) stage.rig.turnBy(dx, dy); else stage.rig.panBy(dx, dy);
    redraw();
  });
  function release(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    pointers.delete(e.pointerId);
    if (p.moved) { dragged = true; setTimeout(() => { dragged = false; }, 0); }
    if (pointers.size || !dragging) return;
    dragging = false; // the last finger is up: the drag (or the pinch) is over
    root.classList.remove('panning');
    prefs.set('zoom', String(stage.rig.zoom));
    renderHud();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  hudEl.addEventListener('pointerdown', () => { hudPressed = true; });
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, () => { if (hudPressed) { hudPressed = false; setTimeout(renderHud, 0); } }); // (after the click it ends in)
  canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; redraw(); } });
  let wheel = 0;
  canvas.addEventListener('wheel', e => { // ⌘/Ctrl + scroll (or a trackpad pinch) zooms; plain scrolling moves around
    e.preventDefault();
    if (!e.ctrlKey && !e.metaKey) { stage.rig.panBy(-e.deltaX, -e.deltaY); redraw(); return; }
    wheel += e.deltaY;
    if (Math.abs(wheel) < 40) return;
    stage.rig.zoomBy(wheel < 0 ? 1 : -1);
    wheel = 0;
    sw('zoom', String(stage.rig.zoom));
  }, { passive: false });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menuOpen) { menuOpen = false; renderHud(); hudEl.querySelector('[data-do="menu"]')?.focus?.(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) startLoop(); });
  canvas.addEventListener('webglcontextlost', e => e.preventDefault()); // three.js takes the context back when the browser gives it again
  canvas.addEventListener('webglcontextrestored', () => redraw());
  new ResizeObserver(() => { stage.resize(); overlay.measureAgain(); renderHud(); redraw(); }).observe(root);
  setInterval(() => { if (!document.hidden) { renderHud(); if (still && following) redraw(); } }, 1000); // the page's own settings (theme, sidebar, live) and "5m ago" stay fresh; with motion off, the world's own things once a second
  stage.resize();
  renderHud();
  running = true;
  startLoop();
  A.statsNow = () => stage.stats(); // read-only: what the last frame took (the browser test)

  return {
    scene(next) {
      for (const e of eventsOf(scene, next)) { // the diary: what happened since the last scene
        const a = next.agents.find(x => x.id === (e.agent ?? e.from)), r = e.repo ? next.repos.find(x => x.key === e.repo) : null;
        if (e.kind === 'mail') { const to = next.agents.find(x => x.id === e.to); if (a && to) addLog(a.name, a.state, `sends a note to ${to.name}${e.text ? `: ${clip(e.text, 60)}` : ''}`); }
        else if (a) addLog(a.name, a.state, e.text.toLowerCase());
        else if (r) addLog(r.name, 'turn', e.text.toLowerCase());
      }
      if (!scene && next.agents.length) addLog('', 'working', `${next.agents.length} ${next.agents.length === 1 ? nouns.agent : nouns.agents} here`);
      scene = next;
      agents = new Map(next.agents.map(a => [a.id, a]));
      beds = bedsOf(next.repos, keptBeds, world.plots?.at.length);
      stage.setScene(next, beds);
      if (!following) feed(next);
      renderHud();
      redraw();
    },
    select(id) {
      selected = id ?? null;
      if (stage.rig.following) stage.rig.follow(selected ? stage.personOf(selected) : null); // Follow goes over to the one picked now
      renderHud();
      redraw();
    },
    /** From the page, for a world the collector moves: { on } says whether it does, { s } is a state, { fx } something to show. */
    remote(m) {
      if (typeof m?.on === 'boolean') setRemote(m.on);
      if (!following) return;
      if (m.s && Number.isFinite(m.s.t)) {
        const st = fromWire(m.s);
        mirror.push(st, performance.now() / 1000);
        const places = still ? st.bodies.map(b => `${b.id}:${b.tx},${b.tz}`).join(' ') : '';
        if (still && places !== stoodAt) { stoodAt = places; redraw(); } // motion off: a frame when someone's place changed, not for every state
      }
      const shown = popFromWire(m.fx);
      if (shown && shows.length < 200) shows.push(shown);
    },
  };
}

// Registered with the bridge as soon as this module runs: the page starts the world once the frame has loaded.
let config = null, live = null;
try { config = JSON.parse(document.getElementById('world').textContent); } catch (err) { A.send({ type: 'error', message: `The world's page could not be read: ${err.message}`, where: 'frame' }); }
if (config) {
  A.raw({
    start(given) { live = start(given, config); },
    scene(s) { live?.scene(s); },
    select(id) { live?.select(id); },
    remote(m) { live?.remote(m); },
  }, { engine: true }); // its HUD has the dashboard's buttons
}
