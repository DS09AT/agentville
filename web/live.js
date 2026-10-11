// The page's line to a world the collector moves (collector/live.mjs): one room for each built-in world, so
// everyone who has the dashboard open sees the same farmers walk and the same animals play, at the same
// moment. The collector sends how the world stands twenty times a second, as binary changes (Colyseus);
// this hands each state to the page (web/worlds.js), which gives it to the world's frame, and sends up what
// is asked of an animal. It holds the connection because a frame may open none (its CSP).
// A plain script, no build: the Colyseus SDK is loaded from this collector (/colyseus.js) when first needed.
(() => {
  'use strict';
  const RETRY_MS = 4000, RETRY_MAX_MS = 60_000, QUIET_MS = 3000; // a room that can't be had is tried again, ever more rarely; one that says nothing for this long is taken for lost
  let wait = RETRY_MS;
  let sdk = null, client = null, room = null, wanted = null, handlers = null, retry = 0, turn = 0, heardAt = 0, watchdog = 0;
  let own = new Map(); // animal id → the helper's line it says: sent to this computer's own browser only
  let sentShared = new Map(); // what the world itself shares, as last handed on: key → JSON

  function loadSdk() {
    sdk ??= new Promise((resolve, reject) => {
      if (window.Colyseus?.Client) { resolve(window.Colyseus); return; }
      const el = document.createElement('script');
      el.src = '/colyseus.js';
      el.onload = () => (window.Colyseus?.Client ? resolve(window.Colyseus) : reject(new Error('The live library did not start.')));
      el.onerror = () => { el.remove(); reject(new Error('The live library did not load.')); }; // an older collector has none: the world moves itself
      document.head.appendChild(el);
    });
    sdk.catch(() => { sdk = null; }); // tried again with the next join
    return sdk;
  }
  const parse = json => { try { const v = JSON.parse(json); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  let lastFlights = null, flights = []; // the messages on their way, parsed when they change
  let myId = null, watchers = '', lastNames = null, shown = true, saidOn = null; // this browser's number among the watchers; who watches, as last handed on; the stand-ins last handed on; whether the world is in sight
  const named = new Map(); // rid → what to do with the answer to a name given
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* a private window: it lasts this page */ } } };
  const newId = n => { const b = new Uint8Array(n); (window.crypto ?? {}).getRandomValues?.(b); return Array.from(b, v => (v || Math.floor(Math.random() * 256)).toString(16).padStart(2, '0')).join(''); };
  /** This browser's own key among the watchers: made once, kept here, never shown to anyone (the room gives it a number). */
  const viewerKey = () => { let k = store.get('tracker-viewer'); if (!k || !/^[\w-]{8,64}$/.test(k)) { k = newId(16); store.set('tracker-viewer', k); } return k; };
  /** Who watches, when it changed: each as { id, name, host, on, since }, with this browser's own number. */
  function tellWatchers(state) {
    const list = [];
    state.viewers?.forEach((v, id) => list.push({ id, name: String(v.name ?? ''), host: v.host === true, on: v.on !== false, since: v.since }));
    const sig = `${myId}|${list.map(v => `${v.id}:${v.name}:${v.host}:${v.on}`).join('|')}`;
    if (sig === watchers) return;
    watchers = sig;
    handlers?.viewers?.(list, myId);
  }
  /** Says whether this tab looks at the world just now (in sight, and the world's view showing), when that changed. */
  function tellSeen() {
    const on = shown && !document.hidden;
    if (!room || on === saidOn) return;
    saidOn = on;
    send('see', { on });
  }

  /** A state, as the world's frame takes it (sdk/core/wire.js, fromWire; LEGACY: legacy/engine.js, makeMirror): plain lists, positions in the room's measure, of what the world shares only what changed. */
  function hand(state) {
    if (!handlers || !state?.bodies) return;
    tellWatchers(state);
    if (typeof state.names === 'string' && state.names !== lastNames) { lastNames = state.names; const table = parse(state.names); if (Array.isArray(table) && table.length) handlers.names?.(table); }
    if (document.hidden) return; // a tab out of sight draws nothing: it is brought up to date when it shows again
    const b = [], a = [], says = new Map();
    state.bodies.forEach((v, id) => b.push([id, v.x / 8, v.y / 8, v.tx, v.ty, v.bits, v.zone]));
    state.animals.forEach((v, id) => a.push([id, v.x / 8, v.y / 8, v.bits, v.pose, v.lift, v.den]));
    state.says.forEach((text, id) => says.set(id, text));
    for (const [id, text] of own) says.set(id, text);
    let w = null;
    state.shared.forEach((json, k) => { if (sentShared.get(k) !== json) { sentShared.set(k, json); (w ??= {})[k] = json; } });
    let wk = null; // the keys the world shares now, said when one of them is gone (a world of api 2 then forgets it)
    for (const k of [...sentShared.keys()]) if (!state.shared.has(k)) { sentShared.delete(k); wk = [...sentShared.keys()]; }
    const f = state.flights === lastFlights ? flights : (flights = (v => (Array.isArray(v) ? v : []))(parse(lastFlights = state.flights)));
    handlers.state({ t: state.t, wl: state.wall, b, a, says: [...says], taken: state.taken ? state.taken.split(',') : [], o: parse(state.over), sp: state.spare, j: state.jobs, f, ...(w ? { w } : {}), ...(wk ? { wk } : {}) });
  }

  /**
   * Watches a world: `on()` once its room is joined, `state(s)` for each state, `fx(e)` for something to show, `re(r)`
   * for the answer to what was asked, `off()` when the room can't be had (or is lost): the page's world then moves itself,
   * and the room is tried again every few seconds. `token`: the dashboard's (none for a guest).
   */
  function join(world, token, h, again = false) {
    leave();
    if (!again) wait = RETRY_MS;
    const mine = ++turn;
    wanted = { world, token };
    handlers = h;
    const lost = () => {
      if (mine !== turn) return;
      const r = room;
      room = null;
      clearInterval(watchdog);
      try { r?.leave(); } catch { /* gone already */ }
      h.viewers?.([], null);
      h.off?.();
      retry = setTimeout(() => { if (mine === turn) join(world, token, h, true); }, wait);
      wait = Math.min(RETRY_MAX_MS, wait * 2);
    };
    loadSdk().then(async C => {
      if (mine !== turn) return;
      client ??= new C.Client(location.origin);
      const r = await client.joinOrCreate('world', { world, token: token ?? '', viewer: viewerKey(), name: store.get('tracker-viewer-name') ?? '', on: shown && !document.hidden });
      if (mine !== turn) { r.leave(); return; }
      room = r;
      own = new Map();
      sentShared = new Map();
      myId = null; watchers = ''; lastNames = null; saidOn = null;
      if (r.reconnection) r.reconnection.enabled = false; // a dropped connection is a room lost: joined afresh below (the collector keeps no seat)
      heardAt = performance.now();
      wait = RETRY_MS;
      clearInterval(watchdog);
      watchdog = setInterval(() => { if (room === r && !document.hidden && performance.now() - heardAt > QUIET_MS) lost(); }, 1000); // a line gone quiet (the network, a sleeping Mac): the world moves itself meanwhile
      r.onMessage('fx', e => { if (room === r) h.fx?.(e); });
      r.onMessage('re', e => { if (room === r) h.re?.(e); });
      r.onMessage('says', list => { own = new Map(Array.isArray(list) ? list : []); });
      r.onMessage('you', m => { myId = typeof m?.id === 'string' ? m.id : null; if (room === r) tellWatchers(r.state); });
      r.onMessage('named', m => { const done = named.get(m?.rid); if (!done) return; named.delete(m.rid); done(m); });
      r.onLeave(() => { if (room === r) lost(); });
      r.onError(() => {});
      h.on?.();
      tellSeen(); // (the room answers with this browser's number among the watchers)
      r.onStateChange(state => { if (room !== r) return; heardAt = performance.now(); hand(state); });
    }).catch(err => { // no room: tried again later, unless there will never be one for this world (it draws itself, or is not there)
      if (mine === turn && (err?.code === 404 || /draws itself|no such world/.test(String(err?.message)))) { h.viewers?.([], null); h.off?.(); return; }
      lost();
    });
  }
  function leave() {
    turn++;
    clearTimeout(retry);
    clearInterval(watchdog);
    wanted = handlers = null;
    const r = room;
    room = null;
    try { r?.leave(); } catch { /* gone already */ }
  }
  /** The state again, whole (the frame missed some while it was out of sight). */
  function resync() { if (room) { heardAt = performance.now(); sentShared = new Map(); hand(room.state); } }
  document.addEventListener('visibilitychange', () => { tellSeen(); if (!document.hidden) resync(); });
  /**
   * Gives this browser a name among the watchers; resolves with { ok, name } (the name it now has: a number is put after one
   * someone else has) or { ok: false, why }: 'empty', 'slow' (a second between two), 'offline'. Kept here for the next visit.
   */
  function rename(name) {
    return new Promise(resolve => {
      const rid = newId(12), timer = setTimeout(() => { named.delete(rid); resolve({ ok: false, why: 'offline' }); }, 4000);
      named.set(rid, m => { clearTimeout(timer); if (m.ok && typeof m.name === 'string') store.set('tracker-viewer-name', m.name); resolve(m.ok ? { ok: true, name: m.name } : { ok: false, why: String(m.why ?? '') }); });
      if (!send('name', { rid, name: String(name ?? '').slice(0, 100) })) { clearTimeout(timer); named.delete(rid); resolve({ ok: false, why: 'offline' }); }
    });
  }
  const send = (type, m) => { if (!room) return false; try { room.send(type, m); return true; } catch { return false; } };

  window.TrackerLive = {
    join, leave, resync, rename,
    /** The world's view is showing (true), or the page shows something else (the list): a watcher looks only while it shows. */
    see(on) { shown = on !== false; tellSeen(); },
    /** Asks an animal for one of its actions: { rid, animal, act, doer? }. False when there is no room to ask in. */
    act: m => send('act', m),
    touch: animal => send('touch', { animal }),
    watching: () => Boolean(room),
    world: () => wanted?.world ?? null,
  };
})();
