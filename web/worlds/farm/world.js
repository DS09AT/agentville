// The farm: the first world. Every agent is a farmer, every repo a field. It runs in a sandboxed frame
// (web/worlds/sdk/frame.html) and reaches the page only through the bridge (web/worlds/sdk/bridge.js).
// Classic script, no dependencies. The canvas code reads only the scene farmScene() builds from the
// page's scene; text (names, signs, counts) is HTML laid over the canvas so it stays crisp.
(() => {
  'use strict';

  /* ---------- the scene: what the farm draws, from the snapshot (pure, tested) ---------- */

  const SHIRT = ['#d9673a', '#4a7bd0', '#2fa57a', '#8a6fd8', '#d55181', '#c99a16', '#e05555', '#3c9c3c'];
  const hashOf = id => {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return h;
  };
  // A farmer's shirt is its agent's colour: the scene's colorIndex (web/scene.js keeps the same list).
  /** One of n choices for an id; each salt mixes the hash differently, so the choices don't move together. */
  const pick = (id, salt, n) => {
    let h = hashOf(id) ^ Math.imul(salt, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) % n;
  };

  // What makes each farmer look like itself, besides its shirt: hat, hair, skin, overalls, an extra.
  const HATS = ['straw', 'cap', 'beanie', 'bandana', 'none'];
  const STRAW = [['#e9c46a', '#b5562f'], ['#e2c27a', '#3c5a99'], ['#f0d58c', '#2f6b2f'], ['#d4ad55', '#8e2b2b']]; // [hat, band]
  const DYED = [['#d64545', '#8e2b2b'], ['#4f9d4a', '#2f6b2f'], ['#4a74c9', '#2c4a85'], ['#8a5fc0', '#5a3b85'], ['#ece6d6', '#9a9488'], ['#3a3a40', '#c9a24a'], ['#e58a2e', '#9a5212']];
  const CODEX_CAPS = [['#5d7184', '#2a3644'], ['#4a7a8c', '#22404a'], ['#7a8a9c', '#3a4452'], ['#3f4f66', '#cfd8e3']]; // slate caps
  const HAIR = ['#2b1d14', '#5a3a22', '#a0522d', '#d9b26a', '#9a9a9a'];
  const SKIN = ['#f1c7a1', '#e0a878', '#c68a5a', '#9c6644', '#7d5236'];
  const OVERALLS = ['#3c5a99', '#6b4f2a', '#4a4a52', '#2f6b4f', '#7a3b5a'];
  const EXTRAS = ['none', 'beard', 'glasses', 'cheeks'];
  function lookOf(a) {
    const hat = a.kind === 'codex' ? 'cap' : HATS[pick(a.id, 1, HATS.length)];
    const colors = a.kind === 'codex' ? CODEX_CAPS[pick(a.id, 2, CODEX_CAPS.length)] : hat === 'straw' ? STRAW[pick(a.id, 2, STRAW.length)] : DYED[pick(a.id, 2, DYED.length)];
    return {
      hat, hatColor: colors[0], band: colors[1], hair: HAIR[pick(a.id, 3, HAIR.length)], skin: SKIN[pick(a.id, 4, SKIN.length)],
      overalls: OVERALLS[pick(a.id, 5, OVERALLS.length)], extra: EXTRAS[pick(a.id, 6, EXTRAS.length)],
    };
  }
  // And each field, by its repo: what grows there and the colour of its fence. The branch is a pennant.
  const CROPS = ['wheat', 'corn', 'carrot', 'cabbage', 'sunflower', 'tomato', 'pumpkin'];
  const FENCES = ['#c98d4f', '#8a8f96', '#9c3b30', '#5f7f9a', '#6b8f4a', '#4e3626'];
  const SOILS = ['#7a5230', '#6b4a35', '#86603a', '#7a4632', '#705a3a'];
  const isMain = b => /^(main|master)$/.test(b ?? '');

  /** The season by the plan's 5-hour limit: spring while it is fresh, then summer, autumn, and winter when it is nearly used up. No reading: summer. */
  function seasonOf(plan) {
    const w = plan?.windows?.find(x => x.kind === 'five_hour');
    if (!w) return 'summer';
    const p = w.reset ? 0 : w.percentUsed;
    return p < 25 ? 'spring' : p < 60 ? 'summer' : p < 85 ? 'autumn' : 'winter';
  }
  /** The silo: the plan's weekly usage as grain, and a lamp near the limit (amber from 70%, red from 90%). */
  function siloOf(plan) {
    const w = plan?.windows?.find(x => x.kind === 'seven_day');
    if (!w) return null;
    const p = w.reset ? 0 : w.percentUsed;
    return { fill: Math.max(0, Math.min(1, p / 100)), lamp: p >= 90 ? 'red' : p >= 70 ? 'amber' : null, label: `${Math.round(p)}%`, resetsAt: w.resetsAt ?? null };
  }

  /**
   * Weather over a field, from its last deploy (same rules as the list view's deploy chip): the
   * collector's lastDeploy (the newer of the Actions run and a direct deploy), or a bare Actions run.
   * A run GitHub never started (billing) brings no weather.
   */
  function weatherOf(deploy) {
    if (!deploy) return null;
    if (deploy.state) return { running: 'windmill', ok: 'rainbow', failed: 'rain' }[deploy.state] ?? null;
    if (deploy.status !== 'completed') return 'windmill';
    return deploy.conclusion === 'success' ? 'rainbow' : deploy.conclusion === 'failure' ? 'rain' : null;
  }

  /** The farm's scene: the engine's, with each farmer's look, and each field's crop, fence, soil, pennant and weather. */
  function farmScene(s) {
    const e = engineScene(s);
    e.fields = e.fields.map(f => ({
      ...f, weather: weatherOf(f.deploy),
      crop: CROPS[pick(f.key, 7, CROPS.length)], fence: FENCES[pick(f.key, 8, FENCES.length)], soil: SOILS[pick(f.key, 9, SOILS.length)],
      pennant: Boolean(f.branch) && f.branch !== '(detached)' && !f.onMain,
    }));
    e.farmers = e.farmers.map(f => ({ ...f, look: lookOf(f) }));
    return e;
  }
  // Seasons: the grass, the trees and the flowers (spring blossom, autumn leaves, winter snow).
  // grass: [dark, base, light]; canopy: [outline, shade, leaves, lit leaves].
  const SEASONS = {
    spring: { grass: ['#4f8f3a', '#5d9b46', '#6aa84f'], tuft: '#3f7d3a', blade: '#7fbf5a', shadow: '#3f7d3a', canopy: ['#1c3320', '#2f6b2f', '#3f9b3a', '#6cc04a'], bloom: '#f4b6c2', flowers: ['#ffffff', '#f4b6c2', '#ffd43b', '#e58a8a'] },
    summer: { grass: ['#4f8f3a', '#5d9b46', '#6aa84f'], tuft: '#3f7d3a', blade: '#7fbf5a', shadow: '#3f7d3a', canopy: ['#1c3320', '#264a2a', '#2f6b2f', '#3f9b3a'], flowers: ['#ffffff', '#ffd43b'] },
    autumn: { grass: ['#6b7a35', '#8a8f3a', '#a8a350'], tuft: '#6b7a35', blade: '#c9c45a', shadow: '#6b7a35', canopy: ['#5a1f19', '#9c3b30', '#c8681a', '#e9a23b'], flowers: ['#c8681a'] },
    winter: { grass: ['#c3cbd2', '#dfe9f2', '#f4f8fb'], tuft: '#9aa4ad', blade: '#ffffff', shadow: '#9aa4ad', canopy: ['#1c3320', '#264a2a', '#2f6b2f', '#ffffff'], flowers: [], snow: true },
  };
  /** 0–1023 for a spot, well mixed, the same every build (texture without stripes). */
  const noise = (x, y) => {
    let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul((y | 0) + 0x9e37, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) & 1023;
  };
  /** Smooth noise, 0–1, that changes over about s pixels: patches of lighter and darker grass. */
  function vnoise(x, y, s) {
    const gx = Math.floor(x / s), gy = Math.floor(y / s), tx = x / s - gx, ty = y / s - gy;
    const n = (i, j) => noise(gx + i, gy + j + 7919) / 1023, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    return (n(0, 0) * (1 - sx) + n(1, 0) * sx) * (1 - sy) + (n(0, 1) * (1 - sx) + n(1, 1) * sx) * sy;
  }

  // Shapes for the land. f paints a rectangle; everything is lit from the top left, so shadows fall
  // to the bottom right.
  /** A filled pixel ellipse. */
  function oval(f, cx, cy, rx, ry, c) {
    for (let dy = -ry; dy <= ry; dy++) {
      const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2)));
      if (half > 0) f(cx - half, cy + dy, half * 2, 1, c);
    }
  }
  /** A round tree seen from above, standing at (x, y): its shadow, a stub of trunk, a leafy crown. */
  function tree(f, x, y, r, S, seed = 0) {
    const [line, dark, mid, lit] = S.canopy, cy = y - 3 - r;
    oval(f, x + Math.round(r * 0.35), y, r, Math.max(2, Math.round(r * 0.4)), S.shadow);
    f(x - 2, y - 5, 4, 5, '#4e3626'); f(x - 2, y - 5, 1, 5, '#6b4320');
    oval(f, x, cy, r + 1, r + 1, line);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + seed; oval(f, Math.round(x + Math.cos(a) * r * 0.7), Math.round(cy + Math.sin(a) * r * 0.7), Math.ceil(r * 0.45) + 1, Math.ceil(r * 0.45) + 1, line); } // a bumpy edge
    oval(f, x, cy, r, r, dark);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + seed; oval(f, Math.round(x + Math.cos(a) * r * 0.7), Math.round(cy + Math.sin(a) * r * 0.7), Math.ceil(r * 0.45), Math.ceil(r * 0.45), dark); }
    oval(f, x - 1, cy - 1, Math.round(r * 0.8), Math.round(r * 0.8), mid);
    oval(f, x - Math.round(r * 0.3), cy - Math.round(r * 0.35), Math.round(r * 0.45), Math.round(r * 0.4), lit);
    for (let i = 0; i < r; i++) { const n = noise(x * 7 + i, y + seed * 99); f(x - r + (n % (2 * r)), cy - r + ((n >> 4) % (2 * r)), 1, 1, n & 1 ? dark : lit); } // leaves
    if (S.snow) { oval(f, x - 1, cy - Math.round(r * 0.45), Math.round(r * 0.7), Math.max(1, Math.round(r * 0.3)), '#ffffff'); }
  }
  /** A bush: a small crown without a trunk; now and then with berries or flowers. */
  function bush(f, x, y, r, S, berry) {
    const [line, dark, mid, lit] = S.canopy;
    oval(f, x + 2, y + 1, r + 1, Math.max(1, r >> 1), S.shadow);
    oval(f, x, y - r, r + 1, r + 1, line); oval(f, x, y - r, r, r, dark); oval(f, x - 1, y - r - 1, Math.max(1, r - 2), Math.max(1, r - 2), mid);
    f(x - Math.round(r / 2), y - r - Math.round(r / 2), 2, 1, lit);
    if (S.snow) f(x - r + 1, y - 2 * r, 2 * r - 2, 2, '#ffffff');
    else if (berry) for (const [dx, dy] of [[-2, -1], [2, 0], [0, 2]]) f(x + dx, y - r + dy, 1, 1, berry);
  }
  /** A stone: grey, lit on top, its shadow under it. */
  function stone(f, x, y, s) {
    oval(f, x + 1, y + 1, s + 1, Math.max(1, s >> 1), '#3f7d3a');
    oval(f, x, y - (s >> 1), s, Math.max(1, Math.round(s * 0.7)), '#5f6b7a');
    oval(f, x - 1, y - (s >> 1) - 1, Math.max(1, s - 1), Math.max(1, Math.round(s * 0.45)), '#8a8f96');
    f(x - Math.round(s / 2), y - s, 1, 1, '#c3cbd2');
  }
  /** A dirt path: packed earth with ragged edges, pebbles and wheel marks. */
  function dirt(f, x, y, w, h, vertical = false) {
    f(x, y, w, h, '#b08850');
    for (let i = 0; i < (vertical ? h : w); i++) { // ragged edges: grass bites into the path here and there
      const n = noise(x + i * 3, y + i * 5);
      if (vertical) { if (n < 300) f(x, y + i, 1, 1, '#9a7442'); if (n > 760) f(x + w - 1, y + i, 1, 1, '#9a7442'); if (n % 7 === 0) f(x - 1, y + i, 1, 1, '#b08850'); }
      else { if (n < 300) f(x + i, y, 1, 1, '#9a7442'); if (n > 760) f(x + i, y + h - 1, 1, 1, '#8a7140'); if (n % 7 === 0) f(x + i, y - 1, 1, 1, '#b08850'); }
    }
    for (let yy = y + 1; yy < y + h - 1; yy += 2) for (let xx = x + 1; xx < x + w - 1; xx += 2) {
      const n = noise(xx * 3, yy * 7);
      if (n < 70) f(xx, yy, 1, 1, '#c9a46a'); else if (n < 100) f(xx, yy, 1, 1, '#9a7442'); else if (n < 108) f(xx, yy, 2, 1, '#8a8f96');
    }
  }
  /** A wooden fence running across at y (its feet), from x0 to x1: posts and two rails. */
  function fenceAcross(f, x0, x1, y, gaps = []) {
    const open = x => gaps.some(([a, b]) => x >= a && x < b);
    for (let x = x0; x < x1; x++) if (!open(x)) { f(x, y - 6, 1, 1, '#c98d4f'); f(x, y - 5, 1, 1, '#6b4320'); f(x, y - 3, 1, 1, '#a8703c'); f(x, y - 2, 1, 1, '#6b4320'); f(x, y, 1, 1, '#3f7d3a'); }
    for (let x = x0; x <= x1 - 2; x += 8) if (!open(x) && !open(x + 1)) { f(x, y - 8, 2, 8, '#8b5a2b'); f(x, y - 8, 2, 1, '#e2b07a'); f(x + 1, y - 7, 1, 7, '#6b4320'); }
  }
  /** A wooden fence running down at x, from y0 to y1 (seen from above: a rail on a row of posts). */
  function fenceDown(f, x, y0, y1, gaps = []) {
    const open = y => gaps.some(([a, b]) => y >= a && y < b);
    for (let y = y0; y < y1; y++) if (!open(y)) { f(x, y - 6, 2, 1, '#a8703c'); f(x + 2, y - 5, 1, 1, '#3f7d3a'); }
    for (let y = y0; y <= y1; y += 8) if (!open(y)) { f(x, y - 8, 2, 8, '#8b5a2b'); f(x, y - 8, 2, 1, '#e2b07a'); f(x + 1, y - 7, 1, 7, '#6b4320'); f(x + 2, y - 2, 1, 2, '#3f7d3a'); }
  }
  /** A pitched roof seen from the front and above: shingle rows, lit near the ridge, dark at the eaves. */
  function shingles(f, x, y, w, h, inset, [line, dark, base, lit]) {
    for (let j = 0; j < h; j++) {
      const d = Math.round(((h - 1 - j) * inset) / Math.max(1, h - 1)), xx = x + d, ww = w - 2 * d;
      f(xx, y + j, ww, 1, j === 0 ? line : j < 3 ? lit : j % 4 === 3 ? dark : base);
      if (j % 4 === 1 && j > 2) for (let k = xx + ((j >> 2) % 2) * 3 + 2; k < xx + ww - 1; k += 6) f(k, y + j, 1, 2, dark); // shingle joints, staggered
    }
    f(x, y + h, w, 1, line); f(x + 1, y + h + 1, w - 2, 1, dark); // the eave and its shadow
  }

  /**
   * The land: everything that does not move, drawn once (and again when the season turns or the
   * frame grows): grass, the forest round the farm, paths, fences, buildings, the pond.
   */
  function drawLand(f, L, season = 'summer', ext = { x0: 0, x1: W, y0: 0, y1: L.H }) {
    const { H, ST, PORCH_Y, LANE, GRID } = L, S = SEASONS[season] ?? SEASONS.summer, { x0, x1, y0, y1 } = ext;
    // grass: soft patches of three greens, tufts, a few flowers, stones and mushrooms
    for (let y = y0 - (y0 & 1); y < y1; y += 2) for (let x = x0 - (x0 & 1); x < x1; x += 2) {
      const v = vnoise(x, y, 22) + (noise(x, y) / 1023 - 0.5) * 0.2;
      f(x, y, 2, 2, v < 0.36 ? S.grass[0] : v < 0.68 ? S.grass[1] : S.grass[2]);
    }
    for (let y = y0 + 2; y < y1 - 2; y += 5) for (let x = x0 + 2; x < x1 - 2; x += 6) {
      const n = noise(x + 7, y + 3), jx = x + (n % 4), jy = y + ((n >> 2) % 3);
      if (n < 150) { f(jx, jy, 1, 2, S.tuft); f(jx + 2, jy, 1, 2, S.tuft); f(jx + 1, jy + 1, 1, 2, S.tuft); }
      else if (n < 200) f(jx, jy, 1, 1, S.blade);
      else if (n < 212 && S.flowers.length) { f(jx, jy + 1, 1, 1, S.tuft); f(jx, jy, 1, 1, S.flowers[n % S.flowers.length]); }
      else if (n < 215 && !S.snow) { f(jx, jy, 3, 1, '#e04a3a'); f(jx + 1, jy, 1, 1, '#ffffff'); f(jx + 1, jy + 1, 1, 1, '#f4ecd8'); } // a mushroom
    }
    // the forest all round: big round trees just past the farm's edges, thicker further out
    const trees = [];
    for (let gy = Math.floor((y0 - 20) / 18); gy * 18 < y1 + 24; gy++) for (let gx = Math.floor((x0 - 24) / 20); gx * 20 < x1 + 24; gx++) {
      const n = noise(gx * 31, gy * 17), x = gx * 20 + (n % 13) - 6 + (gy % 2) * 10, y = gy * 18 + ((n >> 4) % 9);
      if (!(x < -4 || x > W + 4 || y <= 12 || y >= H + 22 || (x < 22 && y < 84))) continue; // never on the farm itself (but in its top left corner)
      if (x < x0 - 30 || x > x1 + 30 || y < y0 - 10 || y > y1 + 34) continue;
      trees.push([x, y, 9 + ((n >> 6) % 5), n]);
    }
    trees.sort((a, b) => a[1] - b[1]).forEach(([x, y, r, n]) => (n % 5 === 0 ? bush(f, x, y, 5, S, null) : tree(f, x, y, r, S, n % 7)));
    // the main lane in front of the buildings, the path down the yard, and the walkways between the fields
    dirt(f, x0, LANE - 5, x1 - x0, 10);
    dirt(f, 111, LANE, 10, GRID.y1 - LANE, true);
    for (const c of CORR.slice(1)) dirt(f, c - 6, GRID.y0 - 2, 12, GRID.y1 - GRID.y0 - 2, true);
    // the fields' fence, with gates onto the lane and the yard
    const lanes = [...new Set(L.slots.map(s => s.lane))];
    fenceAcross(f, GRID.x0, GRID.x1 + 2, GRID.y0, CORR.slice(1).map(c => [c - 7, c + 7]));
    fenceAcross(f, GRID.x0, GRID.x1 + 2, GRID.y1);
    fenceDown(f, GRID.x0, GRID.y0, GRID.y1, lanes.map(y => [y - 4, y + 5]));
    fenceDown(f, GRID.x1, GRID.y0, GRID.y1);
    // empty beds waiting for a repo; each project's beds edged with stones, under its sign
    for (const s of L.empty) fallow(f, s, S); // a bed no repo uses: fallow ground, so the fields in use stand out
    for (const g of L.groups) for (const [r, cols] of rowsOfGroup(g)) {
      const top = 100 + r * ROWH, gx0 = 174 + Math.min(...cols) * COLW - 43, gx1 = 174 + Math.max(...cols) * COLW + 43;
      for (let x = gx0; x <= gx1; x += 3) { f(x, top + 1, 2, 1, '#c3cbd2'); f(x, top + 59, 2, 1, '#c3cbd2'); f(x, top + 2, 2, 1, '#8a8f96'); f(x, top + 60, 2, 1, '#8a8f96'); }
      for (let y = top + 1; y <= top + 60; y += 3) { f(gx0, y, 1, 2, '#c3cbd2'); f(gx1, y, 1, 2, '#c3cbd2'); }
    }
    // the barn, top left: new farmers walk out of its big door; a lamp over the door glows at night
    barn(f, 36, 14, S);
    silo(f, 92, 6, S);
    house(f, 132, 10, S, PORCH_Y);
    // the scarecrow patch, top right: dry stubble behind a low fence; the market stall beside it, the notice board by the porch
    f(316, 30, 80, PORCH_Y - 26, '#8a7140'); f(316, 30, 80, 1, '#6d5830');
    for (let y = 33; y < PORCH_Y + 2; y += 4) for (let x = 319 + (y % 8 ? 2 : 0); x < 394; x += 5) { f(x, y, 1, 2, S.snow ? '#dfe9f2' : '#6d5830'); f(x + 1, y + 1, 1, 1, S.snow ? '#ffffff' : '#c9a46a'); }
    fenceAcross(f, 314, 398, 30);
    hay(f, 386, 44);
    stall(f, STALL.x, STALL.y, S);
    noticeBoard(f, BOARD.x, BOARD.y, S);
    // the yard: the henhouse and its run, the meadow, the pond, bushes and stones
    henhouse(f, 8, 98, S);
    for (let y = 140; y < 190; y += 3) for (let x = 8 + (y % 6); x < 104; x += 5) { const n = noise(x, y); if (n < 260) { f(x, y, 1, 2, S.tuft); if (S.flowers.length && n < 90) f(x, y - 1, 1, 1, S.flowers[n % S.flowers.length]); } } // the meadow's long grass and flowers
    pond(f, 42, 210, S);
    for (const [x, y] of NAPS) hammock(f, x, y, S);
    for (let r = 3; r < L.rows; r++) for (const [x, dy] of [[30, 20], [88, 34]]) tree(f, x, 100 + r * ROWH + dy - 62, 10, S, r + x); // more rows: an orchard in the yard
    shadeTree(f, 66, GRID.y1 - 18, S, season);
    for (const [x, y, r] of [[100, 136, 4], [92, 188, 3]]) bush(f, x, y, r, S, season === 'summer' ? '#e04a3a' : null);
    for (const [x, y, s] of [[96, GRID.y1 - 22, 2], [6, GRID.y1 - 16, 3]]) stone(f, x, y, s);
    // the wood reaches into the yard at its left edge, above the shade tree's row: two trees and a bed of moss and leaves at their feet, where a cat sleeps
    tree(f, 3, GRID.y1 - 32, 9, S, 3); tree(f, 30, GRID.y1 - 28, 7, S, 5);
    oval(f, 16, GRID.y1 - 24, 9, 3, S.shadow); oval(f, 16, GRID.y1 - 25, 8, 2, S.snow ? '#dfe9f2' : '#a8a350'); // pale, so a black cat shows on it
    for (const [dx, dy, c] of [[-6, -1, '#c8681a'], [5, 0, '#e9a23b'], [-1, 1, '#8a5a2b'], [7, -1, '#6cc04a']]) f(16 + dx, GRID.y1 - 25 + dy, 1, 1, S.snow ? '#ffffff' : c);
    // the bottom edge: a strip of meadow, then the forest
    for (let x = 4; x < W - 4; x += 9) { const n = noise(x, 999); if (n < 300) f(x, H - 6 + (n % 3), 1, 2, S.tuft); }
  }
  /** A project's beds in runs side by side, row by row: [[row, [columns]]]. Another repo's bed between them splits a run. */
  function rowsOfGroup(g) {
    const runs = [];
    for (const i of [...g.slots].sort((a, b) => a - b)) {
      const last = runs.at(-1), r = Math.floor(i / 3), c = i % 3;
      if (last && last[0] === r && last[1].at(-1) === c - 1) last[1].push(c); else runs.push([r, [c]]);
    }
    return runs;
  }
  /** The market stall by the lane: a striped awning over a counter; crates for open pull requests go on it each frame. */
  function stall(f, X, Y, S) {
    f(X + 28, Y + 8, 3, 28, S.shadow);
    f(X + 1, Y + 6, 2, 28, '#6b4320'); f(X + 25, Y + 6, 2, 28, '#6b4320');
    for (let i = 0; i < 7; i++) { f(X - 1 + i * 4, Y, 4, 6, i % 2 ? '#f4ecd8' : '#e04a3a'); f(X + i * 4, Y + 6, 2, 1, i % 2 ? '#f4ecd8' : '#b23a2e'); }
    f(X - 1, Y - 1, 29, 1, '#9c3b30');
    f(X - 1, Y + 22, 30, 3, '#a8703c'); f(X - 1, Y + 22, 30, 1, '#c98d4f');
    f(X, Y + 25, 28, 9, '#8b5a2b'); for (let x = X + 3; x < X + 28; x += 5) f(x, Y + 25, 1, 9, '#6b4320'); f(X, Y + 33, 28, 1, '#4e3626');
    if (S.snow) f(X - 1, Y - 1, 29, 2, '#ffffff');
  }
  /** The notice board by the porch: pinned notes (what the farm remembers). */
  function noticeBoard(f, X, Y, S) {
    f(X + 14, Y + 4, 2, 18, S.shadow);
    f(X + 1, Y + 9, 2, 13, '#6b4320'); f(X + 10, Y + 9, 2, 13, '#6b4320');
    f(X - 2, Y - 3, 17, 2, '#6b2a22'); f(X - 1, Y - 1, 15, 11, '#4e3626'); f(X, Y, 13, 9, '#a8703c');
    f(X + 1, Y + 1, 5, 4, '#f4ecd8'); f(X + 7, Y + 1, 5, 5, '#fff4d6'); f(X + 2, Y + 5, 4, 3, '#e8d8b0');
    f(X + 2, Y + 3, 3, 1, '#c9b48a'); f(X + 8, Y + 3, 3, 1, '#c9b48a'); f(X + 8, Y + 5, 2, 1, '#c9b48a');
    f(X + 3, Y + 1, 1, 1, '#e04a3a'); f(X + 9, Y + 1, 1, 1, '#3d7be0');
    if (S.snow) f(X - 2, Y - 4, 17, 1, '#ffffff');
  }
  /** A hammock between two posts, for a session napping until its wake-up. */
  function hammock(f, cx, y, S) {
    oval(f, cx, y + 1, 10, 1, S.shadow);
    for (const x of [cx - 13, cx + 12]) { f(x, y - 11, 2, 12, '#6b4320'); f(x, y - 11, 2, 1, '#a8703c'); }
    for (let i = 0; i < 25; i++) {
      const x = cx - 12 + i, sag = Math.round(Math.sin((i / 24) * Math.PI) * 4);
      if (i < 3 || i > 21) f(x, y - 9 + sag, 1, 1, '#c9b48a');
      else { f(x, y - 9 + sag, 1, 1, '#d55181'); f(x, y - 8 + sag, 1, 1, '#8a5fc0'); }
    }
  }
  /** The shade tree, bottom left, where idle farmers nap: blossom in spring, apples in summer, orange in autumn, bare and snowy in winter. */
  function shadeTree(f, x, y, S, season) {
    if (S.snow) {
      oval(f, x + 6, y + 1, 18, 4, S.shadow);
      f(x - 3, y - 28, 6, 28, '#4e3626'); f(x - 3, y - 28, 2, 28, '#6b4320');
      for (const [bx, by, w] of [[-22, -30, 20], [3, -34, 22], [-14, -42, 12], [4, -22, 16]]) { f(x + bx, y + by, w, 2, '#4e3626'); f(x + bx + 1, y + by - 1, w - 2, 1, '#ffffff'); }
      return;
    }
    f(x - 3, y - 8, 6, 8, '#4e3626'); f(x - 3, y - 8, 2, 8, '#6b4320');
    tree(f, x, y, 21, S, 3);
    const fruit = season === 'spring' ? S.bloom : season === 'autumn' ? '#e9a23b' : '#e04a3a';
    for (const [dx, dy] of [[-10, -30], [8, -38], [-4, -16], [12, -24], [-14, -40], [2, -28]]) { f(x + dx, y + dy, 2, 2, fruit); f(x + dx, y + dy, 1, 1, '#fff4d6'); }
  }
  /** A raised bed for a field, at its slot: a wooden frame round the soil, its front face in shade. */
  /** An empty bed: a patch of darker grass with a thin outline and a few tufts. */
  function fallow(f, s, S) {
    const { x0, y0 } = s;
    f(x0 - 2, y0 - 2, 76, 38, S.tuft);
    f(x0 - 1, y0 - 1, 74, 36, S.grass[0]);
    for (let n = 0; n < 14; n++) f(x0 + 3 + noise(n, s.cx) % 66, y0 + 3 + noise(s.cx, n) % 28, 1, 2, n % 3 ? S.tuft : S.blade);
  }
  function bed(f, s, frame, soil, frost) {
    const { x0, y0 } = s, furrow = shade(soil, 0.77), ridge = shade(soil, 1.15);
    f(x0 - 3, y0 - 3, 78, 41, '#2a1d14'); // outline
    f(x0 - 2, y0 - 2, 76, 38, frame); f(x0 - 2, y0 - 2, 76, 1, shade(frame, 1.25)); f(x0 - 2, y0 + 34, 76, 3, shade(frame, 0.72)); f(x0 - 2, y0 + 36, 76, 1, '#2a1d14');
    f(x0 + 74, y0, 2, 37, '#3f7d3a'); f(x0, y0 + 38, 74, 2, '#3f7d3a'); // its shadow
    f(x0, y0, 72, 34, soil); f(x0, y0, 72, 1, furrow);
    for (let k = 0; k < 4; k++) { const fy = y0 + 4 + k * 8; f(x0 + 2, fy - 1, 68, 1, ridge); f(x0 + 2, fy, 68, 2, furrow); f(x0 + 2, fy + 2, 68, 1, shade(soil, 0.9)); } // lit ridge, dark furrow
    for (let n = 0; n < 20; n++) { const sx = x0 + 2 + noise(n, s.cx) % 68, sy = y0 + 2 + noise(s.cx, n) % 30; f(sx, sy, 1, 1, n % 2 ? ridge : furrow); } // clods
    if (frost) for (let k = 0; k < 4; k++) f(x0 + 2, y0 + 3 + k * 8, 68, 1, '#f4f8fb'); // frost on bare soil
  }
  function hay(f, x, y) { f(x - 5, y - 4, 10, 6, '#c9a24a'); f(x - 5, y - 4, 10, 1, '#f4d58d'); f(x - 2, y - 4, 1, 6, '#a8703c'); f(x + 2, y - 4, 1, 6, '#a8703c'); f(x - 4, y + 2, 10, 1, '#3f7d3a'); }
  /** The barn: a red front gable with white trim, its roof behind, a big door with a white X. */
  function barn(f, X, Y, S) {
    const W2 = 52, red = '#b23a2e', plank = '#9c3b30', trim = '#f4ecd8';
    f(X + W2, Y + 18, 4, 50, S.shadow); f(X + 3, Y + 66, W2, 3, S.shadow); // shadow
    shingles(f, X - 1, Y, W2 + 2, 22, 0, ['#2a1d14', '#5a1f19', '#6b2a22', '#9c3b30']); // the roof going back
    f(X + 25, Y, 2, 22, '#5a1f19');
    for (let j = 0; j <= 14; j++) { const half = Math.round((j * 25) / 14), y = Y + 10 + j; f(X + 26 - half, y, half * 2, 1, red); f(X + 25 - half, y, 2, 1, trim); f(X + 25 + half, y, 2, 1, trim); } // the gable
    f(X + 1, Y + 24, W2 - 2, 42, red);
    for (let x = X + 4; x < X + W2 - 2; x += 4) f(x, Y + 26, 1, 40, plank);
    f(X + 1, Y + 24, W2 - 2, 2, trim); f(X + 1, Y + 24, 2, 42, trim); f(X + W2 - 3, Y + 24, 2, 42, trim); f(X + W2 - 1, Y + 24, 1, 42, '#5a1f19');
    f(X + 21, Y + 13, 10, 8, trim); f(X + 22, Y + 14, 8, 6, '#5a1f19'); f(X + 23, Y + 18, 6, 2, '#e9c46a'); // the hay loft
    const dx = X + 14, dy = Y + 38;
    f(dx - 2, dy - 2, 28, 30, trim); f(dx, dy, 24, 28, '#6b2a22');
    for (const lx of [dx, dx + 12]) for (let t = 0; t < 28; t++) { const k = Math.round((t * 11) / 27); f(lx + k, dy + t, 1, 1, trim); f(lx + 11 - k, dy + t, 1, 1, trim); } // the X braces
    f(dx + 11, dy, 2, 28, trim); f(dx, dy, 24, 1, '#5a1f19');
    f(X + 24, Y + 31, 4, 3, '#3a3a40'); f(X + 25, Y + 33, 2, 1, '#ffd43b'); // the lamp
    if (S.snow) { f(X - 1, Y, W2 + 2, 3, '#ffffff'); for (let j = 0; j <= 14; j += 2) f(X + 24 - Math.round((j * 25) / 14), Y + 9 + j, 3, 1, '#ffffff'); }
  }
  /** A silo: a metal cylinder with a dome (red: Claude's plan; slate: Codex's); the grain gauge in its front is drawn every frame. */
  const DOMES = { claude: ['#5a1f19', '#e04a3a', '#b23a2e', '#9c3b30'], codex: ['#22303c', '#7a8a9c', '#5d7184', '#3f4f66'] }; // edge, lit, dome, shade
  function silo(f, X, Y, S, [edge, lit, dome, shadeC] = DOMES.claude) {
    f(X + 20, Y + 16, 4, 58, S.shadow); f(X + 2, Y + 74, 20, 2, S.shadow);
    f(X - 1, Y + 10, 22, 64, '#3a3a40'); f(X, Y + 10, 20, 64, '#9aa4ad'); f(X, Y + 10, 4, 64, '#c3cbd2'); f(X + 1, Y + 10, 1, 64, '#e6eef5'); f(X + 15, Y + 10, 5, 64, '#8a8f96'); f(X + 18, Y + 10, 2, 64, '#5f6b7a');
    for (let y = Y + 16; y < Y + 72; y += 9) f(X, y, 20, 1, '#5f6b7a');
    for (let j = 0; j < 11; j++) { const half = Math.round(10 * Math.sqrt(1 - ((10 - j) / 10.5) ** 2)); f(X + 10 - half - 1, Y + j, half * 2 + 2, 1, edge); f(X + 10 - half, Y + j, half * 2, 1, j < 3 ? lit : dome); f(X + 10 + half - 4, Y + j, Math.min(4, half), 1, shadeC); }
    if (S.snow) f(X + 3, Y, 14, 3, '#ffffff');
    f(X + 6, Y + 20, 8, 48, '#3a3a40'); f(X + 5, Y + 19, 10, 1, '#5f6b7a'); // the gauge's window
    f(X + 2, Y + 70, 16, 4, '#5f6b7a');
  }
  /** The farmhouse, top middle: a shingled roof, cream walls, lit windows, the porch in front. */
  function house(f, X, Y, S, PORCH_Y) {
    const W2 = 136, wallY = Y + 32;
    f(X + W2, Y + 10, 4, PORCH_Y - Y - 2, S.shadow); f(X + 2, PORCH_Y + 4, W2, 2, S.shadow); // shadow
    shingles(f, X, Y, W2, 30, 9, ['#2a1d14', '#5a1f19', '#9c3b30', '#b23a2e']);
    f(X + 104, Y + 4, 10, 16, '#5a1f19'); f(X + 105, Y + 4, 8, 15, '#9c3b30'); f(X + 105, Y + 4, 2, 15, '#b23a2e'); for (let y = Y + 7; y < Y + 18; y += 3) f(X + 105, y, 8, 1, '#6b2a22'); f(X + 103, Y + 2, 12, 3, '#3a3a40'); f(X + 114, Y + 8, 2, 12, '#6b2a22'); // the chimney
    if (S.snow) for (let j = 0; j < 8; j++) { const d = Math.round(((29 - j) * 9) / 29); f(X + d, Y + j, W2 - 2 * d, 1, j < 6 ? '#ffffff' : '#e6eef5'); }
    f(X + 4, wallY, W2 - 8, PORCH_Y - wallY - 10, '#e8d8b0');
    for (let y = wallY + 3; y < PORCH_Y - 10; y += 3) f(X + 4, y, W2 - 8, 1, '#d4c294');
    f(X + 4, wallY, W2 - 8, 2, '#c9b48a'); f(X + 4, wallY, 2, PORCH_Y - wallY - 10, '#f4ecd8'); f(X + W2 - 6, wallY, 2, PORCH_Y - wallY - 10, '#c9b48a');
    for (const wx of [X + 16, X + 100]) { // windows, shutters, a flower box
      f(wx - 4, wallY + 4, 3, 14, '#2f6b2f'); f(wx + 21, wallY + 4, 3, 14, '#2f6b2f');
      f(wx - 1, wallY + 3, 22, 16, '#6b4320'); f(wx, wallY + 4, 20, 14, '#5ab4ff'); f(wx + 1, wallY + 5, 7, 2, '#a9dcf7'); f(wx + 10, wallY + 4, 1, 14, '#6b4320'); f(wx, wallY + 10, 20, 1, '#6b4320');
      f(wx - 1, wallY + 19, 22, 3, '#8b5a2b'); for (let i = 0; i < 5; i++) f(wx + 1 + i * 4, wallY + 18, 2, 1, S.flowers[i % Math.max(1, S.flowers.length)] ?? '#6b8f4a');
    }
    f(X + 59, wallY + 3, 18, PORCH_Y - wallY - 13, '#6b4320'); f(X + 61, wallY + 5, 14, PORCH_Y - wallY - 15, '#8b5a2b'); f(X + 63, wallY + 7, 4, 6, '#7a5230'); f(X + 69, wallY + 7, 4, 6, '#7a5230'); f(X + 72, wallY + 14, 2, 2, '#f0b429'); // the door
    f(X + 80, wallY + 6, 4, 4, '#3a3a40'); f(X + 81, wallY + 7, 2, 2, '#ffd43b'); // the porch lamp
    // the porch: planks seen from above, its front edge, the steps down to the lane
    f(X - 4, PORCH_Y - 10, W2 + 8, 12, '#a8703c'); f(X - 4, PORCH_Y - 10, W2 + 8, 1, '#6b4320');
    for (let x = X - 1; x < X + W2 + 4; x += 6) f(x, PORCH_Y - 9, 1, 11, '#8b5a2b');
    f(X - 4, PORCH_Y + 1, W2 + 8, 1, '#c98d4f'); f(X - 4, PORCH_Y + 2, W2 + 8, 3, '#6b4320'); f(X - 4, PORCH_Y + 5, W2 + 8, 1, '#2a1d14');
    f(X + 58, PORCH_Y + 5, 20, 3, '#8b5a2b'); f(X + 58, PORCH_Y + 5, 20, 1, '#c98d4f'); f(X + 58, PORCH_Y + 8, 20, 1, '#4e3626');
    // its two ends, told apart at a glance: a red runner where they wait on you, a straw rug where those who are done sit, a mat at the door between
    for (const [x, w, mid, lit, dark] of [[X - 4, 63, '#9c3b30', '#c8584c', '#6b2a22'], [X + 80, 60, '#c9a24a', '#e9c46a', '#8a7140']]) {
      f(x, PORCH_Y - 7, w, 8, mid); f(x, PORCH_Y - 7, w, 1, lit); f(x, PORCH_Y, w, 1, dark); for (let i = 3; i < w - 2; i += 5) f(x + i, PORCH_Y - 5, 1, 4, dark);
    }
    f(X + 60, PORCH_Y - 4, 16, 5, '#6b8f4a'); f(X + 60, PORCH_Y - 4, 16, 1, '#8fb26a');
  }
  /** The henhouse and its run: a little coop, a ramp, a fence; hens and eggs are drawn every frame. */
  function henhouse(f, X, Y, S) {
    f(X + 32, Y + 10, 3, 24, S.shadow);
    shingles(f, X, Y, 32, 12, 3, ['#2a1d14', '#5a1f19', '#9c3b30', '#b23a2e']);
    if (S.snow) f(X + 2, Y, 28, 3, '#ffffff');
    f(X + 2, Y + 13, 28, 18, '#c98d4f'); for (let y = Y + 16; y < Y + 31; y += 3) f(X + 2, y, 28, 1, '#a8703c'); f(X + 2, Y + 13, 2, 18, '#e2b07a');
    f(X + 12, Y + 19, 8, 12, '#2a1d14'); f(X + 5, Y + 17, 5, 4, '#2a1d14'); f(X + 23, Y + 17, 5, 4, '#2a1d14'); // door, windows
    f(X + 13, Y + 31, 6, 4, '#8b5a2b'); f(X + 13, Y + 32, 6, 1, '#6b4320'); f(X + 13, Y + 34, 6, 1, '#6b4320'); // ramp
    f(X + 2, Y + 31, 30, 1, '#4e3626');
    fenceAcross(f, X + 36, X + 92, Y + 6); fenceAcross(f, X + 36, X + 92, Y + 36); fenceDown(f, X + 90, Y + 6, Y + 36);
    for (let i = 0; i < 6; i++) f(X + 40 + noise(i, 5) % 46, Y + 12 + noise(5, i) % 20, 1, 1, '#c9a46a'); // scattered grain
  }
  /** The pond: a sandy bank, deep water at the edge, sky reflected in the middle, lily pads and reeds. */
  function pond(f, cx, cy, S) {
    oval(f, cx + 1, cy + 1, 34, 16, '#9a7442'); oval(f, cx, cy, 34, 15, '#c9a46a');
    const deep = S.snow ? '#9aa4ad' : '#2c4a85', water = S.snow ? '#c3cbd2' : '#3d7be0', lit = S.snow ? '#e6eef5' : '#5ab4ff';
    oval(f, cx, cy, 31, 13, deep); oval(f, cx + 1, cy + 1, 29, 11, water);
    oval(f, cx - 6, cy - 3, 12, 3, lit); f(cx + 8, cy + 4, 9, 1, lit); f(cx - 18, cy + 3, 5, 1, lit);
    if (!S.snow) { oval(f, cx + 16, cy + 5, 3, 2, '#3f9b3a'); f(cx + 16, cy + 4, 1, 1, '#6cc04a'); oval(f, cx - 14, cy + 6, 2, 1, '#3f9b3a'); f(cx - 15, cy + 5, 1, 1, '#ffffff'); } // lily pads, a flower
    for (const [rx, h] of [[cx - 33, 7], [cx - 30, 9], [cx + 31, 8], [cx + 34, 6]]) { f(rx, cy - h + 2, 1, h, '#6b8f4a'); f(rx, cy - h, 1, 2, '#6b4320'); } // reeds
    for (const [sx, sy] of [[cx - 22, cy - 14], [cx + 26, cy - 11], [cx + 12, cy + 15]]) stone(f, sx, sy, 2);
  }

  /* ---------- layout: buildings along the top, the yard down the left, the fields in a fenced grid ---------- */

  // Fixed: the grid always has nine beds, and the ones no repo uses lie empty, so the farm keeps its
  // shape (and its size on screen) as repos come and go.
  const W = 400, MAX_FIELDS = 18, COLW = 88, ROWH = 62, MIN_ROWS = 3, MAX_ROWS = 6;
  const PORCH_Y = 78, LANE = 87; // where farmers stand on the porch (and among the scarecrows); the lane in front of the buildings
  const CORR = [116, 218, 306]; // paths running down: the yard's, then the walkways between field columns
  const HOUSE_DOOR = { x: 200, x0: 193, y0: 47, x1: 207, y1: 65 }; // the farmhouse's front door: where a new farmer comes out, and what opens for it
  const MEADOW = [[28, 162], [74, 166], [40, 186], [86, 186]]; // where farmers working outside any repo stand
  const NAPS = [[97, 204], [97, 224]]; // hammocks by the pond: sessions that will wake up by themselves (/loop)
  const STALL = { x: 284, y: 48 }, BOARD = { x: 113, y: 62 }; // the market stall (pull requests), the notice board (memory)
  /** A cart's way between two places: onto the lane (straight down or up to it, or up the path nearest), along it, then down the path nearest the place, and over to it. */
  function cartRoute([x, y], [tx, ty]) {
    if (Math.abs(y - ty) < 0.5) return [[tx, ty]];
    const near = to => CORR.reduce((best, c) => (Math.abs(to - c) < Math.abs(to - best) ? c : best));
    const pts = [];
    if (Math.abs(y - LANE) > 0.5) {
      const c = y < LANE ? x : near(x);
      if (y > LANE) pts.push([c, y]);
      pts.push([c, LANE]);
    }
    if (Math.abs(ty - LANE) <= 0.5) pts.push([tx, ty]);
    else {
      const c = ty < LANE ? tx : near(tx);
      pts.push([c, LANE]);
      if (ty > LANE) pts.push([c, ty]);
      pts.push([tx, ty]);
    }
    return pts.filter((p, i) => { const q = i ? pts[i - 1] : [x, y]; return p[0] !== q[0] || p[1] !== q[1]; });
  }
  const CART_STAY_MS = 3000;
  /**
   * Where a server's cart heads: beside the farmer calling it. Once there it stays while the call goes
   * on and a few seconds after (so a short call is seen, and a run of them keeps it there), then home.
   * `c` is the cart's own memory: { goal, arrivedAt, lastBusy }.
   */
  function cartGoal(c, busyAt, home, now) {
    if (busyAt) {
      if (!c.goal || c.goal[0] !== busyAt[0] || c.goal[1] !== busyAt[1]) { c.goal = busyAt; c.arrivedAt = null; }
      c.lastBusy = now;
      return c.goal;
    }
    if (c.goal && (c.arrivedAt == null || now - Math.max(c.lastBusy ?? 0, c.arrivedAt) < CART_STAY_MS)) return c.goal;
    c.goal = null;
    return home;
  }

  // The farm's fenced grid: 3 beds across, 88 × 62 each, the first at (174, 100); up to 18 beds in 3 to 6 rows.
  const FARM_GRID = makeGrid({
    cols: 3, colW: COLW, rowH: ROWH, cx0: 174, top0: 100, minRows: MIN_ROWS, maxRows: MAX_ROWS, max: MAX_FIELDS,
    slot: (cx, rowTop) => ({ lane: rowTop + 44, x0: cx - 36, y0: rowTop + 12 }),
    fence: rows => ({ x0: 128, x1: 396, y0: 96, y1: 104 + rows * ROWH }), height: fence => fence.y1 + 28,
  });
  const layoutFor = (fields, beds = null, now = Date.now()) => ({ ...FARM_GRID.layoutFor(fields, beds, now), PORCH_Y, LANE });
  const packedLayout = (fields, beds, now = Date.now()) => ({ ...FARM_GRID.packedLayout(fields, beds, now), PORCH_Y, LANE });

  /* ---------- the farm theme: sprites, ground, weather, labels ---------- */

  const K = '#2a1d14';
  // 14×16 farmer, front view, put together from its look. h hat · b hat band · r hair · s skin ·
  // g glasses · p cheeks · C shirt · o overalls · P pole. The eyes are drawn on top (row 6, or 7 looking down).
  const HEADS = {
    straw: ['.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '..kbbbbbbbbk..', '.khhhhhhhhhhk.'],
    cap: ['..............', '.....kkkk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbbbk.'],
    beanie: ['......kk......', '.....kbbk.....', '....kwwhhk....', '...khhhhhhk...', '...kbbbbbbk...'],
    bandana: ['..............', '....kkkkkk....', '...kwwhhhhk...', '...khbhhbhkhk.', '...khhhhhhk.h.'],
    none: ['..............', '....kkkkkk....', '...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...'],
  };
  // Four views: from the front (walking down or standing), from behind (walking up), and from the
  // side (walking right; walking left is its mirror). The hat is the same from every side.
  const FRONT_FACE = look => [
    '...krssssrk...',
    look.extra === 'glasses' ? '...kggkkggk...' : '...kssssssk...',
    look.extra === 'beard' ? '...krssssrk...' : look.extra === 'cheeks' ? '...kpsssspk...' : '...kssssssk...',
    look.extra === 'beard' ? '....krrrrk....' : '....kkkkkk....',
  ];
  const BACK_HEAD = ['...krrrrrrk...', '...krrrrrrk...', '...krrrrrrk...', '....kkkkkk....'];
  const SIDE_FACE = look => [ // facing right: hair at the back, one eye (drawn later), a nose
    '...krrsssssk..',
    look.extra === 'glasses' ? '...krssggggk..' : '...krssssssk..',
    look.extra === 'beard' ? '...krssrrrrrk.' : look.extra === 'cheeks' ? '...krsspssssk.' : '...krsssssssk.',
    look.extra === 'beard' ? '....krrrrrk...' : '....kkkkkkk...',
  ];
  const HIPS = `...k${'o'.repeat(5)}Ok...`;
  const FRONT_BODY = ['..kCCCCCCCck..', '.kCCoCCCCocck.', '.kCCooooooCck.', '.ks.oooooO.sk.', HIPS];
  const BACK_BODY = ['..kCCCCCCCck..', '.kCCCoCCoCcck.', '.kCCooooooCck.', '.ks.oooooO.sk.', HIPS]; // straps cross on the back
  const SIDE_BODY = ['...kCCCCCck...', '...kCCoCCck...', '...kCoooock...', '...kooooOok...', HIPS];
  const LEGS = { s: ['...koo..ook...', '...kkk..kkk...'], a: ['...koo..ook...', '...kkk........'], b: ['...koo..ook...', '........kkk...'], p: ['......PP......', '......PP......'],
    sit: ['..kooo..oook..', '..kkk....kkk..'] }; // seated: its knees apart
  const SIDE_LEGS = { s: ['.....kook.....', '.....kkkk.....'], a: ['....ko..ok....', '...kk....kk...'], b: ['.....koko.....', '....kk..kk....'] };
  /** A farmer's sprite rows: 14 wide, 16 tall, for a view (down, up, right, left) and a leg frame. */
  function spriteRows(look, view = 'down', legs = 's') {
    const head = HEADS[look.hat] ?? HEADS.straw;
    if (view === 'left') return spriteRows(look, 'right', legs).map(r => [...r].reverse().join(''));
    if (view === 'right') return [...head, ...SIDE_FACE(look), ...SIDE_BODY, ...(SIDE_LEGS[legs] ?? SIDE_LEGS.s)];
    if (view === 'up') return [...head, ...BACK_HEAD, ...BACK_BODY, ...(LEGS[legs] ?? LEGS.s)];
    return [...head, ...FRONT_FACE(look), ...FRONT_BODY, ...(LEGS[legs] ?? LEGS.s)];
  }
  const sprites = new Map();
  function farmerSprite(look, color, scare, legs, up, view = 'down') {
    if (scare) view = 'down';
    const key = `${Object.values(look).join()}|${color}|${scare}|${legs}|${up}|${view}`;
    if (sprites.has(key)) return sprites.get(key);
    const pal = scare // a scarecrow keeps its farmer's hat and shape, in straw and sacking
      ? { k: '#3a2a1a', h: '#c9a24a', w: '#e2c27a', b: '#7a5230', r: '#c9a24a', s: '#d8c48a', g: '#d8c48a', p: '#d8c48a', C: '#8b7a55', c: '#6b5a3a', o: '#6b5a3a', O: '#4e3626', P: '#6b4320' }
      : { k: K, h: look.hatColor, w: shade(look.hatColor, 1.3), b: look.band, r: look.hair, s: look.skin, g: '#e6eef5', p: '#e58a8a', C: color, c: shade(color, 0.78), o: look.overalls, O: shade(look.overalls, 0.75), P: '#6b4320' };
    for (const key of Object.keys(pal)) if (!'Cwc'.includes(key)) pal[key] = ink(pal[key]); // one palette; the shirt is the agent's colour, its light and shade made from it
    const c = makeSprite(spriteRows(look, view, legs), pal);
    if (up && view === 'down') { // one arm up, waving; or both (up: 2), stretching
      const g = c.getContext('2d');
      for (const at of up === 2 ? [x => x, x => 13 - x] : [x => x]) { // the left arm is the right one's mirror
        g.clearRect(Math.min(at(11), at(12)), 11, 2, 2); g.fillStyle = color; g.fillRect(at(12), 5, 1, 6); g.fillStyle = pal.s; g.fillRect(at(12), 3, 1, 2); g.fillStyle = K; g.fillRect(at(13), 3, 1, 8);
      }
    }
    sprites.set(key, c);
    return c;
  }

  const FAMILY_PIN = { opus: '#8a5fc0', sonnet: '#3d7be0', haiku: '#2fa57a', fable: '#f08a24' };
  // Small things drawn over a farmer in more than one place: sleep, a bird on its hat, music.
  const zzz = (rp, T, x) => { const zy = -2 - Math.floor((T * 2) % 4); PXG.ctx.globalAlpha = 0.8; rp(x, zy, 3, 1, '#e6eef5'); rp(x + 1, zy + 1, 1, 1, '#e6eef5'); rp(x, zy + 2, 3, 1, '#e6eef5'); PXG.ctx.globalAlpha = 1; };
  const birdOn = (rp, peck, c) => { rp(5, -2, 4, 2, c); rp(4, -3, 2, 2, c); rp(3, -2 + peck, 1, 1, '#f0b429'); rp(8, -1, 2, 1, c); };
  const notes = (rp, T) => { for (let i = 0; i < 2; i++) { const x = -3 - i * 3, y = 4 - Math.floor((T * 3 + i * 3.5) % 7); rp(x + 1, y, 1, 3, K); rp(x, y + 2, 2, 1, K); rp(x + 1, y, 2, 1, K); } }; // on its left: its bubble is on the right
  /** A painter that draws only what lies inside a box { x0, y0, x1, y1 }: part of a thing (a bed half built, a head at a door). */
  const clipTo = (f, b) => (x, y, w, h, c) => {
    const x0 = Math.max(x, b.x0), y0 = Math.max(y, b.y0), x1 = Math.min(x + w, b.x1), y1 = Math.min(y + h, b.y1);
    if (x1 > x0 && y1 > y0) f(x0, y0, x1 - x0, y1 - y0, c);
  };
  /** A creature's painter (creaturePainter) that draws only inside a box: a head at a door. */
  const clipPainter = (x, y, face, b) => { const f = clipTo(px, b); return (dx, dy, w, h, c) => f(Math.round(face > 0 ? x + dx : x - dx - w), Math.round(y + dy), w, h, c); };

  /* ---------- building a field and packing it up: the steps, and how much of the bed stands (pure, tested) ---------- */

  /**
   * How a field's bed is built, as the legs its builder walks, each putting up one part of it as it goes: round the frame
   * (top, right, front, left), then along the four rows, there and back. Packing it up is the same legs backwards.
   * Each leg: { a, b, part, box, axis, from }: from a to b; the part's box; it grows along `axis` from its `from` end.
   */
  function bedLegs(s) {
    const { x0, y0 } = s, L = x0 - 3, R = x0 + 75, T = y0 - 3, B = y0 + 39, row = k => y0 + 6 + k * 8;
    const legs = [
      { a: [x0 - 2, y0 - 1], b: [x0 + 73, y0 - 1], part: 'top', box: { x0: L, y0: T, x1: R + 2, y1: y0 }, axis: 'x', from: 'lo' },
      { a: [x0 + 73, y0 - 1], b: [x0 + 73, y0 + 37], part: 'right', box: { x0: x0 + 72, y0: y0, x1: R + 2, y1: B + 2 }, axis: 'y', from: 'lo' },
      { a: [x0 + 73, y0 + 37], b: [x0 - 2, y0 + 37], part: 'front', box: { x0: L, y0: y0 + 34, x1: x0 + 72, y1: B + 2 }, axis: 'x', from: 'hi' },
      { a: [x0 - 2, y0 + 37], b: [x0 - 2, y0 - 1], part: 'left', box: { x0: L, y0: y0, x1: x0, y1: y0 + 34 }, axis: 'y', from: 'hi' },
    ];
    for (let k = 0; k < 4; k++) {
      const [ax, bx] = k % 2 ? [x0 + 71, x0 + 1] : [x0 + 1, x0 + 71];
      legs.push({ a: [legs.at(-1).b[0], legs.at(-1).b[1]], b: [ax, row(k)], part: null }); // across to the row's end: nothing built on the way
      legs.push({ a: [ax, row(k)], b: [bx, row(k)], part: `row${k}`, box: { x0, y0: y0 + (k ? 1 + k * 8 : 0), x1: x0 + 72, y1: k === 3 ? y0 + 34 : y0 + 9 + k * 8 }, axis: 'x', from: k % 2 ? 'hi' : 'lo' });
    }
    return legs;
  }
  /** The boxes of a bed that stand when its builder is `t` (0 to 1) along leg `i`: every part of the legs before, and that leg's part as far as it has come. */
  /* ---------- a field's record: what its farmers have done, in all and lately (pure, tested) ---------- */
  // The kinds of step (the collector's: derive/step.mjs) in six groups: [key, chalk colour, kinds, words].
  const WORK_GROUPS = [
    ['make', '#6cc04a', ['edit', 'write', 'delete'], 'changing files'], ['look', '#5ab4ff', ['read', 'search', 'web', 'mcp', 'skill'], 'reading and searching'],
    ['check', '#ffd43b', ['test', 'lint', 'build'], 'testing and building'], ['ship', '#f08a24', ['commit', 'push', 'deploy', 'pull', 'install'], 'git and deploys'],
    ['plan', '#b38df0', ['plan', 'ask', 'agent'], 'planning and helpers'], ['run', '#c3cbd2', ['shell', 'serve', 'other'], 'other commands'],
  ];
  const STEP_WORDS = { edit: 'edits', write: 'new files', delete: 'deletions', read: 'reads', search: 'searches', web: 'web', mcp: 'connector calls', skill: 'skills', test: 'test runs', lint: 'lint runs', build: 'builds', commit: 'commits', push: 'pushes', deploy: 'deploys', pull: 'pulls', install: 'installs', plan: 'plans', ask: 'questions', agent: 'subagents', shell: 'commands', serve: 'watching', other: 'other' };
  const groupOf = step => WORK_GROUPS.find(g => g[2].includes(step)) ?? WORK_GROUPS.at(-1);
  /** A length of time in short: 40 s, 12 min, 1h 05m. */
  const spanText = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 90 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`; };
  /**
   * What a field's farmers have done between them: { total, steps (by kind), groups [{ key, color, words, n }], failed, streak (failures in a
   * row just now: the most of any of them), lastTest ({ ok, at }: the latest), testing (one runs its tests now), timeline (their steps of the
   * last half hour, oldest first: { at, step, ok }) }. From each farmer's `work` and `timeline`, as the collector counts them.
   */
  function tallyOf(farmers) {
    const steps = {}, timeline = [];
    let failed = 0, streak = 0, lastTest = null, testing = false;
    for (const f of farmers) {
      for (const [k, n] of Object.entries(f.work?.steps ?? {})) steps[k] = (steps[k] ?? 0) + n;
      failed += f.work?.failed ?? 0;
      streak = Math.max(streak, f.work?.streak ?? 0);
      if (f.work?.lastTest && (!lastTest || f.work.lastTest.at > lastTest.at)) lastTest = f.work.lastTest;
      if (f.state === 'working' && f.step === 'test') testing = true;
      timeline.push(...(f.timeline ?? []));
    }
    const groups = WORK_GROUPS.map(([key, color, kinds, words]) => ({ key, color, words, n: kinds.reduce((t, k) => t + (steps[k] ?? 0), 0) }));
    return { total: groups.reduce((t, g) => t + g.n, 0), steps, groups, failed, streak, lastTest, testing, timeline: timeline.sort((a, b) => a.at - b.at) };
  }
  /** A field's record in words, a line each: how much in all, each group with its kinds, the tests, who did how much, and for how long. */
  function tallyLines(tally, farmers, now) {
    const lines = [{ text: `${tally.total} step${tally.total === 1 ? '' : 's'} so far${tally.failed ? `, ${tally.failed} failed` : ''}` }];
    for (const g of tally.groups) {
      if (!g.n) continue;
      const kinds = WORK_GROUPS.find(x => x[0] === g.key)[2].filter(k => tally.steps[k]).map(k => `${tally.steps[k]} ${STEP_WORDS[k]}`);
      lines.push({ color: g.color, text: `${g.words}: ${kinds.join(', ')}` });
    }
    if (tally.testing) lines.push({ text: 'tests: running now' });
    else if (tally.lastTest) lines.push({ text: `tests: the last run ${tally.lastTest.ok ? 'passed' : 'failed'}, ${spanText(now - tally.lastTest.at)} ago` });
    if (tally.streak > 1) lines.push({ text: `${tally.streak} steps failed in a row just now` });
    const worked = farmers.filter(f => f.work);
    if (worked.length > 1) for (const f of worked) lines.push({ text: `${f.name}: ${Object.values(f.work.steps).reduce((t, n) => t + n, 0)} steps` });
    const one = worked.length === 1 ? worked[0] : null;
    if (one?.startedAt) lines.push({ text: `session ${spanText(now - one.startedAt)}${one.turn?.startedAt ? `, this turn ${spanText(now - one.turn.startedAt)}` : ''}` });
    return lines;
  }
  // Chalk figures for the slate, 3 × 5: one string per digit, a row per three characters.
  const CHALK = { k: '101101110101101' }, CHALK_DIGITS = ['111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001', '111100111001111', '111100111101111', '111001010010010', '111101111101111', '111101111001111'];
  CHALK_DIGITS.forEach((d, i) => { CHALK[i] = d; });
  /** A number on the slate in chalk, its last figure ending at x (three figures at most: a thousand and more is 4k, 12k). */
  function chalk(f, x, y, n, c) {
    [...(n > 999 ? `${Math.min(99, Math.floor(n / 1000))}k` : String(n))].reverse().forEach((d, j) => { for (let i = 0; i < 15; i++) if (CHALK[d][i] === '1') f(x - 3 - j * 4 + (i % 3), y + Math.floor(i / 3), 1, 1, c); });
  }

  /* ---------- the porch cat: where it is and what it does there, by the clock; its ways; how it looks (pure, tested) ---------- */
  // Its places, each clear of the farmers on the porch and of their name tags: the door mat, the porch steps (their left side: a pumpkin has
  // the right in October), the lane before either end of the porch and at its far ends, the house's roof above the door, and indoors (not seen).
  const CAT = { mat: [200, 77], step: [196, 86], laneL: [168, 89], laneR: [250, 89], farL: [142, 89], farR: [276, 89], roof: [198, 36], in: [200, 69] };
  // Up to the roof it goes from outside the house, never through it: from the lane beside the market stall onto the stall's awning, from there
  // over to the roof's edge, then along the shingles above the "Your turn" sign.
  const CAT_UP = { foot: [279, 89], stall: [288, 48], edge: [265, 33], ridge: 32 }; // ridge: the row it walks on the shingles, above the "Your turn" sign
  const CAT_LANE = 89, CAT_BLOCK_MS = 600_000;
  // [out of 100, where, how]: by day, by night. How: 'nap', 'watch' (it sits and looks about) or 'awake' (it sits, grooms, stretches, plays).
  // By night it keeps where the porch lamp shines (its mat) or stays indoors: nothing lights it elsewhere.
  const CAT_DAY = [[16, 'mat', 'nap'], [26, 'mat', 'awake'], [36, 'step', 'watch'], [48, 'laneL', 'awake'], [60, 'laneR', 'awake'], [74, 'roof', 'nap'], [100, 'in', null]];
  const CAT_NIGHT = [[40, 'mat', 'nap'], [52, 'mat', 'awake'], [100, 'in', null]];
  /** The stretch of time `now` is in: stretches of 40 s to 4 min, one after the other (cut at each ten minutes), each with a number of its own. */
  function catStretch(now) {
    const block = Math.floor(now / CAT_BLOCK_MS);
    for (let k = 0, t = block * CAT_BLOCK_MS; ; k++) {
      const ms = (40 + pick('porch-cat-for', block * 16 + k, 200)) * 1000;
      if (now < t + ms || k === 15) return { block, seed: block * 16 + k, from: t, until: Math.min(t + ms, (block + 1) * CAT_BLOCK_MS) };
      t += ms;
    }
  }
  /**
   * Where the porch cat is now, and what it does there: { spot, act }. It stays for 40 s to 4 min, then moves on (often indoors: about one
   * time in four); one ten minutes in four it is away altogether, sometimes for several in a row. What it does changes every 7 s. Not
   * random: it goes by the clock, so everyone looking sees the same cat in the same place.
   */
  function catPlan(now, { night = false } = {}) {
    const st = catStretch(now);
    if (pick('porch-cat-away', st.block, 100) < 26) return { spot: 'in', act: null }; // away for these ten minutes
    const r = pick('porch-cat', st.seed, 100), a = pick('porch-cat-act', Math.floor(now / 7000), 6);
    const [, spot, how] = (night ? CAT_NIGHT : CAT_DAY).find(([upTo]) => r < upTo);
    const act = how === 'nap' ? 'nap' : how === 'watch' ? ['watch', 'watch', 'groom', 'watch', 'sit', 'watch'][a] : how === 'awake' ? ['sit', 'groom', 'stretch', 'sit', spot === 'mat' ? 'stretch' : 'play', 'groom'][a] : null;
    return { spot, act };
  }
  /**
   * The cat's way from where it is (`at`: { x, y, where: 'ground' | 'stall' | 'roof' | 'in' }) to a place: legs { to } (walked), { jump, where }
   * (a leap: onto the stall's awning, over to the roof's edge, and back the same way), { out } (it steps out of the door), the last with `in`
   * when it goes indoors. On the ground it keeps to the mat, the steps and the lane before the porch, so it never walks through whoever sits or
   * stands on the boards; and every leap is outside the house, beside it.
   */
  function catLegs(at, goal) {
    const legs = [], M = CAT.mat, U = CAT_UP, up = goal === 'roof';
    let [x, y] = [at.x, at.y], where = at.where;
    const walk = (tx, ty) => { if (Math.abs(tx - x) > 0.5 || Math.abs(ty - y) > 0.5) legs.push({ to: [tx, ty] }); [x, y] = [tx, ty]; };
    const leap = (to, w) => { legs.push({ jump: to, where: w }); [x, y] = to; where = w; };
    if (where === 'in') { if (goal === 'in') return []; legs.push({ out: true }); [x, y] = CAT.in; where = 'ground'; walk(M[0], M[1]); }
    if (where === 'roof' && !up) { walk(x, Math.min(y, U.ridge)); walk(U.edge[0] - 6, U.ridge); walk(...U.edge); leap(U.stall, 'stall'); }
    if (where === 'stall' && !up) leap(U.foot, 'ground');
    if (up) {
      if (where === 'roof') { walk(...CAT.roof); return legs; } // up already: over to its place
      if (where === 'ground') { if (y <= 80) walk(M[0], CAT_LANE); else walk(x, CAT_LANE); walk(U.foot[0], CAT_LANE); leap(U.stall, 'stall'); }
      if (where === 'stall') leap(U.edge, 'roof');
      walk(U.edge[0] - 6, U.ridge); walk(CAT.roof[0] + 26, U.ridge); walk(...CAT.roof);
      return legs;
    }
    const toMat = () => { if (y > 80) { walk(x, CAT_LANE); walk(M[0], CAT_LANE); } walk(M[0], M[1]); };
    if (goal === 'mat') toMat();
    else if (goal === 'in') { toMat(); legs.push({ to: CAT.in, in: true }); }
    else { const [gx, gy] = CAT[goal]; if (y <= 80) walk(M[0], CAT_LANE); else walk(x, CAT_LANE); walk(gx, CAT_LANE); walk(gx, gy); }
    return legs;
  }
  /**
   * A leap from one place to another, `k` of the way through (0 to 1): where the cat is, and how it holds itself. It crouches first, then goes
   * up beside whatever it leaps onto and over only at the top (down: out first, then down), so it never passes through it; it lands low.
   */
  function catLeap(from, to, k) {
    if (k < 0.2) return { x: from[0], y: from[1], pose: 'crouch' };
    const t = Math.min(1, (k - 0.2) / 0.72), rise = to[1] < from[1];
    const ex = rise ? t * t * t : 1 - (1 - t) ** 3, ey = rise ? 1 - (1 - t) ** 2 : t * t; // rising: straight up first, across at the top; dropping: across first, then down
    return { x: from[0] + (to[0] - from[0]) * ex, y: from[1] + (to[1] - from[1]) * ey - Math.sin(t * Math.PI) * 3, pose: k > 0.92 ? 'crouch' : rise ? (t < 0.6 ? 'leap' : 'jump') : t < 0.35 ? 'jump' : 'dive' };
  }
  /**
   * The porch cat, ginger, its feet at the painter's origin. pose: sit, watch (its head turns), groom, stretch, loaf (lying, its tail
   * hanging: on the roof), and for a leap: crouch, leap (going up), jump (level), dive (coming down). `eye`: its eyes' colour (they shine at night). Walking and running are the creatures kit's cat.
   */
  function drawPorchCat(p, pose, T, eye = '#1b1420') {
    const G = '#e9a23b', D = '#c8681a', W = '#f6dcae', flick = Math.floor(T * 1.4) % 2;
    if (pose === 'crouch') { p(-4, -3, 8, 3, G); p(-2, -3, 1, 2, D); p(1, -3, 1, 2, D); p(3, -5, 3, 3, G); p(3, -6, 1, 1, G); p(5, -6, 1, 1, G); p(5, -4, 1, 1, eye); p(-5, -5 - flick, 1, 3, D); return; } // low, gathering itself (or just landed)
    if (pose === 'leap') { p(-5, -1, 2, 1, D); p(-4, -3, 3, 2, G); p(-2, -5, 4, 2, G); p(1, -7, 3, 2, G); p(-1, -4, 1, 1, D); p(3, -10, 3, 3, G); p(3, -11, 1, 1, G); p(5, -11, 1, 1, G); p(5, -9, 1, 1, eye); p(5, -7, 2, 1, G); p(-6, -3, 1, 2, D); return; } // going up: stretched, head first
    if (pose === 'dive') { p(-5, -8, 1, 3, D); p(-4, -7, 3, 2, G); p(-2, -5, 4, 2, G); p(1, -3, 3, 2, G); p(-1, -5, 1, 1, D); p(3, -4, 3, 3, G); p(3, -5, 1, 1, G); p(5, -5, 1, 1, G); p(5, -3, 1, 1, eye); p(5, -1, 2, 1, G); return; } // coming down: paws first
    if (pose === 'jump') { p(-4, -5, 8, 2, G); p(-3, -4, 2, 1, D); p(3, -7, 3, 3, G); p(3, -8, 1, 1, G); p(5, -8, 1, 1, G); p(5, -6, 1, 1, eye); p(5, -3, 2, 1, G); p(-6, -4, 2, 1, G); p(-6, -7, 1, 3, D); return; }
    if (pose === 'loaf') { p(-4, -3, 8, 3, G); p(-2, -3, 1, 2, D); p(1, -3, 1, 2, D); p(3, -6, 3, 3, G); p(3, -7, 1, 1, G); p(5, -7, 1, 1, G); p(4, -5, 2, 1, D); p(-5, -1, 1, 3 + flick, D); return; } // eyes shut, its tail over the edge
    if (pose === 'stretch') { p(-4, -6, 3, 4, G); p(-1, -4, 4, 2, G); p(-3, -2, 1, 2, D); p(3, -4, 3, 3, G); p(3, -5, 1, 1, G); p(5, -5, 1, 1, G); p(5, -3, 1, 1, eye); p(4, -1, 3, 1, G); p(-5, -9 + flick, 1, 4, D); return; } // rear up, paws out
    const turn = pose === 'watch' && Math.floor(T * 0.5) % 3 === 0 ? -1 : 0, down = pose === 'groom' ? 1 + (Math.floor(T * 4) % 2) : 0;
    p(-2, -5, 5, 5, G); p(0, -4, 2, 4, W); p(-2, -4, 1, 2, D); p(-4, -1 - flick, 2, 1, D); p(-5, -2 - flick, 1, 1, D); // sitting: body, chest, a stripe, its tail
    p(0 + turn, -9 + down, 4, 4, G); p(0 + turn, -10 + down, 1, 1, G); p(3 + turn, -10 + down, 1, 1, G);
    if (pose === 'groom') { p(3, -5 - (Math.floor(T * 4) % 2), 1, 2, W); p(1, -7 + down, 2, 1, D); return; } // a paw up, its eyes shut
    p(1 + turn * 2, -8, 1, 1, eye); p(3 + turn * 2, -8, 1, 1, turn ? G : eye); p(2 + turn, -6, 1, 1, '#f08a8a');
  }

  /* ---------- the hens: a subagent is a hen of the henhouse (an Explore one is the dog); where they walk, how they look (pure, tested) ---------- */
  // The coop's door (its hatch), the foot of its ramp, the gap into the run beside it, and the way out to the farm below the run's fence.
  const COOP = { door: [24, 126], foot: [24, 136], gap: [43, 131], gate: [24, 143] };
  const RUN = { x0: 50, x1: 92, y0: 112, y1: 129 }; // where hens wait and peck, inside the run's fence
  const HEN_SPEED = 46, HENS_LED = 4, PECK_S = 3.5;
  const inRun = (x, y) => x > 38 && x < 99 && y > 103 && y < 134;
  const sameSpot = (a, b) => Math.abs(a[0] - b[0]) < 0.5 && Math.abs(a[1] - b[1]) < 0.5;
  const joinWay = (from, pts) => pts.filter((q, i) => !sameSpot(q, i ? pts[i - 1] : from));
  /** A place in the run for the k-th hen there. */
  const runSpot = k => [RUN.x0 + ((k * 13) % (RUN.x1 - RUN.x0)), RUN.y0 + ((k * 7) % (RUN.y1 - RUN.y0))];
  /** Between two places out on the farm: along the one path while both lie by the same path, below the lane; else by the lane and the paths (as the carts go). */
  function henWay(from, to) {
    const near = x => CORR.reduce((best, c) => (Math.abs(x - c) < Math.abs(x - best) ? c : best)), c = near(from[0]);
    return from[1] > LANE && to[1] > LANE && c === near(to[0]) ? joinWay(from, [[c, from[1]], [c, to[1]], to]) : cartRoute(from, to);
  }
  /**
   * A hen's whole way from where it is to a place: `to` is a spot on the farm, or 'run' (a spot there: `spot`), or
   * 'door' (home, into the coop; with `peck`, by the run first, where it pecks for a while: the point's third item is
   * how many seconds it stays). From the coop or the run it goes by the ramp's foot; the run's only way out is the gap beside the coop.
   */
  function henRoute(from, to, { spot = runSpot(0), peck = false } = {}) {
    const [x, y] = from, inside = inRun(x, y), atCoop = !inside && x < 34 && y < COOP.gate[1] - 1 && y > 110; // on the ramp, or in the doorway
    const out = inside ? [COOP.gap, COOP.foot] : atCoop ? [COOP.foot] : null; // to the ramp's foot first
    if (to === 'run') return joinWay(from, inside ? [spot] : [...(atCoop ? [COOP.foot] : [...henWay(from, COOP.gate), COOP.foot]), COOP.gap, spot]);
    if (to === 'door') {
      const home = out ?? [...henWay(from, COOP.gate), COOP.foot];
      return joinWay(from, [...(inside ? [] : home), ...(peck && !inside ? [COOP.gap, [...spot, PECK_S]] : []), ...(inside || peck ? [COOP.gap, COOP.foot] : []), COOP.door]);
    }
    return joinWay(from, [...(out ? [...out, COOP.gate] : []), ...henWay(out ? COOP.gate : from, to)]);
  }
  /** A hen, its feet at the painter's origin: white (a Codex one brown), a kerchief in its farmer's colour. pose: stand, walk, peck, flutter, sit. */
  function drawHen(p, pose, T, { codex = false, scarf = '#e04a3a' } = {}) {
    const B = codex ? '#b5763a' : '#ffffff', S = codex ? '#8b5a2b' : '#d5dde4', L = '#f0b429', step = pose === 'walk' ? Math.floor(T * 9) % 2 : 0, up = pose === 'flutter' ? 1 + (Math.floor(T * 14) % 2) : 0;
    if (pose !== 'sit') { if (!step || pose !== 'walk') p(-2, -1 - up, 1, 1 + (up ? 0 : 0), L); if (step || pose !== 'walk') p(1, -1 - up, 1, 1, L); if (pose === 'walk' && !step) p(1, -1, 1, 1, L); }
    const y = (pose === 'sit' ? 0 : -1) - up - (pose === 'walk' ? step : 0);
    p(-3, y - 3, 6, 3, B); p(-4, y - 4, 1, 2, B); p(-2, y - 2, 3, 1, S); // body, tail, wing
    if (pose === 'flutter') { p(-3, y - 5 - (Math.floor(T * 14) % 2), 2, 2, S); p(0, y - 5 - (Math.floor(T * 14 + 1) % 2), 2, 2, S); }
    if (pose === 'peck' && Math.floor(T * 5) % 2) { p(2, y - 3, 2, 2, B); p(4, y - 1, 1, 1, L); p(2, y - 4, 1, 1, '#e04a3a'); p(1, y - 3, 1, 1, scarf); p(3, y - 3, 1, 1, '#1b1420'); return; } // head down at the grain
    p(1, y - 4, 2, 1, scarf); p(1, y - 6, 2, 2, B); p(2, y - 6, 1, 1, '#1b1420'); p(3, y - 5, 1, 1, L); p(1, y - 7, 1, 1, '#e04a3a'); // kerchief, head, eye, beak, comb
  }
  /** An egg in the nest, 3 × 4; a dog's find is a bone, 7 × 3, laid on the grass. */
  function drawEgg(f, x, y, bone) {
    if (bone) { f(x + 1, y + 1, 5, 1, '#f4ecd8'); for (const dx of [0, 6]) { f(x + dx, y, 1, 1, '#ffffff'); f(x + dx, y + 2, 1, 1, '#d8ceb4'); } f(x + 1, y + 2, 5, 1, 'rgba(28,51,32,.35)'); return; }
    f(x, y + 1, 3, 3, '#f4ecd8'); f(x + 1, y, 1, 1, '#f4ecd8'); f(x, y + 1, 1, 1, '#ffffff'); f(x + 2, y + 3, 1, 1, '#cfc4a6');
  }

  function bedStanding(legs, i, t) {
    const boxes = legs.slice(0, i).filter(l => l.part).map(l => l.box), leg = legs[i];
    if (leg?.part && t > 0) {
      const { box, axis, from } = leg, lo = axis === 'x' ? box.x0 : box.y0, hi = axis === 'x' ? box.x1 : box.y1, cut = Math.round((hi - lo) * Math.min(1, t));
      const [p, q] = from === 'lo' ? [lo, lo + cut] : [hi - cut, hi];
      boxes.push(axis === 'x' ? { ...box, x0: p, x1: q } : { ...box, y0: p, y1: q });
    }
    return boxes;
  }
  // What a farmer does for each kind of step, what it holds, and where it stands in its field
  // (looking things up on the left, working the soil on the right, the rest in the middle).
  const ACTIONS = {
    // go: the farmer walks at it: along the bed's rows ('rows'), or round its frame ('frame'); the rest are done standing at the bed's front.
    edit: { prop: 'hoe', verb: 'hoeing the rows', spot: 26, go: 'rows' },
    write: { prop: 'seeds', verb: 'planting seeds', spot: 26, go: 'rows' },
    read: { prop: 'almanac', verb: 'reading the almanac', spot: -26, go: 'frame' },
    search: { prop: 'spyglass', verb: 'scouting the field', spot: -26, go: 'frame' },
    web: { prop: 'pigeon', verb: 'sending a pigeon', spot: -26 },
    mcp: { prop: 'parcel', verb: 'sending a parcel to town', spot: -26 },
    skill: { prop: 'recipe', verb: 'following a recipe', spot: 0 },
    test: { prop: 'magnifier', verb: 'checking the crops', spot: 0 },
    lint: { prop: 'rake', verb: 'raking the rows tidy', spot: 26, go: 'rows' },
    build: { prop: 'hammer', verb: 'mending the fence', spot: 0 },
    install: { prop: 'barrow', verb: 'hauling in supplies', spot: 0 },
    commit: { prop: 'crate', verb: 'packing a crate', spot: 0 },
    push: { prop: 'cart', verb: 'taking crates to market', spot: 0 },
    deploy: { prop: 'cart', verb: 'delivering to town', spot: 0, flag: true },
    pull: { prop: 'mailbag', verb: 'fetching the mail', spot: 0 },
    serve: { prop: 'lantern', verb: 'keeping watch', spot: 0 },
    delete: { prop: 'sickle', verb: 'clearing weeds', spot: 26, go: 'rows' },
    agent: { prop: 'whistle', verb: 'whistling for helpers', spot: 0 },
    plan: { prop: 'clipboard', verb: 'writing the chore list', spot: 0 },
    ask: { prop: 'clipboard', verb: 'writing down a question', spot: 0 },
    shell: { prop: 'can', verb: 'watering', spot: 0, go: 'rows' },
    other: { prop: 'can', verb: 'tending the field', spot: 0, go: 'rows' },
  };
  const OLD_TOOLS = { Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read', Grep: 'search', Glob: 'search', WebSearch: 'web', WebFetch: 'web', Bash: 'shell' };
  /** What a farmer does for a step; a step from an older snapshot goes by its tool. */
  const actionOf = (step, tool) => ACTIONS[step] ?? ACTIONS[OLD_TOOLS[tool]] ?? ACTIONS.other;
  const BLUEPRINT = { prop: 'blueprint', verb: 'drawing up plans (plan mode)', spot: 0 };
  /** What a farmer does now: its step's tool; in plan mode, a blueprint. */
  const doing = f => (f.mode === 'plan' && f.state === 'working' ? BLUEPRINT : f.step || f.tool ? actionOf(f.step, f.tool) : null);
  const shades = new Map();
  /** A colour made darker (k < 1) or lighter (k > 1). */
  function shade(hex, k) {
    const key = hex + k;
    if (!shades.has(key)) shades.set(key, `#${[1, 3, 5].map(i => Math.min(255, Math.round(parseInt(hex.slice(i, i + 2), 16) * k)).toString(16).padStart(2, '0')).join('')}`);
    return shades.get(key);
  }
  // The seed packet on each field's fence: a 5×6 picture of its crop.
  const SEED_ICONS = {
    wheat: ['..y..', '.yyy.', '..y..', '.yyy.', '..g..', '..g..'],
    corn: ['.g.g.', '.yyy.', '.yyy.', '.yyy.', 'gyyyg', '.ggg.'],
    carrot: ['.g.g.', '..g..', 'ooooo', '.ooo.', '.oo..', '..o..'],
    cabbage: ['.....', '.lgl.', 'lgggl', 'lglgl', '.lll.', '.....'],
    sunflower: ['.yyy.', 'yybyy', '.yyy.', '..g..', '.gg..', '..g..'],
    tomato: ['.g.g.', '..g..', '.rrr.', 'rrrrr', 'rrrrr', '.rrr.'],
    pumpkin: ['..g..', '.oOo.', 'oOoOo', 'oOoOo', '.oOo.', '.....'],
  };
  const SEED_PAL = { y: '#e9b949', g: '#3f9b3a', l: '#4f9a35', o: '#f08a24', O: '#c8681a', r: '#e04a3a', b: '#6b4320' };
  function seedSign(crop, x, y) {
    px(x + 4, y + 9, 1, 8, '#6b4320'); // stake
    px(x, y, 9, 10, '#6b4320'); px(x + 1, y + 1, 7, 8, '#f4ecd8');
    (SEED_ICONS[crop] ?? SEED_ICONS.wheat).forEach((row, j) => { for (let i = 0; i < 5; i++) if (row[i] !== '.') px(x + 2 + i, y + 2 + j, 1, 1, SEED_PAL[row[i]]); });
  }
  /** Growth stages, as a session's context fills: seeds, sprouts, young plants, in flower, ripening, ripe. */
  const STAGES = ['seeds', 'sprouts', 'young plants', 'in flower', 'ripening', 'ripe'];
  const growthStage = p => (p >= 0.85 ? 5 : p >= 0.7 ? 4 : p >= 0.5 ? 3 : p >= 0.3 ? 2 : p >= 0.12 ? 1 : 0);
  const SEED_COLOR = { wheat: '#d9b26a', corn: '#f2d14b', carrot: '#c98d4f', cabbage: '#6b4320', sunflower: '#3a3a40', tomato: '#f4d58d', pumpkin: '#f1e4c3' };
  const G = '#3f9b3a', GL = '#6cc04a', GP = '#8fd16a'; // stem, leaf, pale leaf
  /** One plant at (x, y) at a growth stage (0–5). Returns the y of its top, for the ripe sparkle. */
  function drawCrop(crop, x, y, stage, sway) {
    if (stage <= 0) { px(x - 1, y, 3, 1, '#5e3d22'); px(x, y - 1, 1, 1, SEED_COLOR[crop] ?? '#d9b26a'); return y - 1; } // a seed in its mound
    if (stage === 1) { // sprouts: blades for grasses, a pair of seed leaves for the rest
      if (crop === 'wheat' || crop === 'corn') { px(x, y - 3, 1, 3, GL); px(x + 1, y - 2, 1, 1, GP); return y - 3; }
      if (crop === 'carrot') { px(x, y - 2, 1, 2, GL); px(x - 1, y - 3, 1, 1, GP); px(x + 1, y - 3, 1, 1, GP); return y - 3; }
      px(x, y - 2, 1, 2, G); px(x - (crop === 'pumpkin' ? 2 : 1), y - 3, crop === 'pumpkin' ? 2 : 1, 1, GP); px(x + 1, y - 3, crop === 'pumpkin' ? 2 : 1, 1, GP);
      return y - 3;
    }
    switch (crop) {
      case 'corn': {
        const h = [0, 0, 5, 8, 9, 10][stage];
        px(x, y - h, 1, h, '#4f9a35'); px(x - 2, y - h + 3, 2, 1, GL); px(x + 1, y - h + 5, 2, 1, GL);
        if (stage >= 3) px(x - 1 + sway, y - h - 1, 3, 1, '#d9b26a'); // the tassel
        if (stage === 4) { px(x + 1, y - h + 2, 2, 3, '#9ed36a'); px(x + 2, y - h + 1, 1, 1, '#c97b4a'); } // a green cob, silk on top
        if (stage === 5) { px(x + 1, y - h + 1, 2, 3, '#f2d14b'); px(x + 1, y - h + 4, 2, 1, GP); }
        return y - h - 1;
      }
      case 'carrot': {
        const h = [0, 0, 3, 4, 4, 5][stage];
        px(x, y - h, 1, h, G); px(x - 1, y - h, 1, 1, GL); px(x + 1, y - h + 1, 1, 1, GL);
        if (stage >= 3) { px(x - 2, y - h + 1, 1, 1, GP); px(x + 2, y - h, 1, 1, GP); }
        if (stage === 3) px(x, y - h - 1, 1, 1, '#f4f1e1'); // a little white flower head
        if (stage >= 4) px(x - 1, y, 3, 1, stage === 5 ? '#ff7a1a' : '#f0a060'); // the root's shoulder
        if (stage === 5) px(x, y + 1, 1, 1, '#e8691a');
        return y - h - 1;
      }
      case 'cabbage': {
        const w = [0, 0, 3, 4, 5, 5][stage], h = [0, 0, 1, 2, 3, 3][stage];
        px(x - (w >> 1) - (stage >= 4 ? 1 : 0), y - 1, w + (stage >= 4 ? 2 : 0), 1, '#4f9a35'); // outer leaves
        px(x - (w >> 1), y - h - 1, w, h, stage >= 4 ? '#7fb24a' : GP);
        if (stage === 3) px(x - (w >> 1) + 1, y - h - 1, 1, h, '#4f9a35'); // veins in the open leaves
        if (stage >= 4) px(x - (w >> 1) + 1, y - h - 1, w - 2, 1, stage === 5 ? '#c6e89a' : '#a8d070'); // the head
        if (stage === 5) px(x - (w >> 1) + 2, y - h, 1, 1, '#b8e08a');
        return y - h - 1;
      }
      case 'sunflower': {
        const h = [0, 0, 4, 7, 9, 10][stage];
        px(x, y - h, 1, h, G); px(x + 1, y - h + 3, 2, 1, GL); if (stage >= 3) px(x - 2, y - h + 5, 2, 1, GL);
        if (stage === 2) px(x - 1, y - h, 1, 1, GP);
        if (stage === 3) px(x + sway, y - h - 1, 1, 1, '#9ed36a'); // a green bud
        if (stage === 4) { px(x - 1 + sway, y - h - 2, 2, 2, '#f4c430'); px(x + sway, y - h - 1, 1, 1, '#6b8f3a'); } // opening
        if (stage === 5) { px(x - 1 + sway, y - h - 2, 3, 3, '#f4c430'); px(x + sway, y - h - 1, 1, 1, '#6b4320'); } // in bloom
        return y - h - 2;
      }
      case 'tomato': {
        const h = [0, 0, 3, 5, 6, 7][stage];
        px(x + 1, y - h - 1, 1, h + 1, '#8b5a2b'); px(x, y - h, 1, h, G); px(x - 1, y - h + 1, 1, 1, GL);
        if (stage >= 3) px(x - 1, y - h + 3, 1, 1, GL);
        if (stage === 3) { px(x - 1, y - h + 2, 1, 1, '#f4d03f'); px(x, y - h - 1, 1, 1, '#f4d03f'); } // yellow flowers
        if (stage === 4) { px(x - 1, y - h + 2, 2, 2, '#9ed36a'); px(x - 1, y - 3, 2, 2, '#f08a3a'); } // green, then turning
        if (stage === 5) { px(x - 1, y - h + 2, 2, 2, '#e04a3a'); px(x - 1, y - 3, 2, 2, '#e04a3a'); px(x, y - h + 2, 1, 1, '#ff7a6a'); }
        return y - h - 1;
      }
      case 'pumpkin': {
        px(x - 2, y - 1, 5, 1, G); px(x - 3, y - 3, 2, 2, GL);
        if (stage >= 3) px(x + 2, y - 3, 2, 2, GL);
        if (stage === 3) px(x, y - 3, 1, 2, '#f4d03f'); // a big yellow flower
        if (stage === 4) { px(x - 1, y - 3, 2, 2, '#6b8f3a'); px(x, y - 4, 1, 1, G); } // a small green pumpkin
        if (stage === 5) { px(x - 2, y - 4, 4, 3, '#ff8c1a'); px(x - 1, y - 4, 1, 3, '#e07a10'); px(x, y - 5, 1, 1, G); }
        return y - (stage === 5 ? 5 : 4);
      }
      default: { // wheat
        const h = [0, 0, 4, 6, 7, 8][stage];
        px(x, y - h, 1, h, stage === 5 ? '#b8a040' : G); px(x - 1, y - h + 1, 1, 1, GL); px(x + 1, y - h + 2, 1, 1, GL);
        if (stage === 2) px(x + 1, y - h, 1, 1, GP);
        if (stage === 3) px(x + sway, y - h - 2, 1, 2, '#9ed36a'); // a green ear
        if (stage === 4) px(x - 1 + sway, y - h - 2, 3, 2, '#c9c45a');
        if (stage === 5) { px(x - 1 + sway, y - h - 2, 3, 2, '#e9c46a'); px(x + sway, y - h - 3, 1, 1, '#f4d58d'); return y - h - 3; }
        return y - h - 2;
      }
    }
  }

  /** What a working farmer holds, around its sprite (rp draws in sprite pixels; the farmer spans x 1–12, y 0–15). */
  /** A line a pixel thick between two of a sprite's pixels: a tool's handle, an arm. */
  function seg(rp, x0, y0, x1, y1, c) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
    for (let i = 0; i <= n; i++) rp(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1, c);
  }
  /** The beat of a tool's work, four to the stroke: 0 raised, 1 coming down, 2 the stroke itself, 3 drawn back. `rate`: strokes a second. */
  const beat = (T, rate = 1) => Math.floor(T * rate * 4) % 4;
  const TOOL_RATE = { hoe: 0.9, rake: 0.8, sickle: 1.1, hammer: 1.3, seeds: 0.8, can: 0.5 };
  const WOOD = '#8b5a2b', WOOD_D = '#5e3d22', STEEL = '#c3cbd2', STEEL_D = '#6f7b88';
  /**
   * A farmer's tool, drawn over its sprite (which faces right; mirror `rp` for one facing left). The tools of the bed are drawn large and
   * outlined, in four beats to the stroke (beat), and held: with `arm` ({ shirt, skin }) the farmer's arm reaches to the handle.
   */
  function drawProp(prop, rp, T, flag, arm) {
    const b = beat(T, TOOL_RATE[prop]);
    const hold = (hx, hy) => { if (arm) { seg(rp, 9, 9, hx, hy, arm.shirt); rp(hx, hy, 1, 1, arm.skin); } };
    switch (prop) {
      case 'can': { // watering: a can with a long spout and a rose, tipped; the water falls in an arc
        const tip = b === 1 || b === 2 ? 1 : 0;
        rp(11, 8 + tip, 5, 5, '#5f84ad'); rp(11, 8 + tip, 5, 1, '#a9c4e0'); rp(11, 12 + tip, 5, 1, '#3f5f85'); rp(10, 9 + tip, 1, 3, '#3f5f85'); // its body, lit above, its handle behind
        seg(rp, 16, 10 + tip, 18, 8 + tip * 2, '#5f84ad'); rp(18, 7 + tip * 2, 2, 2, '#3f5f85'); rp(19, 7 + tip * 2, 1, 1, '#a9c4e0'); // spout and rose
        if (tip) for (let i = 0; i < 5; i++) { const ph = (T * 2.2 + i / 5) % 1; rp(Math.round(19 + ph * 2), Math.round(10 + ph * 6), 1, 1, i % 2 ? '#5ab4ff' : '#a9dcf7'); }
        if (tip) rp(18, 15, 4, 1, '#3d7be0');
        hold(11, 9 + tip);
        return;
      }
      case 'hoe': { // editing: raised, down, into the soil, drawn back with the soil
        const at = [[14, 2, 12, 5], [17, 6, 13, 8], [16, 13, 12, 11], [14, 14, 11, 11]][b], [bx, by, hx, hy] = at; // the blade's place, and the hand's on the handle
        seg(rp, hx - 2, hy + 2, bx, by, WOOD_D); seg(rp, hx - 2, hy + 1, bx, by - 1, WOOD);
        rp(bx, by - 1, 3, 3, STEEL_D); rp(bx, by - 1, 3, 1, STEEL); rp(bx + 2, by, 1, 2, STEEL); // the blade, its edge bright
        if (b === 2) { rp(19, 12, 1, 1, WOOD_D); rp(20, 14, 1, 1, '#7a5230'); rp(18, 15, 2, 1, WOOD_D); } // clods fly
        if (b === 3) rp(15, 15, 4, 1, '#3a2414'); // the turned soil
        hold(hx, hy);
        return;
      }
      case 'seeds': { // a new file: a seed bag at the hip, a handful cast along the row
        rp(10, 9, 4, 6, '#e8dcc0'); rp(10, 9, 4, 1, '#c9b48a'); rp(10, 14, 4, 1, '#8a7a55'); rp(13, 10, 1, 4, '#b8a880'); rp(11, 11, 2, 2, '#6cc04a'); // the bag: its fold, its seam, a sprout printed on it
        const cast = [[[14, 8]], [[15, 7], [16, 9]], [[16, 10], [18, 11], [17, 13]], [[15, 15], [17, 15], [19, 15]]][b];
        for (const [x, y] of cast) rp(x, y, 1, 1, b === 3 ? '#c9a24a' : '#f4d58d');
        hold([13, 14, 15, 12][b], [8, 7, 9, 9][b]);
        return;
      }
      case 'almanac': // reading: an open book held before it, a page turning
        rp(7, 9, 9, 6, '#8b3a2e'); rp(8, 9, 7, 5, '#fff4d6'); rp(11, 9, 1, 5, '#c9b48a'); // cover, pages, spine
        for (const y of [10, 12]) { rp(8, y, 2, 1, '#9aa4ad'); rp(13, y, 2, 1, '#9aa4ad'); }
        if (Math.floor(T * 0.6) % 4 === 0) { rp(12, 8, 2, 1, '#ffffff'); rp(13, 9, 1, 4, '#ffffff'); } // a page goes over
        hold(8, 13);
        return;
      case 'spyglass': { // searching: a brass spyglass at the eye, sweeping the field
        const dy = Math.floor(T * 1.2) % 2;
        rp(10, 5 + dy, 3, 3, '#a8873a'); rp(13, 5 + dy, 4, 2, '#c9a24a'); rp(13, 5 + dy, 4, 1, '#f1d98a'); rp(17, 4 + dy, 2, 4, '#7a5f22'); rp(18, 5 + dy, 1, 2, '#bfe6ff'); // three draws, the lens ring and its glass
        if (Math.floor(T * 2) % 3 === 0) rp(19, 4 + dy, 1, 1, '#ffffff');
        hold(12, 8 + dy);
        return;
      }
      case 'pigeon': { // the web: a pigeon flies out and back
        const bx = Math.round(7 + Math.cos(T * 2) * 16), by = Math.round(-8 + Math.sin(T * 4) * 3), up = blink(6);
        rp(bx, by, 2, 1, '#ececec'); rp(bx + 2, by, 1, 1, '#f0b429'); rp(bx - 1, by + (up ? -1 : 1), 2, 1, '#bdbdbd'); rp(bx, by + 1, 1, 1, '#9aa0a6');
        return;
      }
      case 'magnifier': { // tests: a magnifying glass moved over the crops, its ring dark, its glass bright
        const lx = 13 + Math.round(Math.sin(T * 2.2) * 2), K0 = '#2b2116';
        seg(rp, 11, 13, lx, 12, WOOD_D); seg(rp, 11, 12, lx, 11, WOOD);
        rp(lx + 1, 6, 4, 1, K0); rp(lx + 1, 11, 4, 1, K0); rp(lx, 7, 1, 4, K0); rp(lx + 5, 7, 1, 4, K0); // the ring
        rp(lx + 1, 7, 4, 4, '#cfeaff'); rp(lx + 1, 7, 2, 1, '#ffffff'); rp(lx + 3, 9, 1, 1, '#6cc04a'); // the glass, a glint, a leaf seen large
        hold(11, 12);
        return;
      }
      case 'rake': { // lint and format: pushed out and drawn back over the row
        const hx = [15, 18, 19, 16][b], lift = b === 0 ? 2 : 0; // the head's place
        seg(rp, 10, 10, hx, 14 - lift, WOOD_D); seg(rp, 10, 9, hx, 13 - lift, WOOD);
        rp(hx - 1, 13 - lift, 1, 3, STEEL_D); rp(hx, 13 - lift, 4, 1, STEEL_D); for (let k = 0; k < 4; k++) rp(hx + k, 14 - lift, 1, 2, k % 2 ? STEEL : STEEL_D); // its head and teeth
        if (b === 3) { rp(hx + 4, 15, 3, 1, '#3a2414'); rp(hx + 5, 14, 1, 1, '#6b8f4a'); } // what it gathered
        hold(11, 10);
        return;
      }
      case 'hammer': { // build: a post driven in, the hammer swung from over the shoulder
        rp(16, 9, 3, 7, '#a8703c'); rp(16, 9, 3, 1, '#e2b07a'); rp(18, 10, 1, 6, WOOD_D); // the post, lit on top
        const [hx, hy, tx, ty] = [[11, 6, 12, 1], [12, 7, 15, 3], [12, 9, 16, 7], [12, 7, 15, 4]][b]; // the hand, and the head's place
        seg(rp, hx, hy, tx, ty + 1, WOOD);
        rp(tx - 1, ty - 1, 4, 3, '#4a5560'); rp(tx - 1, ty - 1, 4, 1, '#8794a1'); rp(tx + 2, ty, 1, 2, '#2f3740'); // its head
        if (b === 2) { rp(19, 7, 1, 1, '#ffd43b'); rp(15, 6, 1, 1, '#ffd43b'); rp(20, 9, 1, 1, '#fff3a6'); }
        hold(hx, hy);
        return;
      }
      case 'barrow': { // installing: a wheelbarrow of sacks
        const bump = blink(4);
        rp(11, 11, 2, 1, '#8b5a2b'); rp(13, 10 - bump, 6, 3, '#9aa4ad'); rp(13, 10 - bump, 6, 1, '#c3cbd2');
        rp(14, 8 - bump, 2, 2, '#d8c48a'); rp(16, 7 - bump, 2, 3, '#c9a46a'); rp(14, 13, 1, 2, '#6b4320');
        rp(18, 13, 2, 2, '#2a1d14'); rp(18 + blink(6), 13, 1, 1, '#9aa4ad');
        return;
      }
      case 'crate': { // commit: produce goes into a crate
        rp(13, 10, 6, 5, '#8b5a2b'); rp(13, 10, 6, 1, '#b07a46'); rp(13, 12, 6, 1, '#6b4320'); rp(15, 10, 1, 5, '#6b4320');
        const ph = (T * 1.2) % 1;
        if (ph < 0.8) rp(15, 5 + Math.round(ph * 5), 2, 2, ['#e76f51', '#f4a261', '#e9c46a'][Math.floor(T * 1.2) % 3]);
        rp(11, 11, 2, 1, '#e0a878');
        return;
      }
      case 'cart': { // push: a cart of crates off to market (with a flag: deploying)
        const roll = blink(6);
        rp(11, 10, 2, 1, '#6b4320'); rp(13, 9, 8, 3, '#a8703c'); rp(13, 9, 8, 1, '#c98d4f');
        rp(14, 6, 3, 3, '#8b5a2b'); rp(14, 6, 3, 1, '#b07a46'); rp(17, 7, 3, 2, '#8b5a2b'); rp(17, 7, 3, 1, '#b07a46');
        rp(15, 12, 3, 3, '#2a1d14'); rp(16 - roll, 13, 1, 1, '#9aa4ad'); rp(22, 14, 1, 1, '#b08850');
        if (flag) { rp(20, 2, 1, 7, '#6b4320'); rp(21, 2, 3 + blink(3), 2, '#e63946'); rp(21, 4, 2, 1, '#e63946'); }
        return;
      }
      case 'mailbag': { // pull: a satchel of letters
        rp(4, 9, 1, 1, '#5e3d22'); rp(5, 10, 5, 1, '#5e3d22'); rp(10, 11, 5, 4, '#7a5230'); rp(10, 11, 5, 1, '#5e3d22');
        const up = blink(2); rp(11, 9 - up, 3, 2, '#fff4d6'); rp(13, 9 - up, 1, 1, '#e63946');
        return;
      }
      case 'lantern': { // a server or a long wait: keeping watch with a lantern
        const flick = blink(5);
        PXG.lights?.push([rp.ox + 12.5 * SC, rp.oy + 10 * SC, 12, null]); // it lights its farmer at night
        rp(12, 5, 1, 2, '#2a1d14'); rp(11, 7, 3, 1, '#2a1d14'); rp(11, 8, 3, 4, '#5f6b7a'); rp(12, 9, 1, 2, flick ? '#ffd43b' : '#ff922b'); rp(11, 12, 3, 1, '#2a1d14');
        return;
      }
      case 'sickle': { // deleting: a curved blade swung low through the weeds
        const [hx, hy] = [[12, 7], [13, 9], [13, 12], [12, 11]][b];
        seg(rp, hx - 2, hy + 1, hx, hy, WOOD);
        const blade = [[[1, -1], [2, -2], [3, -3], [4, -3], [5, -2], [6, -1]], [[1, 0], [2, -1], [3, -2], [4, -2], [5, -1], [6, 0]], [[1, 1], [2, 2], [3, 2], [4, 2], [5, 1], [6, 0]], [[1, 0], [2, 1], [3, 1], [4, 1], [5, 0], [5, -1]]][b];
        for (const [dx, dy] of blade) { rp(hx + dx, hy + dy + 1, 1, 1, STEEL_D); rp(hx + dx, hy + dy, 1, 1, STEEL); } // the crescent, its edge under it
        if (b === 2) { rp(19, 12, 1, 2, '#4f8f3a'); rp(20, 10, 1, 1, '#6cc04a'); rp(17, 11, 1, 1, '#4f8f3a'); } // cut stalks fly
        hold(hx - 1, hy);
        return;
      }
      case 'whistle': // subagents: whistling, notes floating up
        rp(9, 7, 2, 1, '#c3cbd2'); rp(11, 8, 1, 2, '#e0a878');
        for (let i = 0; i < 2; i++) { const ph = (T * 1.1 + i / 2) % 1, nx = 13 + i * 3, ny = Math.round(5 - ph * 7); rp(nx, ny, 1, 3, '#ffffff'); rp(nx + 1, ny, 1, 1, '#ffffff'); rp(nx - 1, ny + 2, 1, 1, '#ffffff'); }
        return;
      case 'parcel': { // a connector: a parcel off to town (its cart goes along the road)
        const up = blink(2);
        rp(10, 9 - up, 6, 5, '#c9a46a'); rp(10, 9 - up, 6, 1, '#e2b07a'); rp(12, 9 - up, 1, 5, '#9c3b30'); rp(10, 11 - up, 6, 1, '#9c3b30'); rp(13, 8 - up, 2, 1, '#9c3b30');
        rp(9, 11, 1, 2, '#e0a878');
        return;
      }
      case 'recipe': { // a skill: reading its recipe card
        rp(3, 9, 8, 6, '#fff4d6'); rp(3, 9, 8, 1, '#e04a3a'); rp(4, 11, 6, 1, '#c9b48a'); rp(4, 13, 4, 1, '#c9b48a');
        if (blink(1.5)) { rp(12, 6, 1, 3, '#ffd43b'); rp(11, 7, 3, 1, '#ffd43b'); } // the knack of it
        return;
      }
      case 'blueprint': { // plan mode: drawing up plans, a pencil moving over the sheet
        rp(1, 9, 11, 6, '#2c4a85'); rp(1, 9, 11, 1, '#3d7be0'); rp(3, 10, 1, 5, '#a9dcf7'); rp(1, 12, 11, 1, '#a9dcf7'); rp(7, 11, 3, 2, '#a9dcf7');
        rp(8 + blink(3) * 2, 7, 1, 3, '#f0b429'); rp(8 + blink(3) * 2, 10, 1, 1, '#1b1420');
        return;
      }
      case 'clipboard': // planning: a chore list being ticked
        rp(1, 9, 5, 6, '#a8703c'); rp(2, 10, 3, 4, '#fff4d6'); rp(3, 9, 1, 1, '#9aa4ad'); rp(2, 11, 3, 1, '#9aa0a6'); rp(2, 13, 2, 1, '#9aa0a6');
        if (blink(2)) rp(4, 13, 1, 1, '#2fa57a');
        rp(11, 9, 1, 3, '#f0b429'); rp(11, 12, 1, 1, '#2a1d14');
        return;
      default:
    }
  }

  /** Where a farmer's cart is on the road while a web call goes on: out to town past the farm's right edge, and back. (A connector's has a cart of its own.) */
  function cartOf(f) {
    if (f.state !== 'working' || !f.service || f.step !== 'web' || String(f.tool ?? '').startsWith('mcp__')) return null;
    const ph = (PXG.T / 8 + (hashOf(f.id) % 97) / 97) % 1, out = ph < 0.5, t = out ? ph * 2 : (1 - ph) * 2;
    return { x: Math.round(280 + t * 150), dir: out ? 1 : -1 };
  }
  /** How long until a time, in short: 12m, 2h. */
  const until = at => { const m = Math.max(0, (at - Date.now()) / 60_000); return m < 1 ? 'a moment' : m < 60 ? `${Math.round(m)}m` : `${Math.round(m / 60)}h`; };

  /** For tests and the legend: paints one tool (held by a farmer when `look` is given) or one plant on a 2D context. */
  function paint(ctx, { prop, flag, crop, stage = 0, T = 0, look, face = 'down', legs = 's', land, rows = 1, season }) {
    Object.assign(PXG, { ctx, T, k: 1 });
    if (land) drawLand(px, layoutFor(Array.from({ length: rows * 3 }, (_, i) => ({ key: `f${i}` }))), season);
    if (look) ctx.drawImage(farmerSprite(look, SHIRT[0], false, legs, false, face), 0, 0, 14 * SC, 16 * SC);
    if (prop) drawProp(prop, rpAt(0, 0), T, flag);
    if (crop) drawCrop(crop, 10, 20, stage, 0);
  }

  // Pixel icons for the farm's buttons (9×9): one letter per pixel, '.' clear.
  const ICONS = {
    follow: ['....k....', '..kkkkk..', '.k.....k.', '.k.....k.', 'kk..r..kk', '.k.....k.', '.k.....k.', '..kkkkk..', '....k....'],
    resting: ['.....kkkk', '.......k.', '......k..', '.....kkkk', 'kkkkk....', '...k.....', '..k......', '.k.......', 'kkkkk....'],
    bubbles: ['.........', '.kkkkkkk.', 'kwwwwwwwk', 'kwkwkwkwk', 'kwwwwwwwk', '.kkwkkkk.', '..kk.....', '..k......', '.........'],
    day: ['....y....', '.y.....y.', '...yyy...', '..yyyyy..', 'y.yyyyy.y', '..yyyyy..', '...yyy...', '.y.....y.', '....y....'],
    night: ['...yyy..s', '..yy.....', '.yy......', '.yy...s..', '.yy......', '.yy......', '..yy.....', '...yyy...', '.........'],
    live: ['.........', '...yyy...', '..yyyyy..', '.yyyyyyy.', 'kkkkkkkkk', '.........', '..kkkkk..', '.........', '...kkk...'],
    play: ['..k......', '..kk.....', '..kgk....', '..kggk...', '..kgggk..', '..kggk...', '..kgk....', '..kk.....', '..k......'],
    pause: ['.........', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.........'],
    help: ['..kkkkk..', '.kk...kk.', '......kk.', '....kkk..', '...kk....', '...kk....', '.........', '...kk....', '.........'],
    spring: ['.........', '.gg...gg.', '.ggg.ggg.', '..gg.gg..', '....g....', '....g....', '....g....', '..kkkkk..', '.........'],
    autumn: ['......oo.', '....oooo.', '..ooooo..', '.ooooo...', '.oooo....', '.ooo.....', '.k.......', 'k........', '.........'],
    list: ['.........', 'kk.kkkkkk', '.........', 'kk.kkkkkk', '.........', 'kk.kkkkkk', '.........', '.........', '.........'],
    world: ['..kkkkk..', '.kbbgbbk.', 'kbgggbbbk', 'kbbggbgbk', 'kbbbbbggk', 'kgbbbbbbk', 'kggbbgbbk', '.kbbgbbk.', '..kkkkk..'],
    plus: ['....k....', '....k....', '....k....', 'kkkkkkkkk', '....k....', '....k....', '....k....', '.........', '.........'],
    gear: ['....k....', '.k.kkk.k.', '..kkkkk..', '.kkk.kkk.', 'kkk...kkk', '.kkk.kkk.', '..kkkkk..', '.k.kkk.k.', '....k....'],
    side: ['kkkkkkkkk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'kkkkkkkkk', '.........', '.........'],
    bell: ['....k....', '...kyk...', '..kyyyk..', '..kyyyk..', '..kyyyk..', '.kyyyyyk.', 'kkkkkkkkk', '...kyk...', '....k....'],
    winter: ['....b....', '.b..b..b.', '..b.b.b..', '...bbb...', 'bbbbbbbbb', '...bbb...', '..b.b.b..', '.b..b..b.', '....b....'],
    animals: ['.k.k.k...', '.k.k.k...', '.........', 'k.kkk.k..', '.kkkkk...', '.kkkkk...', '..kkk....', '.........', '.........'],
  };
  // Agentville's mark (the farmhouse, from brand.js), for the farm's panel.
  const brandSvg = () => (typeof window !== 'undefined' && window.Agentville?.svg ? window.Agentville.svg({ size: 18, cls: 'px-logo' }) : ''); // brand.js, loaded in the frame after the bridge
  const ICON_PAL = { k: '#4e3626', w: '#ffffff', y: '#f0b429', s: '#f4ecd8', r: '#e04a3a', g: '#3f9b3a', o: '#c8681a', b: '#a9dcf7' };
  const iconUrls = new Map();
  /** HTML for one of the farm's pixel icons (none without a DOM). */
  function iconImg(name) {
    if (typeof document === 'undefined' || !ICONS[name]) return '';
    if (!iconUrls.has(name)) iconUrls.set(name, makeSprite(ICONS[name], ICON_PAL).toDataURL());
    return `<i class="px-ico" aria-hidden="true" style="background-image:url(${iconUrls.get(name)})"></i>`;
  }

  /* ---------- porch life: who is where on the porch, what it does there, and what happens now and then (pure, tested) ---------- */

  // The porch has two ends with the door between them: on the left those who wait on you, on their feet; on the right those
  // whose turn has ended, in a seat. Three places each, as before; the rest are counted on a "+N" sign.
  const PORCH_SPOTS = { desk: [136, 158, 180], turn: [220, 242, 264] }; // 22 apart: a bubble clears its neighbour's hat
  const MINUTE = 60_000;
  // The longer one waits on you, the more it wants you; the longer its turn has been over, the more it settles in.
  // [from this many minutes, what it is doing], the latest first.
  const PORCH_STAGES = {
    desk: [[15, 'pace'], [5, 'bell'], [1, 'tap'], [0, 'wave']],
    turn: [[180, 'blanket'], [60, 'doze'], [10, 'drink'], [1, 'sit'], [0, 'stand']],
  };
  const porchStage = (zone, since, now) => PORCH_STAGES[zone].find(([min]) => Math.max(0, now - (since ?? now)) >= min * MINUTE)[1]; // a clock behind the collector's: just come
  const stageRank = (zone, stage) => PORCH_STAGES[zone].length - 1 - PORCH_STAGES[zone].findIndex(s => s[1] === stage); // 0: just come
  // The three seats, differently furnished each day (a bench and a swing take two).
  const SEATING = [['rocker', 'bench', 'bench'], ['swing', 'swing', 'rocker'], ['bale', 'rocker', 'crate'], ['bench', 'bench', 'bale'], ['crate', 'swing', 'swing']];
  const dayOf = now => Math.floor((now - new Date(now).getTimezoneOffset() * MINUTE) / 86_400_000);
  const seatingOf = now => SEATING[dayOf(now) % SEATING.length];
  /** Who sits where: in the scene's order, each of the first three takes the seat it likes best if it is free, else the next one along. */
  function porchSeats(ids) {
    const seats = new Map();
    for (const id of ids.slice(0, 3)) { let s = pick(id, 16, 3); while ([...seats.values()].includes(s)) s = (s + 1) % 3; seats.set(id, s); }
    return seats;
  }
  const PASTIMES = ['read', 'whittle', 'knit', 'harmonica', 'stretch', 'watch'];
  const BEAT = 25_000;
  /**
   * What a seated farmer does now. It changes every 25 s (or keeps at it for 50); each has two pastimes it likes best;
   * from its tenth minute it has a drink to sip, and from its hour it mostly dozes.
   */
  function pastimeOf(id, stage, now) {
    if (stage === 'stand') return 'stand';
    const beat = Math.floor((now + pick(id, 11, BEAT)) / BEAT), held = pick(`${id}:${beat}`, 12, 2) ? beat : beat - 1;
    const favs = [PASTIMES[pick(id, 13, PASTIMES.length)], PASTIMES[pick(id, 14, PASTIMES.length)]];
    const pool = ['rest', 'rest', ...PASTIMES, ...favs, ...favs, ...(stage === 'sit' ? [] : ['sip', 'sip', 'sip']), ...(stage === 'doze' || stage === 'blanket' ? Array(12).fill('doze') : [])];
    return pool[pick(`${id}:${held}`, 15, pool.length)];
  }
  // What happens on the porch now and then, the rarest first: [what, one minute in how many, for how many seconds, whom it takes].
  // It goes by the clock, so everyone looking sees the same; with no one for it, the minute passes.
  const SURPRISES = [
    ['peek', 600, 7, 'none'], ['star', 300, 3, 'night'],
    ['duet', 200, 10, 'two'], ['spill', 220, 6, 'drink'], ['yarn', 240, 8, 'seated'], ['tip', 260, 5, 'rocker'],
    ['bird', 8, 9, 'anyone'], ['lapcat', 10, 14, 'seated'], ['sync', 12, 8, 'two'],
  ];
  /** The surprise under way at `now`, if any: { key, t (0 to 1 through it), who: [ids] }. `sat`: [{ id, stage, seat }] seated; `all`: every id on the porch. */
  function surpriseOf(now, { sat = [], all = [], seating = [], night = false } = {}) {
    const minute = Math.floor(now / MINUTE);
    const one = (list, salt) => { const it = list[pick(`who:${minute}`, salt, list.length || 1)]; return it === undefined ? null : [it.id ?? it]; };
    const takers = {
      none: () => [], night: () => (night ? [] : null), anyone: () => one(all, 21), seated: () => one(sat, 22),
      two: () => (sat.length >= 2 ? sat.slice(0, 2).map(s => s.id) : null),
      drink: () => one(sat.filter(s => stageRank('turn', s.stage) >= 2), 23),
      rocker: () => one(sat.filter(s => seating[s.seat] === 'rocker'), 24),
    };
    for (const [key, odds, secs, needs] of SURPRISES) { // one a minute at most: the first whose turn it is and that finds its takers
      const who = pick(`${key}:${minute}`, 17, odds) === 0 ? takers[needs]() : null;
      if (!who) continue;
      const start = minute * MINUTE + pick(`${key}:${minute}`, 18, 60 - secs) * 1000;
      return now >= start && now < start + secs * 1000 ? { key, t: (now - start) / (secs * 1000), who } : null;
    }
    return null;
  }
  /**
   * The porch at `now`, from the scene's farmers: `who` (id → { zone, i, stage, pastime, seat }), today's `seating`, and the
   * `surprise` under way. At most two seated farmers are busy at once (the rest just sit), so the porch stays calm;
   * during a surprise only those in it are.
   */
  function porchNow(farmers, now, { night = false } = {}) {
    const desk = farmers.filter(f => f.state === 'waiting').slice(0, 3), turn = farmers.filter(f => f.state === 'turn' && !f.nap).slice(0, 3);
    const seats = porchSeats(turn.map(f => f.id)), seating = seatingOf(now), who = new Map();
    desk.forEach((f, i) => who.set(f.id, { zone: 'desk', i, stage: porchStage('desk', f.since, now) }));
    for (const f of turn) { const stage = porchStage('turn', f.since, now); who.set(f.id, { zone: 'turn', i: seats.get(f.id), seat: seats.get(f.id), stage, pastime: pastimeOf(f.id, stage, now) }); }
    const sat = turn.map(f => ({ id: f.id, ...who.get(f.id) })).filter(s => s.stage !== 'stand').sort((a, b) => a.seat - b.seat);
    const surprise = surpriseOf(now, { sat, all: [...who.keys()], seating, night });
    let busy = 0;
    for (const s of sat) {
      const p = who.get(s.id), calm = p.pastime === 'rest' || p.pastime === 'doze';
      if (surprise ? !surprise.who.includes(s.id) && !calm : !calm && ++busy > 2) p.pastime = 'rest';
    }
    return { who, seating, surprise };
  }
  // The porch album: everything there is to see on the porch, by what it is called in the diary. A thing counts once it was drawn.
  const ALBUM = {
    rocker: 'a rocking chair', bench: 'the bench', swing: 'the porch swing', bale: 'a hay bale', crate: 'an apple crate',
    tap: 'a tapping foot', bell: 'a bell rung for you', pace: 'pacing the boards', drink: 'a drink', doze: 'a nap under the hat', blanket: 'a blanket over the knees',
    read: 'the paper', whittle: 'whittling', knit: 'knitting', harmonica: 'a harmonica', stretch: 'a good stretch', watch: 'a pocket watch', sip: 'a sip',
    bird: 'a bird on a hat', lapcat: 'the porch cat on a lap', sync: 'rocking in time', duet: 'a duet', spill: 'a spilt drink', yarn: 'a mouse off with the yarn', tip: 'a chair tipped too far',
    peek: 'a unicorn at your front door', star: 'a shooting star', cheers: 'a toast to a merge', pumpkin: 'a pumpkin by the door (October)', lights: 'fairy lights (December)',
  };
  const seasonalOf = now => ({ 9: 'pumpkin', 11: 'lights' })[new Date(now).getMonth()] ?? null;

  function makeFarm() {
    let L = layoutFor([]);
    let seenCompactions = null, seenMerged = null, seenWeather = null; // what the last scene had, so news can be told
    let scene = { fields: [], farmers: [] };
    let season = 'summer';
    // The porch (porch life, above): as it is just now, the album of what was seen there, and what is new in it since the last scene.
    let night = false, keep = null, cheerUntil = 0, porchAt = 0, porch = porchNow([], 0);
    // Someone in the doorway (the door stands open), someone walking up to the door or over its mat (the cat makes way): when, by the frame clock.
    let doorAt = -9;
    // Comings and goings (the farm adds them to the scene it is given: stage(), below).
    //   works: field key → { kind: 'build' | 'pack', by (a farmer's id), on (it is at the bed: at work), i (the leg), t (how far along it), at (when it began) }
    //   leavers: farmer id → the farmer as it last was, on its way back into the farmhouse ({ ...f, state: 'leaving', inside: at the door's foot, gone: in });
    //   ghosts: field key → the field as it last was, kept on the grid while it is packed up.
    const works = new Map(), leavers = new Map(), ghosts = new Map();
    const onMap = new Set(); // the farmers that are out on the farm (not the resting ones while those are hidden): only they can be seen to go
    const seenAt = new Map(); // farmer id → where it last stood: a leaver waits there while its hens set off home
    //   hens: subagent id → { id, by (its farmer's id), dog, codex, bg, x, y, path, phase ('go' to its place, 'at' it, 'home' to the coop), want, tx, ty, wait, k, failed, lays }
    const hens = new Map(), whistled = new Map(); // whistled: farmer id → when (the frame clock) it called a hen
    let henReady = false, henSeq = 0, coopAt = -9, henNews = false;
    let given = null, frozen = false; // the last scene as the dashboard gave it; motion off (nothing is acted out)
    // The porch cat: where it is (on the ground, on the stall's awning, on the roof, or indoors), the legs of its way it still has to go, the
    // leap it is in, and, when someone walked up to it: where it ran to, till when it stays there, and till when it keeps off its mat.
    const cat = { x: CAT.mat[0], y: CAT.mat[1], where: 'ground', goal: null, legs: [], jump: null, face: -1, at: 0, plan: { spot: 'mat', act: 'nap' }, placed: false };
    const walkers = []; // where farmers walked in the last frame: [x, y]
    const album = new Set(), found = [];
    const porchOf = () => { const now = Date.now(); if (now - porchAt > 250) { porch = porchNow(scene.farmers.filter(f => !jobOf(f.id)), now, { night }); porchAt = now; } return porch; };
    const RARE = new Set([...SURPRISES.map(s => s[0]), 'cheers']);
    /** Something on the porch was drawn: the first time, it goes in the album (kept in this browser); a surprise also, with the next scene, in the diary (the everyday things would fill it). */
    const saw = key => { if (!ALBUM[key] || album.has(key)) return; album.add(key); keep?.set('album', [...album].join(',')); if (RARE.has(key)) found.push(key); };
    const stOf = k => L.ST.find(s => s.key === k);
    const fieldByKey = k => scene.fields.find(f => f.key === k);

    /* --- at work on a bed: a farmer whose step is one of the bed's walks at it: along the rows, or round the frame --- */
    //   rounds: farmer id → { key (its field), go ('rows' | 'frame'), i (the point it walks to), on (it has come to the bed), dir (1: it faces right) }
    const rounds = new Map(), TEND_SPEED = 7;
    /** The points of a round on a bed (bedLegs): the rows there and back, or the frame's corners. */
    const roundPoints = (s, go) => { const legs = bedLegs(s); return go === 'frame' ? legs.slice(0, 4).map(l => l.b) : legs.filter(l => l.part?.startsWith('row')).flatMap(l => [l.a, l.b]); };
    /** The round a farmer is on, begun (or dropped) as its step has it: null for one that stands at its work, or has none. */
    function roundOf(f) {
      const act = f.state === 'working' && !jobOf(f.id) ? doing(f) : null, s = act?.go && f.field && standing(f.field) && !works.has(f.field) ? stOf(f.field) : null;
      if (!s) { rounds.delete(f.id); return null; }
      let r = rounds.get(f.id);
      if (!r || r.key !== s.key || r.go !== act.go) {
        const n = [...rounds.entries()].filter(([id, x]) => id !== f.id && x.key === s.key).length; // others at this bed already: it starts further on
        rounds.set(f.id, r = { key: s.key, go: act.go, i: (n * 3) % roundPoints(s, act.go).length, on: r?.key === s.key && r.on, dir: r?.dir ?? 1 });
      }
      return r;
    }
    /** The round a farmer is walking now (it has come to its bed), or null. */
    const tending = f => { const r = rounds.get(f.id); return r?.on && f.state === 'working' && !jobOf(f.id) ? r : null; };
    /** A farmer's sprite origin while it tends its bed: no walking bob; a pixel down on its tool's stroke. */
    const tendOrigin = (f, b) => { const prop = doing(f)?.prop; return [snap(Math.round(b.x) - 7 * SC), snap(Math.round(b.y) - 16 * SC + (TOOL_RATE[prop] && beat(PXG.T, TOOL_RATE[prop]) === 2 ? SC : 0))]; };

    /** A field's record (tallyOf), kept for the scene it is of. */
    const tallies = new Map();
    const fieldTally = key => { if (!tallies.has(key)) tallies.set(key, tallyOf(scene.farmers.filter(a => a.field === key && a.state !== 'leaving'))); return tallies.get(key); };
    /** A tool as a picture of its own (drawProp's, at rest): for the tool rack at a bed, and for a working farmer's name tag. */
    const propPics = new Map();
    function propPic(prop) {
      if (typeof document === 'undefined') return null;
      if (!propPics.has(prop)) {
        const c = document.createElement('canvas');
        c.width = 16; c.height = 20;
        const keep = { ctx: PXG.ctx, T: PXG.T, k: PXG.k }, g = c.getContext('2d');
        if (!g?.fillRect) return null;
        Object.assign(PXG, { ctx: g, T: 0.4, k: 1 });
        drawProp(prop, rpAt(-7, 3), 0.4);
        Object.assign(PXG, keep);
        propPics.set(prop, c);
      }
      return propPics.get(prop);
    }
    /** Where on a bed its marks go: `n` cells of its 4 × 9 (by the field's key and a number, so everyone sees the same), as [x, y] at the row's soil. */
    const cellsOf = (s, salt, n) => Array.from({ length: n }, (_, j) => { const c = pick(s.key, salt + j, 36); return [s.x0 + 4 + Math.floor(c / 4) * 8, s.y0 + 3 + (c % 4) * 8, c]; });
    /** The soil's marks, under the crops: where files were changed in the last four minutes it is dark and fresh, the newest darkest. */
    function drawFresh(s, tally, now) {
      for (const ev of tally.timeline) {
        const age = now - ev.at;
        if (age > 240_000 || !ev.ok || groupOf(ev.step)[0] !== 'make') continue;
        const [[x, y]] = cellsOf(s, Math.floor(ev.at / 1000), 1);
        PXG.ctx.globalAlpha = 0.6 * (1 - age / 240_000); px(x - 3, y - 1, 8, 3, '#2a1a0e'); PXG.ctx.globalAlpha = 1;
      }
    }
    /**
     * A field's record, on and about its bed: the slate in its corner (how many steps so far, in chalk, and under it their mix: a band
     * in the groups' colours; an hourglass while a turn runs), the last half hour along its front board (a tick a step, in its
     * group's colour, red when it failed: now is at the right), a pennant at its front left for the last test run (green, red; amber
     * and waving while tests run), thistles for steps failing in a row, and at its right the tools most used, leant on the frame.
     */
    function drawRecord(s, tally, now, T) {
      const { x0, y0 } = s;
      for (const ev of tally.timeline) { const x = x0 + 71 - Math.floor((now - ev.at) / 25_000); if (x >= x0 && x <= x0 + 71) px(x, y0 + 34, 1, 2, ev.ok ? groupOf(ev.step)[1] : '#e04a3a'); }
      if (tally.lastTest || tally.testing) {
        const c = tally.testing ? '#ffd43b' : tally.lastTest.ok ? '#2fa57a' : '#e04a3a', wave = tally.testing ? blink(4) : 0;
        px(x0 - 5, y0 + 23, 1, 14, '#6b4320'); px(x0 - 4, y0 + 23, 4 - wave, 1, c); px(x0 - 4, y0 + 24, 4, 1, c); px(x0 - 4, y0 + 25, 3 + wave, 1, c); px(x0 - 4, y0 + 26, 2, 1, shade(c, 0.75));
      }
      for (let i = 0; i < Math.min(4, tally.streak); i++) { const x = x0 + 24 + i * 7, y = y0 + 33; px(x, y - 5, 1, 5, '#4f7f2f'); px(x - 1, y - 3, 1, 1, '#4f7f2f'); px(x + 1, y - 2, 1, 1, '#4f7f2f'); px(x - 1, y - 7, 3, 2, '#b3478f'); px(x, y - 8, 1, 1, '#d98fc0'); } // thistles
      if (!tally.total) return;
      const sx = x0 + 55, sy = y0; // the slate: 17 × 12, leant in the bed's far right corner
      px(sx, sy, 17, 12, '#6b4320'); px(sx, sy, 17, 1, '#c98d4f'); px(sx + 1, sy + 1, 15, 10, '#27332f'); px(sx + 1, sy + 1, 15, 1, '#34443f');
      chalk(px, sx + 16, sy + 2, tally.total, '#f4f8fb');
      if (scene.farmers.some(a => a.field === s.key && a.state === 'working')) { const up = Math.floor(T * 1.5) % 2; px(sx + 2, sy + 2, 3, 1, '#e9c46a'); px(sx + 2, sy + 6, 3, 1, '#e9c46a'); px(sx + 3, sy + 4, 1, 1, '#e9c46a'); px(sx + 2, sy + 3, 3, 1, up ? '#f4d58d' : '#27332f'); px(sx + 2, sy + 5, 3, 1, up ? '#27332f' : '#f4d58d'); } // an hourglass: the turn runs
      let bx = sx + 1;
      for (const g of tally.groups) { const w = Math.round((g.n / tally.total) * 15); if (w) { px(bx, sy + 8, Math.min(w, sx + 16 - bx), 3, g.color); bx += w; } }
      const used = Object.entries(tally.steps).filter(([k]) => ACTIONS[k] && ACTIONS[k].prop !== 'can').sort((a, b) => b[1] - a[1]).slice(0, 2);
      used.forEach(([k], j) => { const pic = propPic(ACTIONS[k].prop); if (pic && PXG.ctx.drawImage) PXG.ctx.drawImage(pic, x0 + 72, y0 + 6 + j * 13, 16 * SC, 20 * SC); }); // the tool rack
    }

    function plotState(f) {
      const here = scene.farmers.filter(a => a.field === f.key), on = here.filter(a => ACTIVE.has(a.state));
      const crop = f.crop ?? 'wheat';
      if (on.length) { const p = Math.max(...on.map(a => a.pct)); return { kind: 'grow', crop, p, stage: growthStage(p), busy: on.some(a => a.state === 'working') }; }
      if (here.length && here.every(a => a.state === 'stale')) return { kind: 'dry', crop };
      return { kind: 'bare', crop };
    }
    function drawPlot(s) {
      const f = fieldByKey(s.key), { x0, y0 } = s, st = plotState(f), T = PXG.T, w = works.get(s.key);
      if (!standing(s.key)) return; // packed up and gone
      if (w && (w.on || w.kind === 'build')) { // being built or packed up: as much of its bed as stands (bedStanding), drawn as the whole bed is
        for (const box of bedStanding(bedLegs(s), w.i, w.t)) bed(clipTo(px, box), s, f.worktree ? '#9aa4ad' : f.fence ?? '#c98d4f', f.soil ?? '#7a5230', false);
        return;
      }
      bed(px, s, f.worktree ? '#9aa4ad' : f.fence ?? '#c98d4f', f.soil ?? '#7a5230', season === 'winter' && st.kind !== 'grow');
      const tally = fieldTally(s.key), now = Date.now();
      drawFresh(s, tally, now);
      // what was made and cleared here: a staked seedling for each new file (six at most), a stump for each deletion (four at most)
      const marks = new Map([...cellsOf(s, 200, Math.min(6, tally.steps.write ?? 0)).map(c => [c[2], 'stake']), ...cellsOf(s, 300, Math.min(4, tally.steps.delete ?? 0)).map(c => [c[2], 'stump'])]);
      for (let k = 0; k < 4; k++) for (let i = 0; i < 9; i++) {
        const x = x0 + 4 + i * 8, y = y0 + 3 + k * 8, mark = marks.get(i * 4 + k);
        if (tally.total && k < 2 && i > 6) continue; // the slate leans there
        if (mark === 'stump') { px(x - 1, y - 2, 3, 2, '#6b4320'); px(x - 1, y - 2, 3, 1, '#c98d4f'); px(x, y - 2, 1, 1, '#e2b07a'); continue; }
        if (mark === 'stake') { px(x + 3, y - 5, 1, 5, '#8b5a2b'); px(x + 2, y - 6, 3, 2, '#f4f8fb'); px(x + 3, y - 5, 1, 1, '#6cc04a'); }
        if (st.kind === 'bare') { // fallow: weeds
          if ((i * 5 + k * 3) % 7 === 0) { px(x, y - 2, 1, 2, '#4f7f2f'); px(x - 1, y - 1, 1, 1, '#4f7f2f'); px(x + 1, y - 1, 1, 1, '#4f7f2f'); }
          continue;
        }
        if (st.kind === 'dry') { px(x, y - 2, 1, 2, '#9c7a4a'); px(x + 1, y - 3, 1, 1, '#9c7a4a'); continue; }
        // a few plants run a stage behind, as in a real field
        const stage = Math.max(0, st.stage - (st.stage > 0 && (i * 7 + k * 3) % 5 === 0 ? 1 : 0));
        const sway = Math.round(Math.sin(T * 1.7 - x * 0.09 + k * 0.6) * (st.busy ? 1 : 0.8)); // the wind goes over the field in waves
        const top = drawCrop(st.crop, x, y, stage, sway);
        // ripe (context nearly full, ready to harvest): a sparkle now and then
        if (stage === 5 && (i * 7 + k * 3 + Math.floor(T * 3)) % 13 === 0) { px(x, top - 5, 1, 3, '#ffffff'); px(x - 1, top - 4, 3, 1, '#ffffff'); }
      }
      if (f.worktree) { // a worktree: a greenhouse beside its repo's bed, glazing bars and glints
        PXG.ctx.globalAlpha = 0.2; px(x0 - 2, y0 - 8, 77, 45, '#a9dcf7'); PXG.ctx.globalAlpha = 1;
        for (let x = x0 - 2; x <= x0 + 74; x += 12) px(x, y0 - 8, 1, 45, '#e6eef5');
        px(x0 - 2, y0 - 8, 77, 1, '#ffffff'); px(x0 - 2, y0 + 7, 77, 1, '#c3cbd2'); px(x0 - 3, y0 - 9, 79, 1, '#9aa4ad');
        PXG.ctx.globalAlpha = 0.55; for (let i = 0; i < 5; i++) px(x0 + 4 + i * 12, y0 - 6 + (i % 2) * 2, 4, 1, '#ffffff'); PXG.ctx.globalAlpha = 1;
      }
      drawRecord(s, tally, now, T);
      seedSign(f.crop ?? 'wheat', x0 - 8, y0 + 12); // what this field grows, even while it lies fallow
      if (f.pennant) { // a branch other than main: a pennant on the bed's corner
        const fx = x0 + 74, fy = y0 - 8, wave = blink(2);
        px(fx, fy, 1, 15, '#6b4320');
        for (let r = 0; r < 5; r++) px(fx + 1, fy + r, 5 - r - (r === 2 ? wave : 0), 1, r === 0 ? '#a9dcf7' : '#3d7be0');
      }
      if (f.collision) { // two farmers writing one repo: rope with orange flags (faster when a git command is involved)
        PXG.ctx.globalAlpha = 0.7 + 0.3 * Math.sin(T * (f.collision === 'high' ? 14 : 6));
        for (let i = 0; i < 76; i += 4) { const c = (i / 4) % 2 ? '#fff3d6' : '#ff8c42'; px(x0 - 2 + i, y0 - 3, 4, 1, c); px(x0 - 2 + i, y0 + 37, 4, 1, c); }
        for (let i = 0; i < 40; i += 4) { const c = (i / 4) % 2 ? '#fff3d6' : '#ff8c42'; px(x0 - 3, y0 - 3 + i, 1, 4, c); px(x0 + 74, y0 - 3 + i, 1, 4, c); }
        for (const [fx, fy] of [[x0 - 3, y0 - 8], [x0 + 74, y0 - 8]]) { px(fx, fy, 1, 6, '#6b4320'); px(fx + 1, fy, 4, 3, '#ff5a1f'); }
        PXG.ctx.globalAlpha = 1;
      }
    }
    // On each bed's top edge: mailbox = behind the remote, crates = unpushed commits, hay bales = uncommitted files.
    function drawPiles(s) {
      const f = fieldByKey(s.key), y = s.rowTop + 10, cx = s.cx;
      if (works.has(s.key) || ghosts.has(s.key)) return; // not while it is built or packed up
      if (f.behind > 0) { px(cx - 40, y - 9, 2, 11, '#6b4320'); px(cx - 44, y - 13, 9, 5, '#5f6b7a'); px(cx - 44, y - 13, 9, 1, '#9aa4ad'); px(cx - 35, y - 17, 1, 6, '#e04a3a'); px(cx - 35, y - 17, 3, 2, '#e04a3a'); }
      for (let i = 0; i < Math.min(4, Math.ceil(f.ahead / 4)); i++) { const x = cx - 30 + (i % 2) * 8, yy = y - 6 - Math.floor(i / 2) * 6; px(x, yy, 7, 6, '#8b5a2b'); px(x, yy, 7, 1, '#c98d4f'); px(x + 3, yy, 1, 6, '#6b4320'); px(x, yy + 6, 7, 1, '#4e3626'); }
      for (let i = 0; i < Math.min(4, Math.ceil(f.dirty / 3)); i++) { const x = cx + 12 + (i % 3) * 9, yy = y - 6 - Math.floor(i / 3) * 6; px(x, yy, 8, 6, '#e9c46a'); px(x, yy, 8, 1, '#f4d58d'); px(x + 2, yy, 1, 6, '#c9a24a'); px(x + 5, yy, 1, 6, '#c9a24a'); px(x, yy + 6, 8, 1, '#8a7140'); }
    }
    function seasonTip() {
      const w = scene.plan?.windows?.find(x => x.kind === 'five_hour');
      return `The season follows your plan's 5-hour limit${w ? `: ${w.reset ? 'just reset' : `${Math.round(w.percentUsed)}% used`}` : ' (no reading yet: summer)'}. Spring while it is fresh, then summer and autumn; winter when it is nearly used up`;
    }
    /* --- comings and goings: a field is built by the farmer it is for and packed up by the last to leave it; whoever leaves goes back into the farmhouse --- */
    const WORK_MAX_MS = 90_000, WORK_SPEED = 52, LEGS = bedLegs({ x0: 0, y0: 0 }).length;
    /** The work a farmer is on: [field key, work] (the first of its fields still to do), or undefined. */
    const jobOf = id => [...works].find(([, w]) => w.by === id);
    const isScare = f => f.state === 'stale' && !jobOf(f.id); // a scarecrow stands still; one packing its field up is a farmer a little longer
    const standing = key => !ghosts.has(key) || works.has(key); // a field packed up is gone, though the grid holds its bed till the next scene
    /** Where a work's farmer goes now: to the bed first (the near end of its leg), then along the leg. Building walks the legs forwards, packing backwards. */
    const workTarget = (w, legs) => { const leg = legs[w.i]; return (w.kind === 'build') === w.on ? leg.b : leg.a; };
    /**
     * The scene the farm acts out, from the one it is given. Told apart from the last one: a farmer that is gone walks
     * back into the farmhouse (a leaver, kept in the scene till it is in); a new field is built by the farmer it is for
     * (unless that one waits on you: then it just stands, and the farmer comes to you); a field that is gone is packed up
     * by the last to leave it (one whose session ended, or one gone stale) and kept till that is done. Nothing is acted
     * out for what is there when the page opens, nor with motion off.
     */
    function stage(next) {
      const now = Date.now();
      if (given && !frozen) {
        const had = new Map(given.farmers.map(f => [f.id, f])), has = new Map(next.farmers.map(f => [f.id, f]));
        const hadField = new Map(given.fields.map(f => [f.key, f])), hasField = new Set(next.fields.map(f => f.key));
        for (const [id, f] of had) if (!has.has(id) && !leavers.has(id) && onMap.has(id)) leavers.set(id, { ...f, state: 'leaving', question: null, ask: '', askKind: null, planAsk: false, nap: false, thinking: false, turn: null, tasks: null, kids: [], hot: false, jobs: 0, at: now, hold: [...hens.values()].some(h => h.by === id && h.phase !== 'home') ? now + 1500 : 0 });
        for (const id of has.keys()) leavers.delete(id); // back again: it turns round
        for (const fl of next.fields) {
          if (hadField.has(fl.key)) continue;
          const w = works.get(fl.key), mine = next.farmers.filter(f => f.field === fl.key && f.state !== 'waiting' && (!jobOf(f.id) || w?.by === f.id)), by = mine.find(f => f.id === w?.by) ?? mine.find(f => !had.has(f.id)) ?? mine[0];
          ghosts.delete(fl.key);
          if (!by) works.delete(fl.key); // nobody free for it: it just stands
          else if (w) Object.assign(w, { kind: 'build', on: w.on && w.by === by.id, by: by.id }); // it was being packed up: built again from where that had come
          else works.set(fl.key, { kind: 'build', by: by.id, on: false, i: 0, t: 0, at: now });
        }
        for (const [key, fl] of hadField) {
          if (hasField.has(key) || ghosts.has(key)) continue;
          const was = [...had.values()].filter(f => f.field === key), w = works.get(key), by = was.find(f => leavers.has(f.id) && f.id === w?.by) ?? was.find(f => leavers.has(f.id)) ?? was.map(f => has.get(f.id)).find(f => f?.state === 'stale' && onMap.has(f.id));
          if (!by) { works.delete(key); continue; } // nobody left to do it: it is just gone
          ghosts.set(key, fl);
          if (w) Object.assign(w, { kind: 'pack', on: w.on && w.by === by.id, by: by.id }); // not even built yet: packed up from where the building had come
          else works.set(key, { kind: 'pack', by: by.id, on: false, i: LEGS - 1, t: 1, at: now });
        }
      }
      for (const [key, w] of works) { // a work nobody can do any more is over: its farmer is gone, or needs you, or it has gone on too long
        const by = leavers.get(w.by) ?? next.farmers.find(f => f.id === w.by);
        if (!by || by.state === 'waiting' || now - w.at > WORK_MAX_MS) works.delete(key);
      }
      for (const key of [...ghosts.keys()]) if (!works.has(key)) ghosts.delete(key); // packed up: off the grid
      for (const [id, f] of leavers) if (f.gone || now - f.at > WORK_MAX_MS) leavers.delete(id);
      given = next;
      const keys = new Set(next.fields.map(f => f.key));
      return { ...next, fields: [...next.fields, ...[...ghosts.values()].filter(g => !keys.has(g.key))], farmers: [...next.farmers, ...leavers.values()] };
    }
    /** A work goes on with its farmer (b: where it is): to the bed, then leg by leg; true when its farmer has somewhere new to go. */
    function stepWork(key, w, b) {
      const s = stOf(key);
      if (!s || !b) return false;
      const legs = bedLegs(s), [tx, ty] = workTarget(w, legs), leg = legs[w.i];
      if (w.on) w.t = Math.max(0, Math.min(1, Math.hypot(b.x - leg.a[0], b.y - leg.a[1]) / (Math.hypot(leg.b[0] - leg.a[0], leg.b[1] - leg.a[1]) || 1)));
      if (b.path.length || Math.hypot(b.x - tx, b.y - ty) > 0.75) return false;
      if (!w.on) { w.on = true; return true; } // at the bed: to work
      w.i += w.kind === 'build' ? 1 : -1;
      w.t = w.kind === 'build' ? 0 : 1;
      if (w.i < 0 || w.i >= legs.length) { works.delete(key); const f = leavers.get(w.by); if (f && w.kind === 'pack') f.packed = true; } // done: the field stands, or is in its bag
      return true;
    }
    /** A leaver walks to the foot of the steps, then up and in at the door; true when it has somewhere new to go (or is in, and gone). */
    function stepLeaver(f, b) {
      if (!b || f.gone || jobOf(f.id) || b.path.length) return false;
      const [tx, ty] = f.inside ? [HOUSE_DOOR.x, HOUSE_DOOR.y1] : [HOUSE_DOOR.x, LANE];
      if (Math.hypot(b.x - tx, b.y - ty) > 0.75) return false;
      if (f.inside) f.gone = true; else f.inside = true;
      return true;
    }
    /** What a farmer at a work, or on its way home, carries: the field in a sack on its back (full before it builds and after it packs up), and its tool while at it. */
    function drawCarried(f, rp, T) {
      const [key, w] = jobOf(f.id) ?? [], full = w ? 1 - (w.i + w.t) / LEGS : f.packed ? 1 : 0, h = 4 + Math.round(4 * Math.max(0, Math.min(1, full)));
      rp(-1, 13 - h, 4, h, '#a8703c'); rp(-1, 13 - h, 4, 1, '#c98d4f'); rp(-1, 12, 4, 1, '#6b4320'); rp(3, 8, 1, 2, '#6b4320');
      if (full > 0.4) { rp(0, 12 - h, 1, 1, '#6cc04a'); rp(1, 11 - h, 1, 2, '#c98d4f'); } // a seedling and a plank stick out
      const part = w?.on && key ? bedLegs({ x0: 0, y0: 0 })[w.i]?.part : null;
      if (part) drawProp(part.startsWith('row') ? (w.kind === 'build' ? 'hoe' : 'sickle') : 'hammer', rp, T);
    }
    /* --- the hens: a subagent comes out of the henhouse when its farmer whistles, works beside it (or by itself on its field, in the background), and walks home to lay its egg --- */
    const subOf = id => (scene.subagents ?? []).find(s => s.id === id);
    const farmerOf = id => scene.farmers.find(f => f.id === id);
    /** Each hen's place among its farmer's (0, 1, 2…): the first four go along, the rest wait in the run. */
    function henOrder() {
      const n = new Map(), order = new Map();
      for (const h of hens.values()) if (h.phase !== 'home') { order.set(h.id, n.get(h.by) ?? 0); n.set(h.by, (n.get(h.by) ?? 0) + 1); }
      return order;
    }
    /**
     * Where a hen belongs now: 'run' (its farmer is not out on the farm, or leads four already), 'field' (in the
     * background: scratching on its farmer's field by itself, wherever the farmer is), or 'follow' (beside its farmer).
     */
    function henPlace(h, i, posOf, T) {
      const f = farmerOf(h.by), b = f && f.state !== 'leaving' ? posOf(h.by) : null;
      if (!b || i >= HENS_LED) return { want: 'run', at: runSpot(h.k) };
      const s = h.bg && f.field && standing(f.field) && !works.has(f.field) ? stOf(f.field) : null;
      if (s) return { want: `field:${f.field}`, at: [s.x0 + 9 + ((h.k * 3 + i * 2) % 8) * 8, s.y0 + 30 - (i % 2) * 8] };
      const at = [b.x + (i % 2 ? 1 : -1) * (11 + (i > 1 ? 7 : 0)), b.y + 2 - (i > 1 ? 5 : 0)];
      return { want: 'follow', at, near: h.dog ? [b.x + Math.cos(T * 0.9 + h.k) * 26, b.y + 4 + Math.sin(T * 1.8 + h.k) * 5] : at }; // the dog roams and sniffs round its farmer, once it is there
    }
    /** The scene's subagents, told apart from the hens there are: new ones come out, finished ones go home. What happened, for the diary. */
    function callHens(next) {
      const events = [], running = (next.subagents ?? []).filter(s => s.state === 'running'), ids = new Set(running.map(s => s.id));
      const called = new Map(), back = new Map(), note = (map, by, s) => map.set(by, [...(map.get(by) ?? []), s]);
      for (const s of running) {
        const h = hens.get(s.id);
        if (h) { if (h.phase === 'home') { h.phase = 'go'; h.want = null; h.failed = false; h.lays = false; } continue; } // called again on its way home: it turns round
        hens.set(s.id, { id: s.id, by: s.by, dog: s.type === 'Explore', codex: s.codex === true, bg: s.background === true, x: COOP.door[0], y: COOP.door[1], path: [], phase: 'go', want: null, tx: 0, ty: 0, wait: 0, k: henSeq++, failed: false, lays: false, fresh: true, instant: !henReady || frozen });
        if (henReady && !frozen) { hens.get(s.id).delay = 0.55 * [...called.values()].flat().length; note(called, s.by, s); whistled.set(s.by, PXG.T); } // one after the other down the ramp
      }
      for (const h of hens.values()) {
        if (ids.has(h.id) || h.phase === 'home') continue;
        const s = (next.subagents ?? []).find(x => x.id === h.id);
        Object.assign(h, { phase: 'home', want: null, wait: 0, failed: s?.state === 'failed', lays: s?.state === 'done', fresh: false });
        h.path = henRoute([h.x, h.y], 'door', { spot: runSpot(h.k), peck: !h.failed && !h.dog });
        if (s && henReady && !frozen) note(back, h.by, { ...s, dog: h.dog });
      }
      const of = list => (list.every(s => s.type === 'Explore') ? ['the dog', 'dogs'] : ['a hen', 'hens']);
      for (const [by, list] of called) events.push({ id: by, by: 'The henhouse', log: list.length > 1 ? `whistles for ${list.length} ${of(list)[1]}` : `whistles for ${of(list)[0]}${list[0].label ? `: ${clip(list[0].label, 50)}` : ''}` });
      for (const [by, list] of back) {
        const bad = list.filter(s => s.state === 'failed'), good = list.filter(s => s.state === 'done');
        if (good.length) events.push({ id: by, by: 'The henhouse', log: good.length > 1 ? `${good.length} of its ${of(good)[1]} head home, each with ${good[0].dog ? 'a bone' : 'an egg to lay'}` : `its ${good[0].dog ? 'dog trots home with a bone' : 'hen heads home to lay an egg'}${good[0].result || good[0].label ? `: ${clip(good[0].result || good[0].label, 60)}` : ''}` });
        if (bad.length) events.push({ id: by, by: 'The henhouse', log: bad.length > 1 ? `${bad.length} of its ${of(bad)[1]} flutter home: they failed` : `its ${bad[0].dog ? 'dog slinks' : 'hen flutters'} home: it failed${bad[0].label ? ` (${clip(bad[0].label, 50)})` : ''}` });
      }
      henReady = true;
      return events;
    }
    /** The hens go on: each walks its way, then keeps to its place; one home is in (its egg laid). True when the henhouse has news for its labels. */
    function stepHens(dt, posOf, snap) {
      const T = PXG.T, order = henOrder();
      let news = henNews;
      henNews = false;
      for (const h of [...hens.values()]) {
        if (h.phase === 'home') {
          if (snap || h.instant || (!h.path.length && h.wait <= 0)) { hens.delete(h.id); news = true; continue; }
        } else {
          const place = henPlace(h, order.get(h.id) ?? 0, posOf, T), [px0, py0] = place.at, far = Math.hypot(px0 - h.x, py0 - h.y);
          if (snap || h.instant) { Object.assign(h, { x: px0, y: py0, path: [], phase: 'at', want: place.want, tx: px0, ty: py0, instant: false, fresh: false, wait: 0 }); continue; }
          if (h.delay > 0) { h.delay -= dt; continue; } // its turn at the hatch is not yet
          const moved = Math.hypot(px0 - h.tx, py0 - h.ty);
          if (h.want !== place.want || (h.phase === 'go' ? moved > 14 : place.want === 'follow' && far > (h.dog ? 70 : 40))) { // a new place, or its farmer has gone on: on its way
            Object.assign(h, { phase: 'go', want: place.want, tx: px0, ty: py0, wait: 0, path: place.want === 'run' ? henRoute([h.x, h.y], 'run', { spot: place.at }) : henRoute([h.x, h.y], place.at) });
            if (h.fresh) { h.fresh = false; news = true; }
          } else if (h.phase === 'at' && place.want === 'follow') { // beside its farmer, as it moves
            const [nx, ny] = place.near, e = Math.min(1, dt * (h.dog ? 1.6 : 4)), d = Math.hypot(nx - h.x, ny - h.y);
            h.moving = d > 1.5;
            if (Math.abs(nx - h.x) > 0.6) h.face = nx > h.x ? 1 : -1;
            h.x += (nx - h.x) * e; h.y += (ny - h.y) * e;
            continue;
          }
          else if (h.phase === 'at') { h.moving = false; continue; }
        }
        if (h.wait > 0) { h.wait -= dt; h.moving = false; continue; }
        const next = h.path[0];
        if (!next) { if (h.phase === 'go') h.phase = 'at'; h.moving = false; continue; }
        const dx = next[0] - h.x, dy = next[1] - h.y, d = Math.hypot(dx, dy), sp = HEN_SPEED * (h.dog ? 1.3 : 1) * (h.failed ? 1.7 : 1) * dt;
        if (Math.abs(dx) > 0.3) h.face = dx > 0 ? 1 : -1;
        h.moving = true;
        if (d <= sp) { h.x = next[0]; h.y = next[1]; h.path.shift(); if (next[2]) h.wait = next[2]; } else { h.x += (dx / d) * sp; h.y += (dy / d) * sp; }
      }
      return news;
    }
    /** What lies in the nest: the subagents done within the hour whose hens are in again, the newest first (six at most). */
    const NEST = { egg: i => 2 + i * 3, bone: i => 30 + (i % 2) * 9 }; // an egg's place in the nest, a bone's on the grass by the ramp (by its number among what lies there)
    const eggsOf = () => (scene.subagents ?? []).filter(s => s.state === 'done' && !hens.has(s.id)).sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0)).slice(0, 6);
    const henText = s => [s.type && s.type !== 'subagent' ? s.type : s.codex ? 'Codex subagent' : 'subagent', s.label].filter(Boolean).join(' · ');
    /** The henhouse, each frame: its hatch (open while a hen is in the doorway), the nest and its eggs, and every hen where it is. */
    function drawHens(T) {
      const eggs = eggsOf();
      px(1, 132, 19, 3, '#c9a24a'); px(1, 132, 19, 1, '#e9c46a'); px(0, 130, 1, 5, '#a8703c'); px(20, 130, 1, 5, '#a8703c'); // the nest
      eggs.forEach((s, i) => (s.type === 'Explore' ? drawEgg(px, NEST.bone(i), 137, true) : drawEgg(px, NEST.egg(i), 128, false)));
      const all = [...hens.values()].sort((a, b) => a.y - b.y);
      if (all.some(h => (h.path.length || h.phase === 'home') && Math.abs(h.x - COOP.door[0]) < 5 && h.y < COOP.foot[1])) coopAt = T;
      if (T - coopAt < 0.7) { px(20, 114, 8, 2, '#6b4320'); px(20, 115, 8, 1, '#8b5a2b'); } // the hatch, swung up
      else { px(20, 117, 8, 12, '#8b5a2b'); px(20, 117, 8, 1, '#c98d4f'); px(23, 117, 1, 12, '#6b4320'); px(26, 123, 1, 1, '#e9c46a'); } // shut
      for (const h of all) {
        if (h.fresh && !h.path.length) continue; // still inside: not called out yet
        const f = farmerOf(h.by), pose = h.wait > 0 ? 'peck' : h.moving ? (h.failed ? 'flutter' : 'walk') : h.phase === 'at' && h.want !== 'follow' ? 'peck' : 'stand';
        const x = Math.round(h.x + (h.phase === 'at' && h.want === 'run' ? Math.sin(T * 0.6 + h.k * 2) * 3 : 0)), y = Math.round(h.y), face = h.face ?? 1;
        px(x - 3, y, 6, 1, 'rgba(28,51,32,.45)');
        if (h.dog && typeof CREATURES === 'object') { const dp = creaturePainter(x, y, face); CREATURES.dog.draw(dp, h.moving ? (h.failed ? 'run' : 'walk') : 'stand', T); dp(1, -6, 2, 1, f?.shirt ?? '#e04a3a'); }
        else drawHen(creaturePainter(x, y, face), pose, T, { codex: h.codex, scarf: f?.shirt ?? '#e04a3a' });
      }
    }
    const SILO_X = [92, 10], SILO_Y = 6; // the silo by the barn; a second one left of the barn, when both Claude Code and Codex run here
    /**
     * The silos standing now: [{ who: 'claude' | 'codex', name, x, plan, ...siloOf(plan) }]. One plan: it has the silo by the
     * barn (its dome in its colour). Both: Claude's is by the barn, Codex's left of it. None: the silo by the barn stands empty.
     */
    const silos = () => [['claude', 'Claude', scene.plan], ['codex', 'Codex', scene.codexPlan]].filter(([, , plan]) => siloOf(plan))
      .map(([who, name, plan], i) => ({ who, name, x: SILO_X[i], plan, ...siloOf(plan) }));
    /* --- the porch: its seats, whoever sits in them and what they are at (porch life, above, says who and what) --- */
    /** The porch album, for the farmhouse's dialog: how much of what the porch can show was seen in this browser, by name; the rest stays a surprise. */
    const albumHtml = () => { const all = Object.keys(ALBUM), got = all.filter(k => album.has(k)); return `<p class="muted"><b>Porch album:</b> ${got.length} of ${all.length} seen${got.length ? `: ${esc(got.map(k => ALBUM[k]).join(' · '))}` : ''}${got.length < all.length ? `. ${all.length - got.length} still to find` : '. All of it!'}</p>`; };
    const SEAT_UP = 2; // a seated farmer sits this much higher, so its seat's front shows below its feet
    const isSat = p => p?.zone === 'turn' && p.stage !== 'stand';
    const ARMS_UP = { stretch: 2, tip: 2, cheers: 1 }, HOLDS_DRINK = new Set(['sip', 'spill', 'cheers']);
    /** What a seated farmer is at just now: its part in a surprise, a toast to a merge, or its own pastime. */
    const doingOnPorch = (f, p) => (porch.surprise?.who.includes(f.id) ? porch.surprise.key : Date.now() < cheerUntil ? 'cheers' : p.pastime);
    /** How far a seat rocks sideways just now (px): a rocker and the swing, under whoever sits there; all in time in a 'sync'; a rocker tipping back. */
    function swayOf(seat) {
      const sitter = [...porch.who].find(([, p]) => isSat(p) && p.seat === seat)?.[0], sur = porch.surprise, kind = porch.seating[seat];
      if (!sitter) return 0;
      if (sur?.key === 'sync') return Math.round(Math.sin(PXG.T * 3) * 2);
      if (sur?.key === 'tip' && sur.who.includes(sitter)) return -Math.round(Math.sin(sur.t * Math.PI) * 3);
      return kind === 'rocker' ? Math.round(Math.sin(PXG.T * 2 + seat)) : kind === 'swing' ? Math.round(Math.sin(PXG.T * 1.4)) : 0;
    }
    // Each seat from x0 to x1 on the boards at y: its back behind whoever sits there, its front below their feet. dx: how far it rocks.
    const SEATS = {
      rocker(x0, x1, y, dx) { const w = x1 - x0; px(x0 + dx, y - 16, w, 13, '#8b5a2b'); px(x0 + dx, y - 16, w, 1, '#c98d4f'); for (let x = x0 + 2; x < x1 - 1; x += 3) px(x + dx, y - 14, 1, 10, '#6b4320'); px(x0 - 1 + dx, y - 2, w + 2, 2, '#c98d4f'); px(x0 - 1, y, w + 2, 1, '#4e3626'); px(x0 - 2, y - 1, 1, 1, '#4e3626'); px(x1 + 1, y - 1, 1, 1, '#4e3626'); },
      bench(x0, x1, y) { const w = x1 - x0; px(x0, y - 15, w, 12, '#a8703c'); px(x0, y - 15, w, 1, '#c98d4f'); for (const yy of [y - 12, y - 9, y - 6]) px(x0, yy, w, 1, '#6b4320'); px(x0 - 1, y - 2, w + 2, 2, '#c98d4f'); for (const x of [x0, x0 + (w >> 1), x1 - 1]) px(x, y, 1, 1, '#4e3626'); },
      swing(x0, x1, y, dx) { const w = x1 - x0; for (const x of [x0, x1 - 1]) for (let yy = 41; yy < y - 14; yy += 2) px(x + Math.round((dx * (yy - 41)) / (y - 55)), yy, 1, 1, '#9aa4ad'); px(x0 + dx, y - 15, w, 11, '#e8dcc4'); px(x0 + dx, y - 15, w, 1, '#ffffff'); for (let x = x0 + 3; x < x1 - 3; x += 5) px(x + dx, y - 13, 3, 7, '#5ab4ff'); px(x0 - 1 + dx, y - 3, w + 2, 2, '#c98d4f'); PXG.ctx.globalAlpha = 0.25; px(x0 + 1, y, w - 2, 1, '#1b1420'); PXG.ctx.globalAlpha = 1; },
      bale(x0, x1, y) { const w = x1 - x0; px(x0, y - 7, w, 8, '#e9c46a'); px(x0, y - 7, w, 1, '#f4d58d'); px(x0, y, w, 1, '#8a7140'); for (const x of [x0 + 4, x1 - 5]) px(x, y - 7, 1, 8, '#c9a24a'); for (let x = x0 + 1; x < x1 - 2; x += 3) px(x, y - 2 - (x % 2), 2, 1, '#c9a24a'); },
      crate(x0, x1, y) { const w = x1 - x0 - 2; px(x0 + 1, y - 7, w, 8, '#8b5a2b'); px(x0 + 1, y - 7, w, 1, '#c98d4f'); px(x0 + 1, y - 3, w, 1, '#6b4320'); px(x0 + 1, y, w, 1, '#4e3626'); px(x0 + (w >> 1), y - 2, 3, 2, '#e04a3a'); px(x0 + (w >> 1) + 1, y - 3, 1, 1, '#3f9b3a'); },
    };
    /**
     * The front door, open, and the hall behind it: papered wall, a picture, a hat on its hook, a lamp, floorboards and a
     * runner; the door swung in against its left post. By night the lamp is lit and its light falls out onto the porch.
     */
    function openDoor() {
      const { x0, y0, x1, y1 } = HOUSE_DOOR, w = x1 - x0, lit = night;
      px(x0, y0, w, 12, lit ? '#f4d58d' : '#d9c9a0'); for (let x = x0 + 3; x < x1; x += 3) px(x, y0, 1, 12, lit ? '#e9c46a' : '#cbb98a'); // the wall, its paper in stripes
      px(x0, y0 + 9, w, 3, lit ? '#b98a4a' : '#9c7a4a'); px(x0, y0 + 9, w, 1, '#6b4320'); // the wainscot
      px(x0 + 8, y0 + 2, 4, 4, '#6b4320'); px(x0 + 9, y0 + 3, 2, 2, '#5ab4ff'); px(x0 + 9, y0 + 4, 2, 1, '#6cc04a'); // a picture
      px(x0 + 3, y0 + 3, 3, 1, '#6b4320'); px(x0 + 3, y0 + 4, 3, 2, '#e9c46a'); px(x0 + 2, y0 + 6, 5, 1, '#c9a24a'); // a straw hat on its hook
      px(x0 + 12, y0 + 1, 1, 3, '#6b4320'); px(x0 + 11, y0 + 4, 3, 2, lit ? '#fff3a6' : '#e8dcc4'); // a lamp
      px(x0, y0 + 12, w, y1 - y0 - 12, '#a8703c'); for (let x = x0 + 2; x < x1; x += 4) px(x, y0 + 12, 1, y1 - y0 - 12, '#8b5a2b'); // floorboards
      px(x0 + 4, y0 + 13, 6, y1 - y0 - 13, '#9c3b30'); px(x0 + 4, y0 + 13, 6, 1, '#c8584c'); // a runner
      px(x0, y0, 2, y1 - y0, '#8b5a2b'); px(x0 + 2, y0, 1, y1 - y0, '#6b4320'); // the door, swung in
      if (lit) PXG.lights?.push([HOUSE_DOOR.x, y0 + 10, 15, null]);
    }
    /** The porch cat's moment: it makes way for anyone at the door or the mat, waits at the corner, and comes back when it has been quiet for 4 s. */
    /** Is the cat curled up on its mat (then a lap may borrow it)? */
    const catOnMat = () => cat.where === 'ground' && !cat.jump && !cat.legs.length && cat.plan.spot === 'mat' && cat.plan.act === 'nap' && cat.goal === 'mat';
    /**
     * The porch cat's moment: it goes where the clock has it (catPlan), by the steps and the lane (catLegs). When a farmer walks up to
     * it, it runs: by day onto the roof (by the lane and the stall's awning, outside the house), by night, or with the farmer in its way,
     * to the far end of the lane. It stays there for 20 to 80 s; and for 2 to 6 minutes more it keeps off its mat and the steps (it goes
     * indoors, or elsewhere). When the page opens it is where it belongs at once.
     */
    function stepCat(T) {
      const dt = Math.max(0, Math.min(0.1, T - cat.at)), now = Date.now();
      cat.at = T;
      cat.plan = catPlan(now, { night });
      if (!cat.placed) { // the page opens: there at once
        const spot = cat.plan.spot;
        Object.assign(cat, { placed: true, goal: spot, where: spot === 'roof' ? 'roof' : spot === 'in' ? 'in' : 'ground', x: CAT[spot][0], y: CAT[spot][1], legs: [], jump: null });
      }
      const near = cat.where === 'ground' && !cat.jump ? walkers.find(([wx, wy]) => Math.abs(wx - cat.x) < 14 && Math.abs(wy - cat.y) < 12) : null;
      walkers.length = 0;
      if (near && !(cat.run && cat.legs.length)) { // someone wants to pass: off it runs, away from them
        const sec = Math.floor(now / 1000), right = near[0] > cat.x + 2 && cat.y > 80; // on the lane, and they come from the right: the way to the roof is theirs
        cat.refuge = night ? (near[0] > cat.x ? 'farL' : 'farR') : right ? 'farL' : 'roof';
        cat.stayUntil = now + (20 + pick('porch-cat-stay', sec, 60)) * 1000;
        cat.shooedUntil = cat.stayUntil + (120 + pick('porch-cat-off', sec, 240)) * 1000;
        cat.goal = null;
      }
      const shy = now < (cat.shooedUntil ?? 0) && (cat.plan.spot === 'mat' || cat.plan.spot === 'step'); // not back to where it was sent from so soon
      const goal = now < (cat.stayUntil ?? 0) ? cat.refuge : shy ? (night ? 'in' : ['in', 'roof', 'laneL'][pick('porch-cat-else', catStretch(now).seed, 3)]) : cat.plan.spot;
      cat.run = now < (cat.stayUntil ?? 0);
      if (goal !== cat.goal && !cat.jump) { cat.goal = goal; cat.legs = catLegs(cat, goal); }
      if (cat.jump) { // a leap: it crouches, goes up beside what it leaps onto, and lands low
        const J = cat.jump, k = Math.min(1, (T - J.t0) / J.s), at = catLeap(J.from, J.to, k);
        Object.assign(cat, { x: at.x, y: at.y, pose: at.pose });
        if (Math.abs(J.to[0] - J.from[0]) > 0.5) cat.face = J.to[0] > J.from[0] ? 1 : -1;
        if (k >= 1) { Object.assign(cat, { where: J.where, x: J.to[0], y: J.to[1], jump: null, pose: null }); if (cat.goal !== goal) { cat.goal = goal; cat.legs = catLegs(cat, goal); } }
        return;
      }
      const leg = cat.legs[0];
      if (!leg) return;
      if (leg.jump) { cat.jump = { from: [cat.x, cat.y], to: leg.jump, where: leg.where, t0: T, s: 0.35 + Math.hypot(leg.jump[0] - cat.x, leg.jump[1] - cat.y) / 100 }; cat.legs.shift(); return; }
      if (leg.out) { Object.assign(cat, { where: 'ground', x: CAT.in[0], y: CAT.in[1] }); cat.legs.shift(); doorAt = T; return; }
      if (cat.where === 'ground' && (leg.in || cat.y < CAT.mat[1] - 0.5)) doorAt = T; // in the doorway: the door stands open for it
      const [tx, ty] = leg.to, dx = tx - cat.x, dy = ty - cat.y, d = Math.hypot(dx, dy), sp = (cat.run && cat.where === 'ground' ? 58 : 17) * dt;
      if (Math.abs(dx) > 0.3) cat.face = dx > 0 ? 1 : -1;
      if (d <= sp) { cat.x = tx; cat.y = ty; cat.legs.shift(); if (leg.in) cat.where = 'in'; } else { cat.x += (dx / d) * sp; cat.y += (dy / d) * sp; }
    }
    /** The porch cat, where it is: curled up on its mat (unless a lap has it), or at whatever it is at. Nothing lights it at night but the porch lamp, and its eyes shine. */
    function drawCat(T, onLap) {
      if (cat.where === 'in' && !cat.legs.length) return; // indoors
      const walking = !cat.jump && cat.legs.length > 0, hiding = Date.now() < (cat.stayUntil ?? 0), eye = night ? '#ffd43b' : '#1b1420';
      if (catOnMat()) { if (!onLap) porchCat(CAT.mat[0] - 4, CAT.mat[1] - 3, blink(0.7), true); return; }
      const there = cat.goal === cat.plan.spot && !hiding; // where the clock has it: at what the clock has it do
      const act = cat.jump ? cat.pose ?? 'crouch' : walking ? (cat.run && cat.where === 'ground' ? 'run' : 'walk') : !there ? 'watch' : cat.where === 'roof' ? (cat.plan.act === 'nap' ? 'loaf' : cat.plan.act ?? 'watch') : cat.plan.act === 'nap' ? 'sit' : cat.plan.act ?? 'sit';
      const hop = act === 'play' ? Math.abs(Math.sin(T * 5)) : 0, x = Math.round(cat.x + (act === 'play' ? Math.sin(T * 1.7) * 5 : 0)), y = Math.round(cat.y - hop * 3);
      const face = act === 'play' ? (Math.cos(T * 1.7) > 0 ? 1 : -1) : cat.face;
      const inDoor = cat.where === 'ground' && cat.y < CAT.mat[1] - 0.5 && Math.abs(cat.x - HOUSE_DOOR.x) < 4, p = inDoor ? clipPainter(x, y, face, HOUSE_DOOR) : creaturePainter(x, y, face);
      if (cat.where === 'ground' && !cat.jump) px(x - 4, y, 8, 1, 'rgba(27,20,32,.3)');
      if (act === 'walk' || act === 'run' || act === 'play') CREATURES.cat.draw(p, act === 'run' || (act === 'play' && hop > 0.5) ? 'run' : 'walk', T, 'ginger');
      else drawPorchCat(p, act, T, eye);
    }
    function porchCat(x, y, flick, home) {
      px(x, y, 7, 3, '#e9a23b'); px(x + 1, y - 1, 5, 1, '#e9a23b'); px(x + 6, y - 2, 3, 3, '#e9a23b'); px(x + 6, y - 3, 1, 1, '#c8681a'); px(x + 8, y - 3, 1, 1, '#c8681a'); px(x + 7, y - 1, 1, 1, '#1b1420');
      px(x - 1, y + 1 - flick, 1, 2, '#c8681a'); px(x + 2, y, 1, 3, '#c8681a'); if (home) px(x, y + 3, 8, 1, '#4e6b3a');
    }
    // What a seated farmer is at, drawn over it (rp: its own pixels; its bubble is top right, so things go left or in its lap).
    const SITTING = {
      rest() {}, stretch() {}, // its arms are the sprite's
      doze: (rp, T) => zzz(rp, T, -3),
      read(rp, T) { rp(3, 9, 8, 5, '#f4ecd8'); rp(3, 9, 8, 1, '#c9c2ae'); rp(7, 9, 1, 5, '#c9c2ae'); rp(4, 11, 2, 1, '#9aa4ad'); rp(8, 11, 2, 1, '#9aa4ad'); rp(4, 12, 2, 1, '#9aa4ad'); if (Math.floor(T) % 6 === 0) rp(10, 9, 1, 5, '#ffffff'); }, // a page turned now and then
      whittle(rp, T) { rp(8, 11, 5, 1, '#c98d4f'); rp(7, 10, 1, 2, '#c3cbd2'); for (let k = 0; k < 2; k++) rp(10 + k * 2, 12 + (Math.floor(T * 4 + k * 2) % 4), 1, 1, '#e9c46a'); },
      knit(rp, T, { ball = true } = {}) { const k = blink(3); rp(5 - k, 9, 1, 3, '#c3cbd2'); rp(8 + k, 9, 1, 3, '#c3cbd2'); rp(5, 11, 4, 3, '#d55181'); rp(5, 12, 4, 1, '#e58aa8'); if (ball) { rp(-3, 13, 3, 3, '#d55181'); rp(-2, 13, 1, 1, '#e58aa8'); rp(0, 13, 5, 1, '#d55181'); } },
      harmonica(rp, T) { rp(5, 8, 4, 1, '#c3cbd2'); rp(5, 8, 1, 1, '#8a93a0'); notes(rp, T); },
      watch(rp) { rp(9, 10, 3, 3, '#ffd43b'); rp(10, 11, 1, 1, '#ffffff'); rp(6, 12, 3, 1, '#c9a24a'); },
      sip(rp, T, { drink }) { drink(8, blink(0.5) ? 10 : 7); }, // to its mouth and back to its lap
      // its part in a surprise
      lapcat(rp) { if (!catOnMat()) return; porchCat(rp.ox + 3 * SC, rp.oy + 11 * SC, blink(0.7), false); rp(-3, 4, 1, 1, '#ff7eb6'); rp(-1, 4, 1, 1, '#ff7eb6'); rp(-3, 5, 3, 1, '#ff7eb6'); rp(-2, 6, 1, 1, '#ff7eb6'); },
      sync: (rp, T) => notes(rp, T),
      duet: (rp, T) => SITTING.harmonica(rp, T),
      spill(rp, T, { t }) { rp(10, 12, 3, 2, '#f4ecd8'); rp(9, 15 + SEAT_UP, Math.round(2 + t * 4), 1, '#6b4320'); rp(1, 4, 1, 2, '#a9dcf7'); },
      yarn: (rp, T) => SITTING.knit(rp, T, { ball: false }), // the mouse has it (drawPorch)
      tip(rp) { rp(1, 4, 1, 2, '#a9dcf7'); },
      cheers(rp, T, { drink }) { drink(11, 0); rp(14, -2 - blink(4), 1, 1, '#ffffff'); },
    };
    /** A seated farmer's own things, over it: a blanket and a drink once it has settled in, and what it is at just now. */
    function drawSitter(f, p, rp, T) {
      const rank = stageRank('turn', p.stage), at = doingOnPorch(f, p);
      const drink = (x, y) => { // a mug that steams; a glass of lemonade in summer
        saw('drink');
        if (season === 'summer') { rp(x, y, 2, 3, '#ffd43b'); rp(x, y, 2, 1, '#fff3a6'); } else { rp(x, y, 2, 2, '#f4ecd8'); rp(x + 2, y, 1, 1, '#f4ecd8'); rp(x + blink(2), y - 2 - blink(2), 1, 1, '#e6eef5'); }
      };
      saw(at);
      if (rank >= 4 || (rank >= 1 && season === 'winter')) { saw('blanket'); rp(2, 11, 10, 4, '#b23a2e'); rp(2, 12, 10, 1, '#e9c46a'); for (const x of [4, 8]) rp(x, 11, 1, 4, '#7a2a22'); } // over its knees: after three hours, or at once in winter
      (SITTING[at] ?? SITTING.rest)(rp, T, { t: porch.surprise?.t ?? 0, drink });
      if (rank >= 2 && !HOLDS_DRINK.has(at)) drink(-2, 10); // set down on the arm of its seat
    }
    /** The porch's own things, under its farmers: today's seats, the porch cat on the door mat, the season's, and what a surprise brings. */
    function drawPorch(T) {
      const { seating, surprise: sur, who } = porchOf(), X = PORCH_SPOTS.turn, y = PORCH_Y, double = k => k === 'bench' || k === 'swing';
      for (let i = 0; i < seating.length; i++) {
        const kind = seating[i], pair = double(kind) && seating[i + 1] === kind;
        if (double(kind) && seating[i - 1] === kind) continue; // drawn with the one before
        saw(kind);
        SEATS[kind](X[i] - 8, X[pair ? i + 1 : i] + 8, y, swayOf(i) || (pair ? swayOf(i + 1) : 0));
      }
      if (T - doorAt < 0.8) openDoor(); // someone is coming out: it closes behind them
      stepCat(T);
      if (typeof CREATURES === 'object') drawCat(T, sur?.key === 'lapcat'); // on its mat unless a lap has it
      const seasonal = seasonalOf(Date.now());
      if (seasonal === 'pumpkin') { // on the steps in October; lit on the 31st
        const px0 = 203, py = y + 5;
        saw('pumpkin');
        px(px0, py - 5, 6, 5, '#f08a24'); px(px0, py - 5, 6, 1, '#ffb347'); px(px0 + 2, py - 6, 1, 1, '#3f9b3a'); px(px0 + 2, py - 4, 1, 4, '#c8681a');
        if (new Date().getDate() === 31) { px(px0 + 1, py - 3, 1, 1, '#ffd43b'); px(px0 + 4, py - 3, 1, 1, '#ffd43b'); px(px0 + 1, py - 1, 4, 1, '#ffd43b'); }
      }
      if (seasonal === 'lights') { saw('lights'); for (let x = 134, i = 0; x < 268; x += 5, i++) px(x, 41 + (i % 2), 1, 1, ['#e04a3a', '#ffd43b', '#6cc04a', '#5ab4ff'][(i + blink(1.5, 4)) % 4]); } // along the eaves in December
      if (sur?.key === 'peek' && typeof CREATURES === 'object') { // your front door opens and the unicorn looks out (the door: name tags never cover it)
        saw('peek');
        openDoor();
        CREATURES.unicorn.draw(clipPainter(199, Math.round(78 - 12 * Math.min(1, sur.t * 5, (1 - sur.t) * 5)), 1, HOUSE_DOOR), 'stand', T);
      }
      if (sur?.key === 'yarn' && typeof CREATURES === 'object') { // a mouse makes off with the knitter's ball, the thread behind it
        const from = X[who.get(sur.who[0])?.seat ?? 0] - 10, mx = Math.round(from - sur.t * (from - 130));
        px(mx, y - 1, from - mx, 1, '#d55181'); px(mx - 3, y - 3, 3, 3, '#d55181');
        CREATURES.mouse.draw(creaturePainter(mx, y, -1), 'run', T);
      }
    }
    /** The silo's grain and lamp, the pond's ripples and duck, the henhouse's eggs and hens: each frame. */
    function drawScenery() {
      const T = PXG.T;
      for (const s of silos()) {
        const X = s.x, h = Math.round(46 * s.fill);
        if (s.who !== 'claude' || X !== SILO_X[0]) { // any but Claude's by the barn (that one is part of the land)
          silo(px, X, SILO_Y, SEASONS[season] ?? SEASONS.summer, DOMES[s.who]);
          if (X === SILO_X[0]) noticeBoard(px, BOARD.x, BOARD.y, SEASONS[season] ?? SEASONS.summer); // the notice board stands before the silo by the barn: drawn again after it
        }
        if (h) { px(X + 7, 73 - h, 6, h, '#e9c46a'); px(X + 7, 73 - h, 6, 1, '#f4d58d'); }
        for (const t of [0.25, 0.5, 0.75]) px(X + 13, 73 - Math.round(46 * t), 1, 1, '#c3cbd2');
        if (s.lamp && (s.lamp === 'amber' || blink(2))) { px(X + 8, 3, 4, 3, s.lamp === 'red' ? '#e04a3a' : '#f0b429'); PXG.lights?.push([X + 10, 6, 8, [X + 8, 3, 4, 3]]); }
      }
      if (season !== 'winter') { // ripples, and a duck paddling round the pond
        for (let i = 0; i < 2; i++) { const ph = (T * 0.5 + i * 0.5) % 1, r = Math.round(ph * 6); PXG.ctx.globalAlpha = 0.6 * (1 - ph); px(30 - r, 208 + i * 5, r * 2 + 1, 1, '#a9dcf7'); }
        PXG.ctx.globalAlpha = 1;
        if (!PXG.animals) { // with the animals on, the duck family lives here instead (FARM_ANIMALS)
          const dx = Math.round(42 + Math.sin(T * 0.25) * 16), face = Math.cos(T * 0.25) > 0 ? 1 : -1, dy = 206;
          px(dx - 1, dy + 3, 7, 1, '#2c4a85'); px(dx, dy, 5, 3, '#ffffff'); px(dx + (face > 0 ? 3 : -1), dy - 2, 3, 3, '#ffffff'); px(dx + (face > 0 ? 6 : -2), dy - 1, 2, 1, '#f08a24'); px(dx + (face > 0 ? 4 : 0), dy - 1, 1, 1, '#1b1420');
        }
      } else if (blink(1.5)) px(36, 206, 2, 1, '#ffffff'); // ice glints
      if (PXG.animals) { // the animals' things in the yard: a trough and its bucket, a woodpile and a rock to climb
        px(TROUGH.x - 6, TROUGH.y - 3, 12, 3, '#8b5a2b'); px(TROUGH.x - 5, TROUGH.y - 3, 10, 1, season === 'winter' ? '#d8eef8' : '#5ab4ff');
        if (!PXG.taken?.has('bucket')) { px(TROUGH.x + 8, TROUGH.y - 4, 3, 4, '#8a93a0'); px(TROUGH.x + 8, TROUGH.y - 4, 3, 1, '#c3cbd2'); } // unless the ostrich is wearing it
        for (let i = 0; i < 3; i++) px(WOODPILE.x - 6 + i * 1, WOODPILE.y - 2 - i * 2, 12 - i * 3, 2, i % 2 ? '#a8703c' : '#8b5a2b');
        const rock = rockAt(); px(rock.x - 4, rock.y - 3, 8, 3, '#8c96a0'); px(rock.x - 3, rock.y - 4, 6, 1, '#aab3bb');
        // the cats' basket: wicker round a red cushion, wide enough for two
        px(BASKET.x - 8, BASKET.y - 6, 16, 1, '#c98d4f'); px(BASKET.x - 10, BASKET.y - 5, 20, 6, '#8b5a2b'); px(BASKET.x - 8, BASKET.y + 1, 16, 1, '#6b4320'); // round at its ends
        px(BASKET.x - 8, BASKET.y - 5, 16, 1, '#d9665c'); px(BASKET.x - 9, BASKET.y - 4, 18, 4, '#b8433a');
        for (let i = 0; i < 5; i++) px(BASKET.x - 9 + i * 4, BASKET.y, 2, 1, '#c98d4f'); // its weave, at the front
        px(BASKET.x - 10, BASKET.y - 3, 1, 2, '#c98d4f'); px(BASKET.x + 9, BASKET.y - 3, 1, 2, '#c98d4f');
      }
      // the market stall: a crate on the counter for each open pull request, its tag the checks' colour
      const prs = scene.fields.flatMap(fl => fl.prs?.open ?? []);
      prs.slice(0, 8).forEach((pr, i) => {
        const x = STALL.x + 1 + (i % 4) * 7, y = STALL.y + 16 - Math.floor(i / 4) * 5, tag = pr.draft ? '#9aa4ad' : { ok: '#2fa57a', failed: '#e04a3a', running: blink(2) ? '#f0b429' : '#ffd43b' }[pr.checks] ?? '#e8d8b0';
        px(x, y, 6, 5, '#8b5a2b'); px(x, y, 6, 1, '#c98d4f'); px(x + 2, y, 1, 5, '#6b4320'); px(x + 3, y + 1, 2, 2, tag);
      });
      // pumps by the beds: background commands still running there
      for (const s of L.ST) {
        const jobs = scene.farmers.filter(f => f.field === s.key).reduce((t, f) => t + (f.jobs ?? 0), 0);
        for (let j = 0; j < Math.min(2, jobs); j++) {
          const x = s.x0 - 9 + j * 5, y = s.y0 - 2 + j * 2, up = Math.floor(T * 3 + j) % 2;
          px(x - 1, y + 9, 6, 2, '#5f6b7a'); px(x + 1, y + 1, 3, 9, '#3d7be0'); px(x + 1, y + 1, 1, 9, '#5ab4ff'); px(x + 4, y + 3, 2, 1, '#3d7be0');
          px(x - 2, y - 1 + up * 2, 5, 1, '#9aa4ad'); px(x + 2, y - 1, 1, 2, '#5f6b7a');
          if ((Math.floor(T * 6) + j) % 3) px(x + 5, y + 4 + (Math.floor(T * 6) % 3), 1, 1, '#a9dcf7');
        }
      }
      drawPorch(T);
    }
    // A cloud's shadow: rows of one span, so overlapping puffs don't double the shade.
    function cloudShadow(x, y, r) {
      const puffs = [[0, 0, r, Math.round(r * 0.5)], [Math.round(r * 0.55), -Math.round(r * 0.25), Math.round(r * 0.6), Math.round(r * 0.4)], [-Math.round(r * 0.5), Math.round(r * 0.1), Math.round(r * 0.55), Math.round(r * 0.35)]];
      for (let dy = -r; dy <= r; dy++) {
        let lo = Infinity, hi = -Infinity;
        for (const [ox, oy, rx, ry] of puffs) { const t = (dy - oy) / (ry + 0.5); if (Math.abs(t) > 1) continue; const half = rx * Math.sqrt(1 - t * t); lo = Math.min(lo, ox - half); hi = Math.max(hi, ox + half); }
        if (hi > lo) px(Math.round(x + lo), y + dy, Math.round(hi - lo), 1, '#1c3320');
      }
    }
    // MCP carts: each server's cart waits in its place in a row at the lane's end, by the road to town,
    // facing the farm; while an agent calls the server it drives to that farmer and waits beside it (cartGoal).
    const RANK = Array.from({ length: 6 }, (_, i) => [388 - i * 15, LANE]);
    const CART_SPEED = 55;
    const CRATES = ['#c9a46a', '#e04a3a', '#3d7be0', '#6cc04a', '#8a5fc0', '#f0b429']; // a crate colour for each server
    const rankOf = new Map(), carts = new Map(); // server → its place in the row; server → { x, y, path, to, dir, moving, goal, arrivedAt, lastBusy }
    /** The carts there are now, each with its place in the row (kept while the server has a cart). */
    function placeCarts() {
      const list = scene.carts ?? [];
      for (const k of [...rankOf.keys()]) if (!list.some(c => c.server === k)) { rankOf.delete(k); carts.delete(k); }
      for (const c of list) if (!rankOf.has(c.server)) { const used = new Set(rankOf.values()); rankOf.set(c.server, RANK.findIndex((_, i) => !used.has(i))); }
      return list;
    }
    /** Beside a farmer, on the side away from the fence: where it is going rather than where it is, so the cart does not chase it step by step. */
    const besideOf = b => { const x = Number.isFinite(b.tx) ? b.tx : b.x, y = Number.isFinite(b.ty) ? b.ty : b.y; return [Math.round(x + (x > 330 ? -13 : 13)), Math.round(y)]; };
    /** A cart and its pony, facing `dir`, its crate in the server's colour; the pony's legs move while it drives. */
    function drawCart(x, y, dir, moving, crate) {
      const step = moving ? blink(6) : 0, pony = x + dir * 7;
      px(x - 4, y + 2, 9, 1, '#3f7d3a'); // its shadow
      px(x - 4, y - 4, 8, 4, '#a8703c'); px(x - 4, y - 4, 8, 1, '#c98d4f'); px(x - 2, y - 7, 4, 3, crate); px(x - 2, y - 7, 4, 1, '#fff4d6');
      px(x - 3, y, 2, 2, '#4e3626'); px(x + 2, y, 2, 2, '#4e3626');
      px(pony - 3, y - 4, 6, 3, '#8b5a2b'); px(pony + dir * 3 - (dir < 0 ? 1 : 0), y - 6, 2, 3, '#8b5a2b'); px(pony + dir * 4 - (dir < 0 ? 0 : 1), y - 5, 1, 1, '#1b1420');
      px(pony - 3 + step, y - 1, 1, 2, '#6b4320'); px(pony + 1 - step, y - 1, 1, 2, '#6b4320'); px(pony - dir * 4, y - 4, 1, 2, '#4e3626');
    }
    const FIREFLIES = [[20, 150], [60, 160], [92, 176], [30, 232], [74, 196], [50, 252], [100, 250], [14, 262], [88, 140], [96, 214], [240, 92], [330, 70]];
    // The farm's animals (sdk/animals.js): just for fun, never data. They walk the yard (not the lane:
    // it runs along the porch, where farmers waiting on you stand), never the fields (their crops are context), the hay, crates or mailbox (git), the carts' rank (MCP),
    // the hammocks or the henhouse. No chickens (subagents), and the dog is a sheepdog (the Explore dog is
    // data). The ducks keep to the pond and its bank.
    const POND = { x: 12, y: 199, w: 60, h: 22 }; // the water (the pond's oval, a little inside its bank)
    const TROUGH = { x: 92, y: 158 }, WOODPILE = { x: 14, y: 186 }; // the yard's things to drink at and climb on (animals on only)
    const rockAt = () => ({ x: 94, y: L.GRID.y1 - 42 }); // by the shade tree, clear of its crown (it moves down with more rows)
    const BASKET = { x: 52, y: 153 }; // the cats' basket in the meadow (animals on only)
    const mossAt = () => ({ x: 16, y: L.GRID.y1 - 24 }); // the bed of moss at the wood's edge, at the feet of its two trees
    const woodAt = () => ({ x: 0, y: L.GRID.y1 - 54, w: 38, h: 32 }); // those trees and the moss: only a napping cat goes in
    const today = new Date(), friday = today.getDay() === 5;
    const CAT_ACTIONS = [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }, { label: 'Laser pointer', pose: 'run', run: true, fx: 'dust', line: 'laser' }, { label: 'Boop the nose', pose: 'happy', line: 'boop' }];
    const CAT_LINES = { petted: ['purr ♥'], fed: ['MEOW. finally'], laser: ['RED DOT!!', 'it got away. again.'], boop: ['…boop.', 'hiss (lovingly)'], cuddle: ['purr…', '♥', 'move over'],
      missed: ['next time.', 'I let it go. on purpose.'], shame: ['nobody saw that', 'we never speak of this'], no: ['no.', 'we do not herd'], gravity: ['gravity still works.', 'it was like that when I got here'],
      deployFailed: ['not me. the dog did it'], deployOk: ['acceptable.'], harvest: ['is it tuna?'], merged: ['you may pet me now'] };
    const FARM_ANIMALS = [
      { kind: 'cow', count: 2, name: 'Cow', actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }, { label: 'Ride', pose: 'run', run: true, line: 'ride' }, { label: 'Moo back', line: 'moo' }],
        lines: { idle: ['MOO.', 'moo?', 'grass again. good.', 'I am a cow.'], petted: ['moo ♥'], fed: ['MOO! thank you'], ride: ['this was not in my contract'], moo: ['MOO!!'],
          deployFailed: ['moo?! (it broke)'], deployOk: ['moo 🌈'], harvest: ['harvest! 🎉'], hammock: ['zzz… moo', 'my hammock now'],
          gossip: ['did you hear? main is red', 'someone force-pushed. on a Friday'], gossip2: ['moo. scandalous.', 'who reviews the reviewers?'] } },
      { kind: 'goat', count: 2, name: 'Goat', habits: ['climb'], actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Feed', fx: 'crumbs', pose: 'eat', line: 'fed' }, { label: 'Get my hat back', pose: 'run', run: true, line: 'hat' }],
        lines: { idle: ['baa.', 'this hat tastes of deadlines', 'I ate a sock once', 'baa?'], petted: ['baa ♥'], fed: ['BAA! more'], hat: ['what hat?'],
          nibble: ['nom', 'just a taste'], faint: ['*faints* (it is a goat thing)', 'I am fine. this is normal'], deployFailed: ['BAA!'], deployOk: ['baa! 🌈'], harvest: ['snacks?'] } },
      { kind: 'sheepdog', name: 'Sheepdog', habits: ['fetch', 'roll', 'laps'], reacts: { merged: 'run', arrive: 'run' }, actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Throw a stick', pose: 'run', run: true, fx: 'dust', line: 'stick' }, { label: 'Belly rub', pose: 'sleep', fx: 'hearts', line: 'rub' }],
        lines: { idle: ['woof.', 'I herd things', 'is that a squirrel', 'woof?'], petted: ['woof ♥'], stick: ['STICK!'], rub: ['best day ever'],
          merged: ['WOOF! shipped!'], arrive: ['woof! hi!', 'a new friend!'], herd: ['herding cats. how hard can it be'], gaveup: ['…impossible. as they said'], deployFailed: ['woof woof!'], deployOk: ['good deploy! good!'], harvest: ['herding the harvest'] } },
      { kind: 'ostrich', name: 'Ostrich', habits: ['circles', 'hide'], actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Race it', pose: 'run', run: true, fx: 'dust', line: 'race' }, { label: 'Ride', pose: 'run', run: true, line: 'ride' }],
        lines: { idle: ['not my fault', 'I run, therefore I am', 'honk?'], petted: ['…fine.'], race: ['too slow!'], ride: ['hold on to your hat'],
          deployFailed: ['not my fault'], deployOk: ['I knew it'], bucket: ['new hat. thoughts?', 'it suits me'] } },
      { kind: 'lion', name: 'Lion', habits: ['yawn', 'stretch'], actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Give a fish', pose: 'eat', fx: 'crumbs', line: 'fish' }, { label: 'Boop the nose', pose: 'happy', line: 'boop' }],
        lines: { idle: ['*yawn*', 'I am the king of this yard', 'nap time'], petted: ['purr…'], fish: ['FISH. yes.'], boop: ['…boop.'],
          startled: ['EEK! a chicken!', 'I was not scared'], nap: ['zzz… purr', 'five more minutes'], mouse: ['EEK! a mouse!', 'it is HUGE'], fits: ['if I fits, I sits', 'this is my size'], deployFailed: ['*roar* (worried)'], harvest: ['…food?'] } },
      { kind: 'tiger', name: 'Tiger', habits: ['chaseTail', 'pounce'], actions: [{ label: 'Pet', fx: 'hearts', line: 'petted' }, { label: 'Give a fish', pose: 'eat', fx: 'crumbs', line: 'fish' }, { label: 'Boop the nose', pose: 'happy', line: 'boop' }],
        lines: { idle: ['where is my tail', 'butterfly!', 'rawr (friendly)'], petted: ['purr ♥'], fish: ['mine now'], boop: ['boop back'],
          tag: ['tag! you’re it', 'gotcha'], boo: ['boo!'], oops: ['…oops', 'I only said boo'], deployFailed: ['rawr?!'], deployOk: ['rawr 🌈'] } },
      { kind: 'duck', count: 5, looks: ['drake', 'hen', 'duckling', 'duckling', 'duckling'], name: 'Ducks', home: POND, bank: [[42, 194], [42, 226], [78, 210]],
        actions: [{ label: 'Feed bread', fx: 'crumbs', gather: true, steal: true, line: 'fed' }, { label: 'Quack back', line: 'quack' }],
        lines: { idle: ['quack.', 'QUACK', 'any bread?', 'peep'], fed: ['BREAD!', 'bread bread bread'], quack: ['quack quack!'], bread: ['mine!', 'MINE'],
          deployFailed: ['QUACK!'], deployOk: ['quack 🌈'], harvest: ['peep peep!'] } },
      // Two cats, a grey one and a black one: they stroll the yard (by night too), hunt the mice, and sleep long in the
      // basket or on the moss at the wood's edge (the yard's left side), sometimes curled up together (the nap habit and dens()).
      { kind: 'cat', look: 'grey', name: 'Grey cat', habits: ['nap', 'yawn', 'stretch', 'pounce', 'chaseTail'], actions: CAT_ACTIONS,
        lines: { ...CAT_LINES, idle: ['mrrp.', 'keyboard = bed', 'if I fits, I sits', 'feed me. now. also later', 'I pushed it off the table. it was git'] } },
      { kind: 'cat', look: 'black', name: 'Black cat', habits: ['nap', 'yawn', 'stretch', 'pounce', 'roll'], actions: CAT_ACTIONS,
        lines: { ...CAT_LINES, idle: ['I am the night', 'bad luck? I am a feature', 'meow --force', 'staring at nothing. important', '3 a.m. is zoomies o’clock',
          ...(friday ? [today.getDate() === 13 ? 'Friday the 13th. my day' : 'Friday? I would not deploy'] : [])] } },
      { kind: 'mouse', count: 2, name: 'Mouse', actions: [{ label: 'Give cheese', fx: 'crumbs', pose: 'eat', line: 'cheese' }, { label: 'Squeak back', line: 'squeak' }],
        lines: { idle: ['squeak.', 'cheese?', 'the cats are asleep. party', 'I live in your node_modules'], cheese: ['CHEESE!'], squeak: ['squeak squeak!'], eek: ['EEK!', 'not today, cat!'],
          brave: ['my yard now', 'BOO.'], king: ['who is king now?', 'fear me'], deployFailed: ['squeak?!'] } },
      // A unicorn, now and then (every 3 to 8 minutes, for 20 to 40 s), anywhere the animals may walk: shy, with nothing to say and no menu. Touch it and it is gone.
      { kind: 'unicorn', name: 'Unicorn', visits: { every: [180, 480], stay: [20, 40] }, reacts: { deployFailed: 'scatter', deployOk: null, harvest: null }, actions: [], lines: {} },
    ];
    // Now and then they get up to something (sdk/animals.js, gags): the steps play out with farmers the engine lends.
    const FARM_GAGS = [
      { id: 'hat', needs: { goat: 1, farmer: 'idle' }, steps: [{ go: 'goat', to: 'farmer' }, { wear: 'goat', what: 'hat', on: true }, { say: 'goat', line: 'hat' }, { go: 'goat', to: 'away', run: true, ms: 3000 }, { chase: 'farmer', after: 'goat', ms: 3000 }, { wear: 'goat', what: 'hat', on: false }] },
      { id: 'nibble', needs: { goat: 1, farmer: 'busy' }, steps: [{ go: 'goat', to: 'farmer', ms: 6000 }, { wear: 'goat', what: 'hat', on: true }, { say: 'goat', line: 'nibble' }, { wait: 3000 }, { wear: 'goat', what: 'hat', on: false }, { go: 'goat', to: 'away' }] }, // it keeps working, hatless 3 s
      { id: 'bucket', needs: { ostrich: 1, farmer: 'idle', spot: 'bucket' }, steps: [{ go: 'ostrich', to: 'spot:bucket' }, { wear: 'ostrich', what: 'bucket', on: true }, { go: 'ostrich', to: 'away', run: true, ms: 3000 }, { chase: 'farmer', after: 'ostrich', ms: 3000 }, { say: 'ostrich', line: 'bucket' }, { wear: 'ostrich', what: 'bucket', on: false }] },
      { id: 'startled', needs: { lion: 1, chicken: true }, steps: [{ pose: 'lion', is: 'startled', ms: 800 }, { say: 'lion', line: 'startled' }] },
      { id: 'hammock', needs: { cow: 1, spot: 'hammock' }, steps: [{ go: 'cow', to: 'spot:hammock' }, { say: 'cow', line: 'hammock' }, { stay: 'cow', is: 'sleep', ms: 20000, while: 'spot:hammock' }, { go: 'cow', to: 'back' }] },
      { id: 'tag', needs: { tiger: 1, sheepdog: 1 }, steps: [{ go: 'tiger', to: 'sheepdog', run: true }, { say: 'tiger', line: 'tag' }, { go: 'sheepdog', to: 'away', run: true, ms: 2500 }, { go: 'tiger', to: 'sheepdog', run: true, ms: 2500 }] },
      // a cat hunts a mouse (the mouse is faster); now and then it is the other way round
      { id: 'mouse', needs: { cat: 1, mouse: 1 }, steps: [{ go: 'cat', to: 'mouse', run: true }, { say: 'mouse', line: 'eek' }, { go: 'mouse', to: 'away', run: true, ms: 2500 }, { go: 'cat', to: 'mouse', run: true, ms: 3000 },
        { go: 'mouse', to: 'away', run: true, ms: 2500 }, { go: 'cat', to: 'mouse', run: true, ms: 3000 }, { go: 'mouse', to: 'away', run: true, ms: 2000 }, { say: 'cat', line: 'missed' }] },
      { id: 'tables', needs: { mouse: 1, cat: 1 }, steps: [{ go: 'mouse', to: 'cat', run: true }, { say: 'mouse', line: 'brave' }, { pose: 'cat', is: 'startled', ms: 700 }, { go: 'cat', to: 'away', run: true, ms: 2500 }, { go: 'mouse', to: 'cat', run: true, ms: 3000 }, { say: 'cat', line: 'shame' }] },
      { id: 'herding', needs: { sheepdog: 1, cat: 2 }, steps: [{ go: 'sheepdog', to: 'cat', run: true }, { say: 'sheepdog', line: 'herd' }, { go: 'cat', to: 'away', ms: 3000 }, { go: 'cat2', to: 'away', ms: 3000 }, { say: 'cat', line: 'no' }, { pose: 'sheepdog', is: 'roll', ms: 2500 }, { say: 'sheepdog', line: 'gaveup' }] },
      { id: 'gravity', needs: { cat: 1, spot: 'bucket' }, steps: [{ go: 'cat', to: 'spot:bucket' }, { pose: 'cat', is: 'stand', ms: 1200 }, { wear: 'cat', what: 'bucket', on: true }, { say: 'cat', line: 'gravity' }, { wait: 3500 }, { wear: 'cat', what: 'bucket', on: false }, { go: 'cat', to: 'back' }] }, // it pushes the bucket over
      { id: 'mouseking', needs: { lion: 1, mouse: 1 }, steps: [{ go: 'mouse', to: 'lion', run: true }, { pose: 'lion', is: 'startled', ms: 800 }, { say: 'lion', line: 'mouse' }, { go: 'lion', to: 'away', run: true, ms: 3000 }, { say: 'mouse', line: 'king' }] },
      { id: 'fits', needs: { lion: 1, spot: 'basket' }, steps: [{ go: 'lion', to: 'spot:basket' }, { say: 'lion', line: 'fits' }, { stay: 'lion', is: 'sleep', ms: 12000 }, { go: 'lion', to: 'back' }] }, // the big cat in the cats' basket, while they are out
      { id: 'faint', needs: { goat: 1, tiger: 1 }, steps: [{ go: 'tiger', to: 'goat', run: true }, { say: 'tiger', line: 'boo' }, { pose: 'goat', is: 'roll', ms: 3000 }, { say: 'goat', line: 'faint' }, { pose: 'tiger', is: 'startled', ms: 600 }, { say: 'tiger', line: 'oops' }] },
      { id: 'gossip', needs: { cow: 2 }, steps: [{ go: 'cow2', to: 'cow' }, { say: 'cow', line: 'gossip' }, { wait: 3000 }, { say: 'cow2', line: 'gossip2' }, { wait: 2500 }] },
    ];
    // A farmer idle three minutes or more sometimes plays with one (two at most); work, or you, call it back.
    const FARM_PLAY = [
      { id: 'stick', needs: { farmer: 'idle', sheepdog: 1 }, steps: [{ go: 'farmer', to: 'sheepdog' }, { go: 'sheepdog', to: 'away', run: true, ms: 3000 }, { go: 'sheepdog', to: 'farmer', run: true }, { say: 'sheepdog', line: 'stick' }] },
      { id: 'pet', needs: { farmer: 'idle', goat: 1 }, steps: [{ go: 'farmer', to: 'goat' }, { fx: 'hearts', at: 'goat' }, { say: 'goat', line: 'petted' }, { wait: 2000 }] },
      { id: 'nap', needs: { farmer: 'idle', lion: 1 }, steps: [{ go: 'farmer', to: 'lion' }, { pose: 'lion', is: 'sleep', ms: 8000 }, { say: 'lion', line: 'nap' }] },
      { id: 'laser', needs: { farmer: 'idle', cat: 1 }, steps: [{ go: 'farmer', to: 'cat' }, { say: 'cat', line: 'laser' }, { go: 'cat', to: 'away', run: true, ms: 2000 }, { go: 'cat', to: 'back', run: true, ms: 2000 }, { go: 'cat', to: 'away', run: true, ms: 2000 }, { fx: 'dust', at: 'cat' }] },
    ];

    return {
      key: 'farm', SH: 16, W, corridors: CORR, grid: { layoutFor, packedLayout }, help: helpHtml, fromScene: s => stage(farmScene(s)),
      /** A new scene; returns what happened since the last one: harvests (compactions) and sales (merged pull requests). */
      setScene(next) {
        const events = [];
        const comp = new Map(next.farmers.map(f => [f.id, f.compactions ?? 0]));
        if (seenCompactions) for (const f of next.farmers) if (seenCompactions.has(f.id) && comp.get(f.id) > seenCompactions.get(f.id)) events.push({ id: f.id, kind: 'harvest', text: 'Harvest!', cls: 'good', log: 'brings in the harvest: its conversation was compacted, and it sows again' });
        seenCompactions = comp;
        const merged = next.fields.flatMap(fl => (fl.prs?.merged ?? []).map(m => ({ ...m, repo: fl.name, key: `${fl.key}#${m.number}` })));
        if (seenMerged) for (const m of merged) if (!seenMerged.has(m.key) && (m.at ?? 0) > Date.now() - 30 * 60_000) events.push({ at: [STALL.x + 14, STALL.y + 8], kind: 'merged', text: `Sold! #${m.number}`, cls: 'good', log: `${m.repo}: pull request #${m.number} merged (${clip(m.title ?? '', 50)})` });
        seenMerged = new Set(merged.map(m => m.key));
        const weather = new Map(next.fields.map(fl => [fl.key, fl.weather ?? null]));
        if (seenWeather) for (const [key, w] of weather) { // a deploy just failed (rain) or went through (a rainbow): for the animals, no words
          const s = stOf(key), kind = w === 'rain' ? 'deployFailed' : w === 'rainbow' ? 'deployOk' : null;
          if (kind && s && seenWeather.get(key) !== w) events.push({ kind, at: [s.cx, s.rowTop + 30], text: '' });
        }
        seenWeather = weather;
        scene = next;
        tallies.clear();
        events.push(...callHens(next));
        season = seasonOf(next.plan);
        porchAt = 0; // who is on the porch may have changed
        if (events.some(e => e.kind === 'merged')) cheerUntil = Date.now() + 6000;
        for (const key of found.splice(0)) events.push({ at: [PORCH_SPOTS.turn[1], PORCH_Y - 34], text: 'New!', cls: 'good', by: 'The porch', log: `${ALBUM[key]}: seen for the first time (${album.size} of ${Object.keys(ALBUM).length} in the album)` });
        return events;
      },
      /** The engine's handles: this world's own settings, kept in the browser (the album). */
      attach({ prefs }) { keep = prefs; for (const k of String(prefs.get('album') ?? '').split(',')) if (ALBUM[k]) album.add(k); },
      layout: () => L,
      relayout(ground) { L = ground; return L; }, // a layoutFor() result
      // Where each farmer stands. Porch, scarecrows, the tree and the meadow hold a few each; the rest show as a "+N" sign.
      slots(f) {
        if (f.state === 'leaving' && f.gone) return null; // in at the door: off the farm
        const [key, w] = jobOf(f.id) ?? [], bedOf = key && stOf(key);
        if (bedOf) { const [x, y] = workTarget(w, bedLegs(bedOf)); return { group: `work:${f.id}`, cap: 1, at: () => [x, y], zone: `${w.kind}:${key}`, direct: w.on }; } // building a field, or packing one up: leg by leg
        if (f.state === 'leaving' && f.hold && seenAt.has(f.id)) return { group: `leave:${f.id}`, cap: 1, at: () => seenAt.get(f.id), zone: 'leave', direct: true }; // a moment where it stands: its hens go first
        if (f.state === 'leaving') return { group: `leave:${f.id}`, cap: 1, at: () => (f.inside ? [HOUSE_DOOR.x, HOUSE_DOOR.y1] : [HOUSE_DOOR.x, LANE]), zone: 'leave', direct: Boolean(f.inside) }; // to the steps, then up and in
        const round = roundOf(f);
        if (round) { // at a step of the bed's: point by point along its rows, or round its frame (to the bed first, by the paths)
          const s = stOf(round.key), [x, y] = roundPoints(s, round.go)[round.i];
          return { group: `st:${s.key}`, at: used => { used.push(1000 + round.i); return [x, y]; }, zone: `st:${s.key}:${doing(f)?.prop ?? ''}`, direct: round.on };
        }
        const s = f.state === 'working' ? stOf(f.field) : null;
        if (s) return { group: `st:${s.key}`, at: used => { const off = [doing(f)?.spot ?? 0, 0, -26, 26, -13, 13].find(o => !used.includes(o)) ?? 0; used.push(off); return [s.cx + off, s.lane]; }, zone: `st:${s.key}:${doing(f)?.prop ?? ''}` };
        if (f.state === 'working') return { group: 'meadow', cap: MEADOW.length, at: i => MEADOW[i], zone: 'meadow' };
        if (f.nap) return { group: 'nap', cap: NAPS.length, at: i => NAPS[i], zone: 'nap' }; // it wakes up by itself: a hammock, not your porch
        // the porch: 3 waiting on its left end (one waiting a long while paces), 3 with their turn in its seats on the right, each in the one it likes
        if (f.state === 'waiting') return { group: 'desk', cap: 3, at: i => [PORCH_SPOTS.desk[i] + (porchOf().who.get(f.id)?.stage === 'pace' && Math.floor(Date.now() / 5000) % 2 ? 3 : 0), PORCH_Y], zone: 'desk' };
        if (f.state === 'turn') return { group: 'turn', cap: 3, at: i => [PORCH_SPOTS.turn[porchOf().who.get(f.id)?.seat ?? i], PORCH_Y], zone: 'turn' };
        if (f.state === 'stale') return { group: 'storage', cap: 4, at: i => [328 + 20 * i, PORCH_Y], zone: 'storage' };
        const y = L.GRID.y1 - 6;
        return { group: 'charge', cap: 4, at: i => [[64, y], [40, y + 2], [88, y + 2], [16, y + 4]][i], zone: 'charge' }; // under the shade tree
      },
      /** A new farmer comes out of the farmhouse: from its front door, across the porch and down the steps onto the lane; then its own way. */
      spawn: () => [HOUSE_DOOR.x, HOUSE_DOOR.y1, [[HOUSE_DOOR.x, LANE]]], // it starts in the doorway, on the sill
      follow: (b, k, T, kid) => (kid?.dog
        ? [b.x + Math.cos(T * 0.9 + k) * 30, b.y + 3 + Math.sin(T * 1.8) * 6] // the Explore dog roams and sniffs
        : [b.x + (k % 2 ? 1 : -1) * (7 * SC + 4) + Math.sin(T * 1.3 + k) * 3, b.y + 2 - (k > 1 ? 4 * SC : 0)]),
      startText: n => `Morning: <b>${n}</b> farmer${n === 1 ? '' : 's'} on the farm`,
      arriveText: 'comes out of the farmhouse',
      tag: tagText,
      /** A tag on the porch has its place's width (the places are 22 apart); anywhere else it is as wide as its name. */
      tagSlot: f => ((f.state === 'waiting' || f.state === 'turn') && !f.nap ? PORCH_SPOTS.turn[1] - PORCH_SPOTS.turn[0] : null),
      /** A turn ended: a tick at its tag's corner, or a question mark when it asked you something (one waiting on you keeps its red "!" over its head). */
      tagBadge(f) { // a turn ended: a tick, or a question mark; at work: its tool, as a picture
        if (f.state === 'turn' && !f.nap) return f.question ? 'ask' : 'ok';
        const prop = f.state === 'working' ? doing(f)?.prop : null, pic = prop ? propPic(prop) : null;
        return pic?.toDataURL ? { img: pic.toDataURL(), key: prop } : null;
      },
      tip: f => {
        const field = fieldByKey(f.field);
        const what = f.state === 'waiting' ? `needs you: ${f.ask}` : f.state === 'turn' ? (f.question ? `asks you: ${f.question}` : `your turn: ${f.reply || 'finished'}`)
          : f.state === 'working' ? `${doing(f)?.verb ?? 'working'}${field ? ` in ${field.name}` : ''}${f.summary ? ` · ${f.summary}` : ''}`
          : f.state === 'stale' ? 'stale' : 'idle';
        const mode = { acceptEdits: 'accept edits', plan: 'plan mode', auto: 'auto mode', bypassPermissions: '⚠ bypass permissions', dontAsk: "don't ask" }[f.mode];
        const extra = [
          f.tasks && `tasks ${f.tasks.done}/${f.tasks.total}${f.tasks.current ? `: ${f.tasks.current}` : ''}`,
          f.jobs && `${f.jobs} background command${f.jobs === 1 ? '' : 's'} running`,
          f.nap && f.wakeAt && `wakes up by itself at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
          f.compactions && `compacted ${f.compactions}×`,
          f.model && `${f.model}${f.fast ? ' (fast)' : ''}`,
        ].filter(Boolean).map(t => ` · ${t}`).join('');
        const line = f.turn ? `${f.turn.word ?? (f.thinking ? 'Thinking' : 'Working')}… ${ago(f.turn.startedAt)}${f.turn.outTokens ? ` · ↓ ${f.turn.outTokens >= 1000 ? `${(f.turn.outTokens / 1000).toFixed(1)}k` : f.turn.outTokens} tokens` : ''}${f.thinking && f.effort ? ` · thinking with ${f.effort} effort` : ''} · ` : '';
        return `${f.name} · ${line}${f.thinking ? 'thinking' : what}${f.kind === 'codex' ? '' : ` · ${Math.round((1 - f.pct) * 100)}% context left`}${f.cost != null ? ` · $${f.cost.toFixed(2)} so far` : ''}${mode ? ` · ${mode}` : ''}${extra}`;
      },
      onMove(f, zone, prev, pop) {
        if (!prev) return;
        if (zone === 'turn') pop('Done!', 'good');
        else if (zone === 'desk') pop(f.planAsk ? 'A plan for you' : 'Needs you!', 'warn');
        else if (zone === 'storage' || zone === 'nap') pop('…zzz', 'dim');
      },
      speed: f => (jobOf(f.id)?.[1].on ? WORK_SPEED : tending(f) ? TEND_SPEED : f.fast ? 68 : 40), // fast mode walks faster; at a field's building, a brisk pace
      zoneText(f, z) {
        if (z === 'leave') return 'goes back into the farmhouse';
        if (z.startsWith('build:') || z.startsWith('pack:')) { const name = fieldByKey(z.slice(z.indexOf(':') + 1))?.name ?? ''; return z.startsWith('build:') ? `unpacks the ${name} field and builds it` : `packs up the ${name} field to take along`; }
        if (z === 'desk') return f.askKind === 'permission' || f.askKind === 'always' ? 'comes up to your porch: needs a permission' : 'comes up to your porch with a question';
        if (z === 'turn') return f.question ? 'comes to your porch with a question' : 'brings a basket of finished work to your porch';
        if (z === 'storage') return 'stands still as a scarecrow (stale)';
        if (z === 'charge') return 'rests under the shade tree (idle)';
        if (z === 'meadow') return 'works in the wild meadow (no repo)';
        if (z === 'nap') return `naps in a hammock until it wakes up by itself${f.wakeAt ? ` at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}`;
        return `${doing(f)?.verb ?? 'working'} in the ${fieldByKey(f.field)?.name ?? ''} field`;
      },
      /**
       * The farm's controls, laid over it so it fills the window: top left, the panel with what the
       * dashboard's top bar and count cards say; top right, the dashboard's own buttons; along the
       * bottom, below the fields' fence, a slim row of switches and zoom.
       */
      hud({ still, zoom = 1, saysOn = true, skyMode = 'live', follow = false, canFollow = false, restingHidden = null, bell = false, nav = {}, panelOpen = true, animals = null }) {
        const need = scene.farmers.filter(a => a.state === 'waiting' || a.question).length;
        const spent = scene.farmers.reduce((t, a) => t + (a.cost ?? 0), 0), harvested = scene.farmers.reduce((t, a) => t + (a.compactions ?? 0), 0);
        const ch = scene.chrome ?? {}, c = ch.counts ?? {};
        const w = t => pxt(t, '#fff3d6', '#2a1d14'), dim = t => pxt(t, '#c9b48a', null), label = t => pxt(t, '#a9c79a', null);
        const gb = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
        const bar = (ratio, tone) => `<span class="px-bar"><i class="${tone}" style="width:${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%"></i></span>`;
        const tone = r => (r >= 0.8 ? 'bad' : r >= 0.5 ? 'warn' : 'ok');
        const kpi = (state, glyph, cls, name, n, sub, hot, title) => `<button type="button" class="px-kpi${hot ? ' hot' : ''}"${state && n ? ` data-farm-state="${state}"` : ' disabled'} title="${esc(title)}"><span class="px-kpi-ico ${cls}">${pxt(glyph, '#ffffff', null)}</span><span class="px-kpi-n">${w(String(n ?? 0))}</span><span class="px-kpi-l">${label(name)}${sub ? `<br>${dim(sub)}` : ''}</span></button>`;
        const ramRatio = ch.ram?.totalMb ? ch.ram.usedMb / ch.ram.totalMb : 0, cpuRatio = (ch.cpu?.used ?? 0) / ((ch.cpu?.cores || 1) * 100);
        const windows = scene.plan?.windows ?? [], win = kind => windows.find(x => x.kind === kind), pctOf = x => (x ? (x.reset ? 0 : Math.round(x.percentUsed)) : null);
        const five = pctOf(win('five_hour')), week = pctOf(win('seven_day')), codexWeek = pctOf(scene.codexPlan?.windows?.find(x => x.kind === 'seven_day'));
        const tool = (attr, icon, name, state, title, disabled = false) => `<button type="button" ${attr}${disabled ? ' disabled' : ''} title="${esc(title)}">${iconImg(icon)}${pxImg(name, '#4e3626', null)}${state ? pxImg(state, '#8b5a2b', null) : ''}<span class="px-sr">${esc(state ? `${name}: ${state}` : name)}</span></button>`;
        const navBtn = (what, icon, name, title, pressed) => `<button type="button" data-farm-nav="${what}" title="${esc(title)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${iconImg(icon)}${pxImg(name, '#4e3626', null)}<span class="px-sr">${esc(name)}</span></button>`;
        return `<div class="px-stats${panelOpen ? '' : ' folded'}">
            <button type="button" class="px-brand" data-farm-panel title="${panelOpen ? 'Fold this panel away' : 'Show the counts and meters'}" aria-expanded="${panelOpen}">${brandSvg()}${pxt('AGENTVILLE', '#ffe8a3', '#2a1d14')}<i class="px-live${nav.live === false ? ' off' : ''}" title="${nav.live === false ? 'Disconnected from the collector: retrying' : 'Live'}"></i>${pxt(panelOpen ? '-' : '+', '#c9b48a', null)}</button>
            <div class="px-line"><span title="What the sessions on the farm have cost so far (each one's purse; from the mod)"><b class="coin"></b>${w(`$${spent.toFixed(2)}`)}</span><span title="Harvests: each time a session's conversation was compacted"><b class="basket"></b>${w(`${harvested} harvested`)}</span><span class="px-season" title="${esc(seasonTip())}">${iconImg(season === 'summer' ? 'day' : season)}${w(season)}</span></div>
            <div class="px-kpis">
              ${kpi('waiting', '!', 'k-wait', 'waiting on you', c.waiting, c.waiting ? `oldest ${ago(ch.oldestWaiting ?? Date.now())}` : 'all clear', c.waiting > 0, 'Agents waiting on you (a question or a permission): click for the first')}
              ${kpi('working', '>', 'k-work', 'working', c.working, ch.subagentsRunning ? `${ch.subagentsRunning} with subagents` : `${ch.agents ?? 0} agents tracked`, false, 'Agents at work: click for the first')}
              ${kpi('turn', '<', 'k-turn', 'your turn', c.yourTurn, `${ch.asking ? `${ch.asking} ask you · ` : ''}${c.idle ?? 0} idle · ${c.stale ?? 0} stale`, ch.asking > 0, "Agents whose turn ended: it's yours. Click for the first")}
              ${kpi(null, '⚠', 'k-collide', 'collisions', c.collisions, c.collisions ? 'two in one repo' : 'none', c.collisions > 0, 'Two agents writing one repo')}
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this Mac's">${label('RAM')}${bar(ramRatio, tone(ramRatio))}${w(gb(ch.ram?.usedMb ?? 0))}${ch.ram?.totalMb ? dim(`of ${gb(ch.ram.totalMb)}`) : ''}</span>
              <span class="px-gauge" title="${esc(`CPU used by the agents: ${Math.round(ch.cpu?.used ?? 0)}% of one core, ${ch.cpu?.cores ?? 1} cores`)}">${label('CPU')}${bar(cpuRatio, tone(cpuRatio))}${w(`${Math.round(cpuRatio * 100)}%`)}${dim('of this Mac')}</span>
              ${five !== null ? `<span class="px-gauge" title="Your plan's 5-hour limit (from the mod)">${label('5H')}${bar(five / 100, tone(five / 100))}${w(`${five}%`)}${dim('5-hour limit')}</span>` : ''}
              ${week !== null ? `<span class="px-gauge" title="Your plan's weekly limit (from the mod)">${label('WEEK')}${bar(week / 100, tone(week / 100))}${w(`${week}%`)}${dim('this week')}</span>` : ''}
              ${codexWeek !== null ? `<span class="px-gauge" title="Codex's weekly limit (from its sessions)">${label('CODEX')}${bar(codexWeek / 100, tone(codexWeek / 100))}${w(`${codexWeek}%`)}${dim('this week')}</span>` : ''}
              ${ch.collector ? `<span class="px-gauge" title="The tracker itself">${dim(`tracker ${ch.collector.cpu ?? 0}% CPU · ${ch.collector.rssMb ?? 0} MB`)}</span>` : ''}
            </div>
            ${(ch.errors ?? []).map(e => `<div class="px-err">⚠ ${esc(e)}</div>`).join('')}
            ${need ? `<button type="button" class="px-need" data-farm-need title="Open the first agent that needs you">${pxt(`${need} need${need > 1 ? '' : 's'} you`, '#ffffff', '#5a1f19')}</button>` : ''}
          </div>
          <div class="px-nav">
            ${navBtn('list', 'list', 'LIST', 'Back to the list view')}
            ${navBtn('worlds', 'world', 'WORLD', 'Choose a world')}
            ${navBtn('session', 'plus', 'SESSION', 'Start a new Claude Code session in a folder, or resume a past one')}
            ${navBtn('setup', 'gear', 'CLAUDE CODE', 'Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules')}
            ${navBtn('side', 'side', 'SIDEBAR', "Show the selected farmer's answer box, activity and files beside the farm", Boolean(nav.side))}
            ${navBtn('theme', nav.theme === 'light' ? 'day' : nav.theme === 'auto' ? 'live' : 'night', String(nav.theme ?? 'dark').toUpperCase(), 'Theme: dark, light, or auto (as macOS is): click to change')}
          </div>
          <div class="px-tools">
              ${tool('data-farm-follow', 'follow', 'Follow', follow ? 'on' : 'off', canFollow ? 'Keep the farmer you picked in the middle of the view (zooms in); dragging the view turns it off' : 'Pick a farmer first, then Follow keeps it in view', !canFollow)}
              ${tool('data-farm-resting', 'resting', 'Resting', restingHidden === null ? 'shown' : `hidden (${restingHidden})`, 'Idle farmers (under the tree) and stale ones (scarecrows): show them, or hide them to keep the farm to the agents at work')}
              ${tool('data-farm-bubbles', 'bubbles', 'Bubbles', saysOn ? 'on' : 'off', 'Speech bubbles with what each farmer last said. × hides one; its 💬 shows it again')}
              ${animals === null ? '' : tool('data-farm-animals', 'animals', 'Animals', animals ? 'on' : 'off', 'Animals on the farm, just for fun: click one to pet or feed it (or the pond, for the ducks). They never stand for anything')}
              ${tool('data-farm-sky', skyMode, 'Sky', skyMode, 'The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night')}
              ${tool('class="px-motion" data-farm-motion', still ? 'pause' : 'play', 'Motion', still ? 'off' : 'on', 'Walking and animation on the farm')}
              ${tool('data-farm-bell', 'bell', 'Bell', bell ? 'on' : 'off', 'A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)')}
              ${tool('class="px-info" data-farm-help aria-label="How to read the farm"', 'help', 'Help', '', 'How to read the farm')}
              <span class="px-zoombar" title="Zoom the farm inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in"><button type="button" data-farm-zoom="-1" aria-label="Zoom out">${pxt('-', '#4e3626', null)}</button><button type="button" data-farm-zoom="0" title="Show the whole farm">${pxt(`${Math.round(zoom * 100)}%`, '#4e3626', null)}</button><button type="button" data-farm-zoom="1" aria-label="Zoom in">${pxt('+', '#4e3626', null)}</button></span>
          </div>`;
      },
      bg(f, season, ext) { drawLand(f, L, season, ext); },
      ground() { drawScenery(); L.ST.forEach(drawPlot); L.ST.forEach(drawPiles); drawHens(PXG.T); }, // the hens last: on the beds they scratch in
      season: () => season,
      animals: () => ({ cast: FARM_ANIMALS, gags: FARM_GAGS, play: FARM_PLAY }),
      /** What a goat climbs ([x, y, lift]) and where gags go: the second hammock, the trough's bucket, a huddle in winter. */
      perches: () => [[WOODPILE.x, WOODPILE.y - 6, 6], [rockAt().x, rockAt().y - 3, 4]],
      spots: () => ({ hammock: NAPS[1], bucket: [TROUGH.x + 9, TROUGH.y], huddle: [56, 200 - 30], stall: [104, 102], barn: [62, 140], basket: [BASKET.x, BASKET.y - 1] }),
      /** Where the cats sleep long: their basket, and the moss at the wood's edge (both kept clear of the others: only a napper is let in). */
      dens: () => [[BASKET.x, BASKET.y - 1], [mossAt().x, mossAt().y]],
      /** Is a gag's spot free now: a hammock is taken while anyone naps (the nappers have the hammocks). */
      spotFree: name => (name === 'hammock' ? !scene.farmers.some(f => f.nap) : true),
      /**
       * Where the animals may walk: the yard, down to the fence's foot (not the lane, along the porch where farmers wait on you),
       * and a stretch of its path beside the hammocks: the pond and the hammocks lie right across the yard, and this is the way round them.
       */
      roam: () => [{ x: 4, y: 100, w: 100, h: Math.max(20, L.GRID.y1 - 104) }, { x: 104, y: 184, w: 17, h: 60 }],
      /** What they keep off in there: the pond (the ducks' own), the hammocks, the henhouse and its run, the shade tree's trunk, the cats' basket, the trees and moss at the wood's edge. */
      avoid: () => [{ x: 8, y: 194, w: 70, h: 32 }, { x: 84, y: 196, w: 24, h: 34 }, { x: 0, y: 95, w: 106, h: 44 }, { x: 60, y: L.GRID.y1 - 26, w: 14, h: 12 }, { x: BASKET.x - 10, y: BASKET.y - 6, w: 20, h: 9 }, woodAt()], // the run's hens are subagents; the basket and the wood's edge are the cats'
      /** Particles a farmer gives off: dust when walking; splashes, clods, sparks, chips from its tool. */
      emit(f, b, dt, add) {
        const tend = tending(f), dir = tend?.dir ?? 1, ox = dir > 0 ? b.x - 7 * SC : b.x + 7 * SC - 34 * SC, oy = b.y - 16 * SC, T = PXG.T; // ox: so that ox + 17 is where the tool meets the soil, either way it faces
        if (b.walk && !tend) {
          if (Math.random() < dt * 9) add({ x: b.x + rand(-3, 3), y: b.y - 0.5, vx: rand(-5, 5) - (b.face === 'right' ? 6 : b.face === 'left' ? -6 : 0), vy: rand(-9, -3), g: 18, life: 0.5, max: 0.5, size: rand(1, 2), color: '#c9a46a', alpha: 0.75 });
          const back = b.face === 'right' ? -1 : b.face === 'left' ? 1 : 0;
          if (f.fast && Math.random() < dt * 16) add({ x: b.x + back * 7, y: b.y - rand(3, 12), vx: back * 30, vy: 0, g: 0, life: 0.22, max: 0.22, size: 1, color: '#ffffff', alpha: 0.8 }); // fast mode: speed lines
          return;
        }
        if (f.state !== 'working') return;
        const prop = doing(f)?.prop;
        if (prop === 'can' && [1, 2].includes(beat(T, TOOL_RATE.can)) && Math.random() < dt * 10) add({ x: ox + 20 * SC + rand(-1, 1), y: b.y - 1, vx: rand(-14, 14), vy: rand(-22, -10), g: 90, life: 0.3, max: 0.3, size: 1, color: '#5ab4ff' });
        if ((prop === 'hoe' || prop === 'rake') && beat(T, TOOL_RATE[prop]) === 2 && Math.random() < dt * 14) add({ x: ox + 17 * SC, y: b.y - 1, vx: dir * rand(4, 18), vy: rand(-24, -12), g: 80, life: 0.45, max: 0.45, size: 1, color: '#5e3d22' });
        if (prop === 'hammer' && beat(T, TOOL_RATE.hammer) === 2 && Math.random() < dt * 14) add({ x: ox + 17 * SC, y: oy + 8 * SC, vx: rand(-20, 20), vy: rand(-26, -8), g: 70, life: 0.3, max: 0.3, size: 1, color: '#ffd43b' });
        if (prop === 'sickle' && beat(T, TOOL_RATE.sickle) === 2 && Math.random() < dt * 14) add({ x: ox + 17 * SC, y: b.y - 3, vx: dir * rand(6, 22), vy: rand(-20, -6), g: 50, life: 0.6, max: 0.6, size: 1, color: '#4f8f3a' });
        if ((prop === 'cart' || prop === 'barrow') && Math.random() < dt * 5) add({ x: ox + 17 * SC, y: b.y, vx: rand(-8, 4), vy: rand(-6, -2), g: 10, life: 0.6, max: 0.6, size: 1.5, color: '#c9a46a', alpha: 0.6 });
        if (prop === 'crate' && T % 1.6 < dt) for (let i = 0; i < 3; i++) add({ x: ox + 16 * SC, y: oy + 10 * SC, vx: rand(-10, 10), vy: rand(-18, -8), g: 40, life: 0.4, max: 0.4, size: 1, color: '#f4d58d' });
      },
      /** The farm's own particles: smoke from the chimney while agents work; petals, leaves or snow by the season. */
      ambient(dt, add) {
        for (const h of hens.values()) if (h.failed && h.moving && !h.dog && Math.random() < dt * 9) add({ x: h.x + rand(-2, 2), y: h.y - 4, vx: rand(-6, 6), vy: rand(-9, -3), g: 14, life: 1.1, max: 1.1, size: 1, color: h.codex ? '#b5763a' : '#ffffff', sway: 3 }); // a flustered hen loses feathers
        if (season === 'spring' && Math.random() < dt * 3) add({ x: rand(46, 88), y: rand(228, 260), vx: rand(3, 9), vy: rand(5, 9), g: 0, life: 3, max: 3, size: 1, color: '#f4b6c2', sway: 3 });
        if (season === 'autumn' && Math.random() < dt * 4) add({ x: rand(44, 90), y: rand(228, 262), vx: rand(2, 8), vy: rand(6, 11), g: 0, life: 3.2, max: 3.2, size: 1, color: ['#c8681a', '#e9a23b', '#b5562f'][Math.floor(rand(0, 3))], sway: 4 });
        const e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: L.H };
        if (season === 'winter' && Math.random() < dt * 28 * ((e.x1 - e.x0) / W)) add({ x: rand(e.x0, e.x1), y: e.y0 - 2, vx: rand(-2, 2), vy: rand(9, 16), g: 0, life: (e.y1 - e.y0) / 10, max: (e.y1 - e.y0) / 10, size: rand(1, 1.6), color: '#ffffff', sway: 2, alpha: 0.9 });
        if (scene.farmers.some(a => a.state === 'working') && Math.random() < dt * 2.2) {
          add({ x: 241 + rand(-1, 1), y: 11, vx: rand(2, 6), vy: rand(-8, -5), g: 0, life: 2.6, max: 2.6, size: 2, grow: 1.4, color: '#c3cbd2', alpha: 0.55 });
        }
      },
      /** Soft shadows on the ground under farmers and their animals, so nothing floats. */
      shadows(b) {
        PXG.ctx.globalAlpha = 0.32;
        const x = Math.round(b.x), y = Math.round(b.y);
        px(x - 4, y - 1, 9, 1, '#1c3320'); px(x - 6, y, 13, 1, '#1c3320'); px(x - 4, y + 1, 9, 1, '#1c3320');
        for (const d of b.kids) { const kx = Math.round(d.x), ky = Math.round(d.y); px(kx - 3, ky, 6, 1, '#1c3320'); }
        PXG.ctx.globalAlpha = 1;
      },
      /** Lights that glow at night: [x, y, reach, the lit shape]. */
      lights() {
        const coop = hens.size ? [[15, 117, 8, [13, 115, 5, 4]], [33, 117, 8, [31, 115, 5, 4]]] : []; // the henhouse's windows, while hens are out: someone is up
        return [[62, 54, 11, [61, 47, 2, 1]], [158, 56, 16, [148, 46, 20, 14, true]], [242, 56, 16, [232, 46, 20, 14, true]], [213, 66, 20, [213, 49, 2, 2]], ...coop];
      },
      /** A field's record for its close-up: what was done there in all, and the last half hour stretch by stretch, newest first. Plain HTML. */
      fieldNotes(key) {
        const farmers = scene.farmers.filter(a => a.field === key && a.state !== 'leaving'), tally = fieldTally(key), now = Date.now();
        if (!tally.total) return '';
        const runs = [];
        for (const ev of tally.timeline) { const g = groupOf(ev.step), last = runs.at(-1); if (last?.key === g[0]) { last.n++; last.failed += ev.ok ? 0 : 1; } else runs.push({ key: g[0], color: g[1], words: g[3], at: ev.at, n: 1, failed: ev.ok ? 0 : 1 }); }
        const chip = c => (c ? `<i class="fv-chip" style="background:${c}"></i>` : '');
        return `<div class="fv-rec"><b>What was done here</b><ul>${tallyLines(tally, farmers, now).map(l => `<li>${chip(l.color)}${esc(l.text)}</li>`).join('')}</ul>${runs.length ? `<b>The last half hour</b><ol>${runs.slice(-10).reverse().map(r => `<li>${chip(r.color)}${esc(spanText(now - r.at))} ago: ${esc(r.words)} × ${r.n}${r.failed ? ` <em>(${r.failed} failed)</em>` : ''}</li>`).join('')}</ol>` : ''}</div>`;
      },
      /** Where the subagents' animals are (the engine's own followers are not drawn here): for the animals that notice them. */
      chickens: () => [...hens.values()].filter(h => !h.fresh || h.path.length).map(h => ({ x: h.x, y: h.y, id: h.id, phase: h.phase, want: h.want })),
      /** What the henhouse's labels say, besides the fields': how many are out, and which eggs lie in the nest. */
      labelKey: () => `${hens.size}|${eggsOf().map(s => s.id).join(',')}|${[...works.keys(), ...ghosts.keys()].join()}|${L.ST.map(s => { const t = fieldTally(s.key); return `${t.total}.${t.failed}.${t.lastTest?.at ?? 0}`; }).join()}`,
      /** By day, butterflies and birds, and cloud shadows drift over the farm; at night, fireflies over the yard. */
      weather(sky) {
        night = sky.phase === 'night';
        const T = PXG.T, e = PXG.ext ?? { x0: 0, x1: W, y0: 0, y1: L.H }, EW = e.x1 - e.x0 + 160;
        if (sky.light > 0.5 && (season === 'spring' || season === 'summer')) [[40, 160, '#ffffff'], [80, 150, '#ffd43b'], [60, 186, '#f08a24']].forEach(([bx, by, c], i) => {
          const x = Math.round(bx + Math.sin(T * 0.5 + i * 2.1) * 22 + Math.sin(T * 1.7 + i) * 4), y = Math.round(by + Math.sin(T * 0.8 + i * 1.3) * 10 + Math.sin(T * 3 + i) * 2), open = blink(6 + i);
          px(x - (open ? 2 : 1), y, open ? 2 : 1, 2, c); px(x + 1, y, open ? 2 : 1, 2, c); px(x, y, 1, 2, '#1b1420');
        });
        if (sky.light > 0.4 && season !== 'winter') { // birds on the fields' fence, now and then off to another post
          const posts = [[150, 88], [196, 88], [246, 88], [276, 88], [330, 88], [372, 88], [128, 140], [396, 180]];
          for (let i = 0; i < 3; i++) {
            const cycle = (T + i * 7.3) / 14, seg = Math.floor(cycle), ph = cycle - seg, [ax, ay] = posts[(seg * 3 + i * 5) % posts.length], [bx, by] = posts[((seg + 1) * 3 + i * 5) % posts.length];
            let x = ax, y = ay - 1, flying = false;
            if (ph > 0.86) { const t = (ph - 0.86) / 0.14; x = Math.round(ax + (bx - ax) * t); y = Math.round(ay + (by - ay) * t - Math.sin(t * Math.PI) * 18) - 1; flying = true; }
            const hop = !flying && Math.floor(T * 2 + i) % 7 === 0 ? 1 : 0;
            px(x - 2, y - 2 - hop, 4, 2, '#6b4320'); px(x + 1, y - 3 - hop, 2, 2, '#6b4320'); px(x + 3, y - 2 - hop, 1, 1, '#f0b429'); px(x - 1, y - 1 - hop, 2, 1, '#c98d4f');
            if (flying) px(x - 2, y - 4 + blink(10) * 3, 3, 1, '#4e3626');
          }
        }
        if (sky.light > 0.3) {
          PXG.ctx.globalAlpha = 0.09 * sky.light;
          for (const [ox, y, r, sp] of [[60, 70, 28, 2.2], [300, 210, 34, 1.6], [520, 140, 24, 2.8]]) cloudShadow(e.x0 - 80 + ((ox + T * sp) % EW), y, r);
          PXG.ctx.globalAlpha = 1;
        }
        if (sky.light < 0.5) FIREFLIES.forEach(([bx, by], i) => {
          if ((Math.floor(T * 1.4 + i * 0.37) + i) % 3 === 0) return;
          const x = Math.round(bx + Math.sin(T * 0.7 + i * 1.7) * 6), y = Math.round(by + Math.cos(T * 0.9 + i) * 4);
          PXG.lights?.push([x, y, 3, [x, y, 1, 1]]);
        });
      },
      fieldAt(x, y) { return L.ST.find(s => Math.abs(x - s.cx) <= 40 && y >= s.rowTop && y <= s.rowTop + 56)?.key ?? null; },
      /** The building at a farm point, if any: each opens something. */
      buildingAt(x, y) {
        const at = ([x0, y0, x1, y1]) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
        return [['barn', [36, 12, 88, 80]], ...silos().slice(1).map(s => ['silo', [s.x, 4, s.x + 20, 80]]), ['silo', [92, 4, 112, 80]], ['board', [111, 58, 128, 82]], ['house', [132, 8, 268, 66]], ['stall', [STALL.x - 1, STALL.y - 1, STALL.x + 29, STALL.y + 34]], ['henhouse', [6, 96, 100, 136]]].find(([, box]) => at(box))?.[0] ?? null;
      },
      buildingTip: k => ({ barn: 'The barn: start a new session or resume one (the new farmer comes out of the farmhouse)', silo: 'The silo: your plan\'s usage (with Codex running too, a second one stands left of the barn)', board: 'The notice board: what your projects remember (CLAUDE.md and memory)', house: 'The farmhouse: who is on your porch', stall: 'The market stall: pull requests', henhouse: 'The henhouse: subagents' })[k] ?? '',
      /** What a building shows when clicked: { title, html }. */
      dialog(k) {
        if (k === 'house') {
          const list = scene.farmers.filter(f => f.state === 'waiting' || f.state === 'turn');
          return { title: 'Your porch', html: list.length ? `<ul class="px-dl">${list.map(f => `<li><button type="button" class="act" data-farm-pick="${esc(f.id)}">Open</button><span><b>${esc(f.name)}</b> ${esc(f.state === 'waiting' ? (f.planAsk ? 'has a plan for you to approve' : `needs you: ${f.ask}`) : f.question ? `asks: ${f.question}` : `finished${f.reply ? `: ${f.reply}` : ''}`)}</span></li>`).join('')}</ul>${albumHtml()}` : `<p class="muted">Nobody is waiting on you.</p>${albumHtml()}` };
        }
        if (k === 'silo') {
          const name = w => ({ five_hour: '5-hour limit', seven_day: 'Weekly limit' })[w.kind] ?? w.kind, all = silos(), many = all.length > 1;
          const meter = w => { const pct = w.reset ? 0 : Math.round(w.percentUsed); return `<div class="px-meter"><b>${esc(name(w))}</b><span class="bar"><i style="width:${Math.min(100, pct)}%"></i></span><span>${w.reset ? 'just reset' : `${pct}% used`}${w.resetsAt ? ` · resets ${esc(new Date(w.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' }))}` : ''}</span></div>`; };
          const extra = s => [s.plan.planType && `${s.plan.planType} plan`, s.plan.credits != null && `${Math.round(s.plan.credits).toLocaleString()} credits left`].filter(Boolean).join(' · ');
          const part = s => `${many || s.who !== 'claude' ? `<p><b>${esc(s.name)}</b>${extra(s) ? ` <span class="muted">${esc(extra(s))}</span>` : ''}</p>` : ''}${s.plan.windows.map(meter).join('')}`;
          return { title: many ? 'The silos: your plans' : 'The silo: your plan', html: all.length
            ? `${all.map(part).join('')}<p class="muted">The grain is the week; the season is Claude's 5-hour limit (winter when it is nearly used up).${scene.plan ? '' : " No reading of Claude's plan yet: it comes from the mod in a running Claude Code session."}</p>`
            : "<p class=\"muted\">No reading of a plan yet: Claude's comes from the mod in a running session, Codex's from its own sessions.</p>" };
        }
        if (k === 'henhouse') {
          const subs = scene.subagents ?? [];
          return { title: 'The henhouse: subagents', html: subs.length ? `<ul class="px-dl">${subs.slice(0, 40).map(c => `<li><i class="px-dot st-${esc(c.state)}"></i><span><b>${esc(c.parent)}</b> ${esc(c.label || 'a subagent')}${c.type ? ` <em>${esc(c.type)}</em>` : ''} · ${esc(c.state)}</span></li>`).join('')}</ul>` : '<p class="muted">No subagents lately.</p>' };
        }
        if (k === 'stall') {
          const link = pr => (typeof pr.url === 'string' && pr.url.startsWith('https://github.com/') ? `<a href="${esc(pr.url)}" target="_blank" rel="noopener">#${pr.number}</a>` : `#${pr.number}`);
          const checks = pr => (pr.draft ? 'draft' : { ok: '✓ checks pass', failed: '✗ checks failed', running: '◌ checks running' }[pr.checks] ?? 'no checks');
          const repos = scene.fields.filter(fl => fl.prs);
          return { title: 'The market stall: pull requests', html: repos.length ? repos.map(fl => `<h4>${esc(fl.name)}</h4><ul class="px-dl">${(fl.prs.open ?? []).map(pr => `<li><span>${link(pr)} ${esc(pr.title)} <em class="ck-${esc(pr.draft ? 'draft' : pr.checks ?? 'none')}">${checks(pr)}</em></span></li>`).join('') || '<li class="muted">No open pull requests.</li>'}${(fl.prs.merged ?? []).map(m => `<li class="muted"><span>${link(m)} merged${m.at ? ` ${ago(m.at)} ago` : ''}: ${esc(m.title)}</span></li>`).join('')}</ul>`).join('') : '<p class="muted">No pull requests to show: the repos here have no GitHub origin, or gh is not signed in.</p>' };
        }
        return null;
      },
      /** The projects whose memory the notice board shows: one session in each folder. */
      boardSessions: () => [...new Map(scene.farmers.filter(f => f.kind !== 'codex' && f.cwd).map(f => [f.cwd, f])).values()].slice(0, 8),
      /** The MCP carts, sorted with the farmers by how far down they stand. */
      items() {
        return placeCarts().map(c => {
          const s = carts.get(c.server), [hx, hy] = RANK[rankOf.get(c.server)];
          const x = Math.round(s?.x ?? hx), y = Math.round(s?.y ?? hy);
          return [y, () => drawCart(x, y, s?.dir ?? -1, s?.moving, CRATES[hashOf(c.server) % CRATES.length])];
        });
      },
      /** Each frame, after the farmers have moved: each cart drives towards where cartGoal sends it (or is put there, when the farm stands still). */
      tick(dt, posOf, snap = false) {
        const now = Date.now();
        let moved = false;
        frozen = snap;
        if (snap) { works.clear(); for (const f of leavers.values()) f.gone = true; } // motion off: fields just stand or are gone, leavers are in
        else {
          for (const [key, w] of [...works]) {
            const b = posOf(w.by);
            if (!b || now - w.at > WORK_MAX_MS) { works.delete(key); moved = true; } // its farmer is not out on the farm (the resting ones hidden), or it has gone on too long: done at once
            else moved = stepWork(key, w, b) || moved;
          }
          for (const f of leavers.values()) { const b = posOf(f.id); if (!b) f.gone = true; else moved = stepLeaver(f, b) || moved; }
        }
        for (const f of leavers.values()) if (f.gone && scene.farmers.includes(f)) { scene.farmers.splice(scene.farmers.indexOf(f), 1); moved = true; } // in: off the farm, and out of its counts
        onMap.clear();
        for (const f of scene.farmers) { const b = posOf(f.id); if (b) { onMap.add(f.id); seenAt.set(f.id, [b.x, b.y]); } }
        for (const f of leavers.values()) if (f.hold && now >= f.hold) { f.hold = 0; moved = true; } // its hens are off home: now it goes
        for (const id of seenAt.keys()) if (!onMap.has(id)) seenAt.delete(id);
        if (stepHens(dt, posOf, snap)) moved = true;
        for (const [id, r] of rounds) { // a round goes on: at its point, the farmer turns to the next
          const f = farmerOf(id), b = posOf(id), s = stOf(r.key);
          if (!f || f.state !== 'working' || !s) { rounds.delete(id); moved = true; continue; }
          if (!b || snap) continue;
          const pts = roundPoints(s, r.go), [tx, ty] = pts[r.i];
          if (b.path.length || Math.hypot(b.x - tx, b.y - ty) > 0.75) continue;
          r.on = true;
          r.i = (r.i + 1) % pts.length;
          if (Math.abs(pts[r.i][0] - tx) > 1) r.dir = pts[r.i][0] > tx ? 1 : -1;
          moved = true;
        }
        for (const c of placeCarts()) {
          const home = RANK[rankOf.get(c.server)];
          let s = carts.get(c.server);
          if (!s) carts.set(c.server, (s = { x: home[0], y: home[1], path: [], to: home, dir: -1 }));
          const b = c.busy ? posOf(c.busy) : null;
          const goal = cartGoal(s, b ? besideOf(b) : null, home, now);
          if (goal[0] !== s.to[0] || goal[1] !== s.to[1]) { s.to = goal; s.path = cartRoute([s.x, s.y], goal); }
          if (snap) { // no motion: it stands where it is going, facing the farmer (or the farm, in its place)
            [s.x, s.y] = goal;
            s.path = [];
            s.dir = b && s.goal ? (goal[0] > (Number.isFinite(b.tx) ? b.tx : b.x) ? -1 : 1) : -1;
          }
          if (s.path.length) {
            const [qx, qy] = s.path[0], dx = qx - s.x, dy = qy - s.y, d = Math.hypot(dx, dy), sp = CART_SPEED * dt;
            if (Math.abs(dx) > 0.1) s.dir = Math.sign(dx);
            if (d <= sp) { s.x = qx; s.y = qy; s.path.shift(); } else { s.x += (dx / d) * sp; s.y += (dy / d) * sp; }
          } else if (s.goal && s.arrivedAt == null) s.arrivedAt = now; // there: it waits (cartGoal says how long)
          else if (!s.goal) s.dir = -1; // back in its place, facing the farm
          s.moving = s.path.length > 0;
        }
        return moved; // a farmer has somewhere new to go: the engine asks slots() again
      },
      drawChar(f, b) {
        const look = b.hatless ? { ...f.look, hat: 'none' } : f.look; // a goat has its hat
        if (b.zone === 'nap' && !b.walk) { // lying in its hammock, head to the left, the cloth round it
          const ctx = PXG.ctx, cx = Math.round(b.x), y = Math.round(b.y);
          ctx.save(); ctx.translate(cx, y - 10); ctx.rotate(-Math.PI / 2);
          ctx.drawImage(farmerSprite(look, SHIRT[f.color], false, 's', false, 'down'), -8, -7, 14 * SC, 16 * SC);
          ctx.restore();
          for (let i = 3; i <= 21; i++) { const sag = Math.round(Math.sin((i / 24) * Math.PI) * 4); px(cx - 12 + i, y - 9 + sag, 1, 2, '#d55181'); px(cx - 12 + i, y - 7 + sag, 1, 1, '#8a5fc0'); }
          return;
        }
        if (b.walk) walkers.push([b.x, b.y]); // the porch cat makes way for whoever walks up to it
        if (b.walk && Math.abs(b.x - HOUSE_DOOR.x) < 3 && b.y >= HOUSE_DOOR.y1 && b.y < PORCH_Y) doorAt = PXG.T; // in the doorway, or crossing the boards from it
        const scare = isScare(f), tend = tending(f), p = b.walk ? null : porchOf().who.get(f.id), sat = isSat(p);
        const [ox0, oy0] = tend ? tendOrigin(f, b) : pixelOrigin(b, 16), ox = ox0 + (sat ? swayOf(p.seat) : 0), oy = oy0 - (sat ? SEAT_UP : 0), rp = rpAt(ox, oy);
        if (scare) { rp(0, 10, 14, 1, '#6b4320'); rp(-1, 9, 2, 3, '#d8c48a'); rp(13, 9, 2, 3, '#d8c48a'); }
        const view = tend ? (tend.dir > 0 ? 'right' : 'left') : b.walk ? b.face ?? 'down' : 'down'; // at its bed it faces along the row it works
        const legs = tend ? (Math.floor((b.x + b.y) / 3) % 2 ? 'a' : 'b') : scare ? 'p' : sat ? 'sit' : p?.stage === 'tap' && blink(6) && !blink(0.5) ? 'a' : legFrame(b); // a foot tapping, a second in two
        PXG.ctx.drawImage(farmerSprite(look, SHIRT[f.color], scare, legs, f.state === 'waiting' ? 1 : sat ? ARMS_UP[doingOnPorch(f, p)] ?? 0 : 0, view), ox, oy, 14 * SC, 16 * SC);
        if (scare) { rp(5, 6, 1, 1, '#3a2a1a'); rp(8, 6, 1, 1, '#3a2a1a'); rp(5, 7, 4, 1, '#7a5230'); rp(6, 11, 2, 2, '#c97b4a'); return; }
        if (f.family && !b.hatless) { rp(9, 2, 2, 2, FAMILY_PIN[f.family]); rp(9, 2, 1, 1, '#ffffff'); } // its model's pin on the hat
        if (f.mode === 'bypassPermissions') { for (let i = 0; i < 6; i++) rp(4 + i, 9, 1, 1, i % 2 ? '#ffffff' : '#e04a3a'); rp(9, 10, 1, 2, '#e04a3a'); } // no permission checks: a hazard scarf
        if (view === 'up') return; // from behind: no face
        if (f.cost >= 1) { const big = f.cost >= 10, gold = f.cost >= 50; rp(1, big ? 11 : 12, big ? 3 : 2, big ? 3 : 2, gold ? '#c9a24a' : '#8b5a2b'); rp(2, big ? 11 : 12, 1, 1, '#ffd43b'); } // its purse: what it has cost
        if (view === 'left' || view === 'right') { rp(view === 'right' ? 9 : 4, 6, 1, 1, K); return; }
        const ex = 5;
        const blinking = ((PXG.T + (f.color ?? 0) * 0.37) % 3.7) < 0.12; // now and then, each farmer on its own beat
        const dozing = sat && doingOnPorch(f, p) === 'doze';
        if (dozing && look.hat !== 'none') rp(3, 5, 8, 1, look.hatColor); // its hat tipped over its eyes
        if ((f.state === 'idle' && !b.walk) || blinking || dozing) { rp(ex, 6, 1, 1, '#8a5a3a'); rp(ex + 3, 6, 1, 1, '#8a5a3a'); if (f.state === 'idle' || dozing) return; } // eyes closed
        if (blinking) return;
        const ey = f.state === 'working' && !b.walk ? 7 : 6;
        if (f.state === 'turn' && !b.walk) { rp(ex - 1, ey, 2, 1, K); rp(ex + 3, ey, 2, 1, K); rp(ex + 1, 7, 2, 1, '#b5562f'); }
        else { rp(ex, ey, 1, f.state === 'waiting' ? 2 : 1, K); rp(ex + 3, ey, 1, f.state === 'waiting' ? 2 : 1, K); }
      },
      drawFx(f, b) {
        const tend = tending(f), still = !b.walk || Boolean(tend); // at its bed it is at work, though it moves
        const [ox, oy] = tend ? tendOrigin(f, b) : pixelOrigin(b, 16), T = PXG.T;
        let rp = rpAt(ox, oy);
        if (f.hot) { rp(11, 3 + Math.floor((T * 6) % 4), 1, 2, '#a9dcf7'); rp(2, 4 + Math.floor((T * 6 + 2) % 4), 1, 2, '#a9dcf7'); rp(4, 7, 1, 1, '#ff6b6b'); rp(9, 7, 1, 1, '#ff6b6b'); }
        if (b.zone === 'nap' && !b.walk) { // asleep until its wake-up: zzz, and a little clock
          const x = Math.round(b.x), y = Math.round(b.y), zy = y - 20 - Math.floor((T * 2) % 4);
          PXG.ctx.globalAlpha = 0.85; px(x + 6, zy, 3, 1, '#e6eef5'); px(x + 7, zy + 1, 1, 1, '#e6eef5'); px(x + 6, zy + 2, 3, 1, '#e6eef5'); PXG.ctx.globalAlpha = 1;
          px(x - 15, y - 25, 7, 7, '#4e3626'); px(x - 14, y - 24, 5, 5, '#f4ecd8'); px(x - 12, y - 23, 1, 2, '#1b1420'); px(x - 12, y - 22, 2, 1, '#1b1420');
          return;
        }
        if (f.state === 'working' && still && !jobOf(f.id)) { // its tool, held: turned the way it faces
          const act = doing(f), left = tend?.dir < 0;
          if (act) drawProp(act.prop, left ? (x, y, w, h, c) => rp(14 - x - w, y, w, h, c) : rp, T, act.flag, { shirt: f.shirt ?? SHIRT[f.color] ?? '#3c5a99', skin: f.look?.skin ?? '#f1c7a1' });
        }
        if (f.thinking && still) { // between steps, the model is thinking: a thought cloud, its dots filling in
          const ph = Math.floor(T * 3) % 4;
          rp(10, 0, 1, 1, '#e6eef5'); rp(11, -2, 2, 2, '#e6eef5');
          rp(12, -10, 10, 7, '#9aa4ad'); rp(13, -11, 8, 9, '#9aa4ad'); rp(13, -9, 8, 5, '#ffffff'); rp(14, -10, 6, 7, '#ffffff');
          for (let i = 0; i < 3; i++) rp(14 + i * 2, -7, 1, 1, i < ph ? '#5f6b7a' : '#c3cbd2');
        }
        if (f.tasks?.total && f.state === 'working' && still) { // its chore board: the task list, ticked as items are done
          const t = f.tasks, rows = Math.min(3, t.total), done = Math.round((t.done / t.total) * rows), plain = rp;
          if (tend?.dir < 0) rp = (x, y, w, h, c) => plain(14 - x - w, y, w, h, c); // behind it, whichever way it faces
          rp(-6, 9, 1, 6, '#6b4320'); rp(-10, 2, 8, 8, '#4e3626'); rp(-9, 3, 6, 6, '#fff4d6');
          for (let r = 0; r < rows; r++) { rp(-8, 4 + r * 2, 1, 1, r < done ? '#2fa57a' : '#9aa4ad'); rp(-6, 4 + r * 2, 2, 1, '#c9b48a'); }
          rp(-10, 11, 8, 1, '#4e3626'); rp(-10, 11, Math.max(t.done ? 1 : 0, Math.round((8 * t.done) / t.total)), 1, '#6cc04a');
          rp = plain;
        }
        if (f.state === 'waiting') {
          const p = b.walk ? null : porchOf().who.get(f.id);
          if (p) saw(p.stage);
          if (p && stageRank('desk', p.stage) >= 2) { const sw = blink(6); rp(9 + sw, 1, 3, 3, '#ffd43b'); rp(10 + sw, 0, 1, 1, '#c9a24a'); rp(10 + sw * 2, 4, 1, 1, '#8a7140'); if (blink(3)) { rp(7, 0, 1, 1, '#ffffff'); rp(7, 4, 1, 1, '#ffffff'); } } // it rings a hand bell for you
          bubble(rp, 12, -7 - blink(3), f.planAsk ? 'plan' : '!');
          const x = Math.round(b.x), y = Math.round(b.y); // a ring at its feet that pulses: it needs you
          PXG.ctx.globalAlpha = 0.45 + 0.35 * Math.sin(PXG.T * 5);
          px(x - 6, y + 2, 13, 1, '#e04a3a'); px(x - 8, y + 1, 2, 1, '#e04a3a'); px(x + 7, y + 1, 2, 1, '#e04a3a'); px(x - 8, y - 1, 1, 2, '#e04a3a'); px(x + 8, y - 1, 1, 2, '#e04a3a');
          PXG.ctx.globalAlpha = 1;
        }
        if (f.state === 'turn') { // a basket of produce
          if (b.walk) { rp(3, 10, 8, 4, '#a8703c'); rp(3, 10, 8, 1, '#c98d4f'); rp(4, 9, 2, 1, '#e04a3a'); rp(7, 9, 2, 1, '#f08a24'); rp(6, 8, 1, 1, '#3f9b3a'); }
          else {
            const p = porchOf().who.get(f.id), sat = isSat(p), w = sat ? 6 : 10, h = sat ? 4 : 6, x = Math.round(b.x) + (sat ? 6 : 7), y = Math.round(b.y) - h; // seated: a small one, by its seat
            px(x, y, w, h, '#a8703c'); px(x, y, w, 1, '#c98d4f'); px(x, y + h - 1, w, 1, '#6b4320'); if (sat) { px(x + 1, y - 2, 2, 2, '#e04a3a'); px(x + 3, y - 2, 2, 2, '#f08a24'); } else { px(x + 1, y - 2, 3, 2, '#e04a3a'); px(x + 4, y - 3, 3, 3, '#f08a24'); px(x + 7, y - 2, 2, 2, '#e9c46a'); px(x + 5, y - 4, 1, 1, '#3f9b3a'); }
            if (sat) drawSitter(f, p, rpAt(rp.ox + swayOf(p.seat), rp.oy - SEAT_UP), T); // its tick, or its question for you, is at its name tag's corner (tagBadge)
          }
        }
        if (jobOf(f.id) || f.packed) drawCarried(f, rp, T);
        const sur = porch.surprise;
        if (sur?.key === 'bird' && sur.who.includes(f.id) && !b.walk) { // a bluebird flies in, sits on its hat a while, flies off: on anyone on the porch
          const d = Math.round((1 - Math.min(1, sur.t / 0.15, (1 - sur.t) / 0.15)) * 10);
          saw('bird');
          birdOn(rpAt(rp.ox + d * SC, rp.oy - (d + (isSat(porch.who.get(f.id)) ? SEAT_UP : 0)) * SC), blink(2), '#3d7be0');
        }
        if (f.state === 'idle' && !b.walk) zzz(rp, T, 11);
        if (isScare(f)) birdOn(rp, blink(1.5), '#1b1420'); // crow on the hat
        if (PXG.T - (whistled.get(f.id) ?? -9) < 2.2 && !b.walk) drawProp('whistle', rp, T); // it calls a hen out of the henhouse
      },
      /** Labels that move with what they name: the carts on the road, the MCP carts out of their shed, the hammocks' wake-up times. */
      movers(posOf) {
        const out = [];
        for (const h of hens.values()) { // each hen out of the coop: its task on hover; a click opens its farmer's subagents
          const s = subOf(h.id), f = farmerOf(h.by);
          if (!s || (h.fresh && !h.path.length)) continue;
          const tip = `${f ? `${f.name}'s ${h.dog ? 'dog' : 'hen'}` : h.dog ? 'A dog' : 'A hen'}: ${henText(s)}${s.background ? ' (in the background)' : ''}`;
          out.push({ key: `hen:${h.id}`, cls: 'spot', x: h.x, y: h.y + 2, title: tip, html: `<button type="button" class="px-spot"${f && f.state !== 'leaving' ? ` data-farm-pick="${esc(h.by)}" data-farm-tab="subagents"` : ''} aria-label="${esc(tip)}"><span>${pxt(clip(henText(s), 48), '#5a3a1a', null)}</span></button>` });
        }
        for (const c of scene.carts ?? []) {
          const s = carts.get(c.server);
          if (!s || (!s.goal && !s.moving)) continue; // waiting in its place
          const who = c.busy ? scene.farmers.find(f => f.id === c.busy) : null;
          out.push({ key: `mcp:${c.server}`, x: s.x, y: s.y - 9, html: pxt(cutMid(c.server, 16), '#5a3a1a', null), title: `${c.server}, an MCP server${who ? `: ${who.name} is calling it` : ''}` });
        }
        for (const f of scene.farmers) {
          const c = cartOf(f);
          if (c) out.push({ key: `cart:${f.id}`, x: c.x, y: LANE - 5, html: pxt(clip(f.service, 18), '#5a3a1a', null), title: `${f.name}: ${f.summary || f.service}` });
          const b = posOf(f.id);
          if (f.nap && f.wakeAt && b?.zone === 'nap' && !b.walk) out.push({ key: `nap:${f.id}`, x: b.x - 11, y: b.y - 26, html: pxt(`wakes in ${until(f.wakeAt)}`, '#5a3a1a', null), title: `${f.name} wakes up by itself at ${new Date(f.wakeAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` });
        }
        return out;
      },
      top() {
        const T = PXG.T, sur = porchOf().surprise;
        if (sur?.key === 'star') { const x = Math.round(70 + sur.t * 220), y = Math.round(3 + sur.t * 12); saw('star'); px(x, y, 2, 1, '#ffffff'); PXG.ctx.globalAlpha = 0.5; px(x - 5, y - 1, 5, 1, '#fff3a6'); PXG.ctx.globalAlpha = 1; }
        for (const f of scene.farmers) { // carts to town and back, one for each web call going on
          const c = cartOf(f);
          if (!c) continue;
          const { x, dir } = c, y = LANE + 4, step = blink(6), pony = x + dir * 7;
          px(x - 4, y + 2, 9, 1, '#3f7d3a'); // its shadow on the road
          px(x - 4, y - 4, 8, 4, '#a8703c'); px(x - 4, y - 4, 8, 1, '#c98d4f'); px(x - 2, y - 7, 4, 3, f.step === 'web' ? '#f4ecd8' : '#c9a46a'); px(x - 2, y - 7, 4, 1, f.step === 'web' ? '#ffffff' : '#e2b07a');
          px(x - 3, y, 2, 2, '#4e3626'); px(x + 2, y, 2, 2, '#4e3626');
          px(pony - 3, y - 4, 6, 3, '#8b5a2b'); px(pony + dir * 3 - (dir < 0 ? 1 : 0), y - 6, 2, 3, '#8b5a2b'); px(pony + dir * 4 - (dir < 0 ? 0 : 1), y - 5, 1, 1, '#1b1420');
          px(pony - 3 + step, y - 1, 1, 2, '#6b4320'); px(pony + 1 - step, y - 1, 1, 2, '#6b4320'); px(pony - dir * 4, y - 4, 1, 2, '#4e3626');
        }
        for (const s of L.ST) {
          const weather = fieldByKey(s.key).weather;
          if (weather === 'rainbow') { // deploy passed: a rainbow across the field
            PXG.ctx.globalAlpha = 0.5;
            ['#e04a3a', '#f08a24', '#ffd43b', '#6cc04a', '#3d7be0', '#8a5fc0'].forEach((c, j) => { const r = 40 - j * 2; for (let ang = 182; ang <= 358; ang += 2.5) { const t = ang * Math.PI / 180; px(Math.round(s.cx + Math.cos(t) * r), Math.round(s.rowTop + 36 + Math.sin(t) * r * 0.6), 2, 2, c); } });
            PXG.ctx.globalAlpha = 1;
            if ((Math.floor(T * 3) + s.cx) % 7 === 0) { const sx = s.cx - 30 + ((s.cx * 13 + Math.floor(T * 3) * 17) % 60), sy = s.rowTop + 14; px(sx, sy - 1, 1, 3, '#ffffff'); px(sx - 1, sy, 3, 1, '#ffffff'); }
          } else if (weather === 'windmill') { // deploy running
            const hx = s.cx - 2, hy = s.rowTop - 4;
            px(hx - 2, hy, 5, 13, '#e8d8b0'); px(hx - 3, hy - 2, 7, 2, '#9c3b30'); px(hx, hy + 8, 1, 4, '#6b4320');
            for (let i = 0; i < 4; i++) { const t = T * 3 + i * Math.PI / 2; for (let r = 2; r <= 8; r++) px(Math.round(hx + Math.cos(t) * r), Math.round(hy + 1 + Math.sin(t) * r), 1, 1, r > 4 ? '#ffffff' : '#c9b48a'); }
          } else if (weather === 'rain') { // deploy failed: a dark cloud drifts over the field and rain falls on all of it
            const x0 = s.x0, cx = Math.round(s.cx - 22 + Math.sin(T * 0.5) * 10), cy = s.rowTop + 2;
            PXG.ctx.globalAlpha = 0.18; oval(px, cx + 22, s.rowTop + 30, 22, 5, '#1c3320'); PXG.ctx.globalAlpha = 1;
            for (let i = 0; i < 18; i++) {
              const ph = (T * 1.6 + (i * 0.37) % 1) % 1, x = x0 + 2 + ((i * 47) % 70) - Math.round(ph * 3), y = cy + 10 + ph * 40;
              if (ph < 0.92) { px(x, Math.round(y), 1, 3, '#5ab4ff'); } else { px(x - 1, s.rowTop + 46, 3, 1, '#a9dcf7'); } // a drop, then its splash
            }
            drawCloud(cx, cy + 1, 44, ['#9aa4ad', '#5f6b7a', '#3a3a40']);
          }
        }
      },
      labels(lab, overflow) {
        const { ST, more } = L;
        const cnt = t => pxt(t, '#5a3a1a', null); // a count on a cream tag
        for (const s of ST) {
          const f = fieldByKey(s.key);
          if (works.has(s.key) || ghosts.has(s.key)) continue; // its sign goes up when it stands
          const branch = f.branch === '(detached)' ? ` ${pxt('?', '#c3cbd2')}` : f.branch && !isMain(f.branch) ? ` ${pxt(clip(f.branch, 12), '#c3cbd2')}` : '';
          const d = f.lastDeploy;
          const weather = d ? pxt(d.label, { ok: '#8ef0a0', failed: '#ff8a80', running: '#ffd166' }[d.state] ?? '#c9b48a') : '';
          const tip = [f.key, f.branch && `on ${f.branch}`, d?.detail, 'Click to see the files agents touched here'].filter(Boolean).join(' · ');
          const second = [f.worktree && f.main ? pxt(`worktree of ${f.main.split('/').pop()}`, '#a9dcf7') : '', weather, f.collision ? ` ${pxt('⚠ crowded', '#ffd166')}` : ''].filter(Boolean).join(' ');
          lab(s.cx, s.rowTop + 49, `<button type="button" class="px-field" data-farm-field="${esc(f.key)}" title="${esc(tip)}"><span class="px-fl">${pxt(cutMid(f.name, 16), f.collision ? '#ffd166' : '#e6eef5')}${branch}</span>${second ? `<span class="px-fl">${second}</span>` : ''}</button>`, f.collision ? 'bad' : '');
          const tally = fieldTally(s.key);
          if (tally.total) { // the slate's own words, on hover: what was done here, group by group; a click opens the field
            const lines = tallyLines(tally, scene.farmers.filter(a => a.field === s.key && a.state !== 'leaving'), Date.now());
            lab(s.x0 + 63, s.y0 + 13, `<button type="button" class="px-spot" data-farm-field="${esc(f.key)}" aria-label="${esc(lines.map(l => l.text).join('. '))}"><span>${lines.map(l => `<i>${l.color ? `<u class="px-chip" style="background:${l.color}"></u>` : ''}${pxt(clip(l.text, 64), '#5a3a1a', null)}</i>`).join('')}</span></button>`, 'spot', lines.map(l => l.text).join('\n'));
          }
          if (f.behind > 0) lab(s.cx - 40, s.rowTop - 8, cnt(`↓${f.behind}`), 'cnt', `${f.behind} commit${f.behind === 1 ? '' : 's'} behind the remote`);
          if (f.ahead > 0) lab(s.cx - 23, s.rowTop + 3 - Math.ceil(Math.min(f.ahead, 16) / 8) * 6, cnt(`↑${f.ahead}`), 'cnt', `${f.ahead} unpushed commit${f.ahead === 1 ? '' : 's'}`);
          if (f.dirty > 0) lab(s.cx + 25, s.rowTop + 3 - Math.ceil(Math.min(f.dirty, 12) / 9) * 6, cnt(`+${f.dirty}`), 'cnt', `${f.dirty} uncommitted file${f.dirty === 1 ? '' : 's'}`);
        }
        if (!ST.length) lab(262, 150, pxt('No fields yet: no agent has touched a repo in the last 30 minutes', '#fff3d6', '#4e3626'), 'zone');
        const all = silos();
        for (const s of all) { // each silo's week at its foot; with two, whose it is
          const text = all.length > 1 ? `${s.name} ${s.label}` : s.label;
          lab(s.x + 10, 80, s.lamp === 'red' ? pxt(text, '#ffffff', null) : cnt(text), `cnt${s.lamp ? ` silo-${s.lamp}` : ''}`, `${s.name}'s silo: its plan's weekly limit, ${s.label} used${s.resetsAt ? `, resets ${new Date(s.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`);
        }
        const eggs = eggsOf(), out = [...hens.values()].filter(h => h.phase !== 'home').length;
        if (out || eggs.length) lab(70, 103, cnt([out && `${out} out`, eggs.length && `${eggs.length} egg${eggs.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')), 'cnt', 'The henhouse: subagents at work now (its hens, out on the farm or waiting in the run), and those that finished within the hour (the eggs in the nest). Click the henhouse for the list');
        eggs.forEach((s, i) => lab((s.type === 'Explore' ? NEST.bone(i) : NEST.egg(i)) + 2, s.type === 'Explore' ? 141 : 133, '', 'egg', `${s.parent ? `${s.parent}: ` : ''}${henText(s)}${s.result ? ` → ${s.result}` : ''}`)); // each egg says whose it is, and what came of it
        const sign = t => pxt(t, '#fff3d6', '#4e3626');
        lab(56, 140, sign('MEADOW'), 'zone');
        lab(60, L.GRID.y1 + 4, sign('SHADE TREE'), 'zone'); lab(200, 21, sign('YOUR PORCH'), 'zone'); lab(356, 18, sign('SCARECROWS'), 'zone');
        for (const g of L.groups) { const [r, cols] = rowsOfGroup(g)[0]; lab(174 + Math.min(...cols) * COLW + 44, 100 + r * ROWH - 1, sign(clip(g.name, 16)), 'zone proj', `The ${g.name} project: its repos side by side`); }
        const open = scene.fields.flatMap(fl => fl.prs?.open ?? []);
        if (open.length) lab(STALL.x + 14, STALL.y + 32, cnt(`${open.length} PR${open.length === 1 ? '' : 's'}`), 'cnt', `Open pull requests: ${open.slice(0, 6).map(pr => `#${pr.number} ${pr.title}`).join(' · ')}${open.length > 6 ? ' …' : ''}. Click the stall for them all`);
        const plus = (x, y, n, what) => n > 0 && lab(x, y, cnt(`+${n} ${what}`), 'cnt');
        const over = n => (n > 0 ? ` +${n}` : ''); // those the porch has no place for
        lab(PORCH_SPOTS.desk[1], 33, sign(`WAITING ON YOU${over(overflow.desk)}`), 'zone', 'This end of the porch: agents that need you (a question, a plan, a permission). The longer one waits, the more it lets you know');
        lab(PORCH_SPOTS.turn[1], 33, sign(`YOUR TURN${over(overflow.turn)}`), 'zone', 'This end of the porch: agents whose turn has ended. They sit down and settle in while they wait for your next message');
        plus(60, 262, overflow.charge, 'idle');
        plus(340, PORCH_Y - 34, overflow.storage, 'stale');
        plus(56, 152, overflow.meadow, 'in the meadow');
        if (more > 0) lab(350, L.GRID.y1 + 8, `<button type="button" class="px-more" data-farm-more>${pxt(`+${more} more field${more === 1 ? '' : 's'}`, '#fff3d6', '#4e3626')}</button>`, 'wood');
      },
    };
  }

  /** The farm's legend, shown in a dialog from the ⓘ button. */
  function helpHtml() {
    return `<div class="px-key">
      <b>Your porch</b><span>in front of the farmhouse at the top, the door between its two ends. On the left, on their feet, those who need you: a red “!”, and the longer they wait the more they let you know (a tapping foot, a bell, pacing). On the right, with a basket, those whose turn has ended: they sit down, and settle in the longer it is (a drink, a nap, a blanket). They pass the time in their own ways, and now and then something happens: click the farmhouse for the album of what you have seen. The stats panel's “needs you” button opens the first one that needs you</span>
      <b>Fields</b><span>one raised bed per repo in the fenced grid, each with its own crop (the seed packet on its side), soil and frame; empty beds lie fallow (darker grass) until a repo needs one, and the grid grows to 18. When the page opens, fields move up into free beds. A blue pennant = a branch other than main; a greenhouse = a worktree, beside its repo; stones round some beds and a sign = one project's repos</span>
      <b>Tools</b><span>what a working farmer holds is its current step: almanac = reading, spyglass = searching, pigeon = the web, hoe = editing, seeds = a new file, magnifier = running tests, rake = lint or format, hammer = a build, wheelbarrow = installing, crate = a commit, cart = a push or a PR (with a red flag: a deploy), mailbag = a pull, lantern = a server or a long wait, sickle = deleting, whistle = calling subagents, clipboard = planning, parcel = a connector (MCP: Gmail, Linear…), recipe card = a skill, blueprint = plan mode, watering can = any other command</span>
      <b>Above a farmer</b><span>a thought cloud = thinking between steps; a scroll on the porch = a plan for you to approve; a chore board beside it = its task list, ticked as items get done (its name says how many, e.g. 3/7)</span>
      <b>On a farmer</b><span>the pin on its hat = its model (purple Opus, blue Sonnet, green Haiku, orange Fable); speed lines = fast mode; a red and white scarf = bypass permissions (no checks); its purse = what it has cost (gold from $50)</span>
      <b>Road to town</b><span>a cart on the lane for each web call going on, with where it goes</span>
      <b>Carts by the road to town</b><span>a cart for each MCP server (Gmail, playwright, Chrome…) your agents called in the last hour, waiting in a row at the lane's end; while one calls it, its cart drives to that farmer, with the server's name, and waits beside it until the call is done</span>
      <b>Pumps, hammocks</b><span>a pump by a bed = a background command still running; a farmer in a hammock = a session that wakes up by itself (/loop, a scheduled wake-up), with when</span>
      <b>Market stall</b><span>a crate for each open pull request, its tag the checks (green pass, red failed, yellow running, grey draft); “Sold!” = one merged</span>
      <b>Buildings</b><span>click the barn to start or resume a session, the farmhouse for who is on your porch (and the porch album), a silo for your plans' usage (Claude's under the red dome; Codex's under the slate one), the henhouse for subagents, the notice board for CLAUDE.md and memory, the stall for pull requests</span>
      <b>Farmers</b><span>one per agent; each has its own hat, hair and clothes, and its shirt is the agent's colour in the list. Hover one for its name; names always show for the farmer you picked and those on the porch</span>
      <b>Speech bubbles</b><span>what a farmer asked or last said; × hides one to a 💬 (click it to show the bubble again); a new message brings it back by itself. The Bubbles switch hides or shows them all</span>
      <b>Above a field</b><span>hay = uncommitted files, crates = unpushed commits, mailbox = behind the remote</span>
      <b>Weather</b><span>the repo's last deploy, from GitHub Actions or a deploy an agent ran itself (a deploy script over ssh, rsync, vercel…), whichever is newer: rainbow = deployed, rain = deploy failed (hover its sign for why; the close-up links to the run), windmill = deploying. A run GitHub never started (billing, spending limit) brings no weather: ⏸ Actions didn't run. Rope = two agents writing one repo</span>
      <b>Hearts, crops</b><span>hearts = context left. Crops grow as the context fills: seeds, sprouts, young plants, in flower, ripening, then ripe with a sparkle (golden wheat, red tomatoes, sunflowers in bloom…) when it is nearly full. When the conversation is compacted, that's the harvest: the field starts again from seed. Hens = subagents (a brown hen: one of Codex's), the dog = an Explore subagent; each wears a kerchief in its farmer's colour</span>
      <b>Animals</b><span>cows, goats, a sheepdog (with a red bandana), an ostrich, a lion, a tiger, two cats (a grey one and a black one), two mice and the ducks on the pond live here just for fun: they never stand for anything. Click one, or the pond, to pet or feed it: the nearest farmer that isn't waiting on you walks over and does it. Now and then they get up to something: a goat steals a hat, the ostrich runs off with the bucket, the cow naps in an empty hammock, a cat hunts a mouse (or the mouse the cat). The cats sleep long in their basket or on the moss at the wood's edge, sometimes curled up together. And once in a while, for a few seconds, there is a unicorn. It is shy: don't touch it. They react to deploys, harvests and merges. Farmers idle for a while sometimes play with them. In winter they huddle, and the goats wear scarves. The Animals switch hides them</span>
      <b>Shade tree, scarecrows</b><span>idle agents nap under the tree (bottom left); stale ones stand as scarecrows (top right); the meadow by the henhouse is for agents outside any repo</span>
      <b>Silo</b><span>its grain is your plan's weekly limit used (the % under it; when it resets on hover); its lamp turns amber from 70% and blinks red from 90%</span>
      <b>Seasons</b><span>follow your plan's 5-hour limit: spring while it is fresh (blossom), then summer, autumn (falling leaves), and winter (snow) when it is nearly used up; a new window brings spring back</span>
      <b>At a bed</b><span>a working farmer walks the rows (hoe = editing, seed bag = a new file, rake = lint, sickle = deleting, can = other commands) or round the frame (spyglass = searching, almanac = reading). The slate in the bed's corner counts the steps taken there, the band under the number is their mix (green = changing files, blue = reading and searching, yellow = tests and builds, orange = git and deploys, purple = planning, grey = other commands); hover it for the record in words. Along the front board: the last half hour, a tick a step, red = failed. Dark soil = just changed, a staked seedling = a new file, a stump = a deletion, the pennant at the front left = the last test run (green, red; amber while tests run), thistles = steps failing in a row</span>
      <b>Henhouse</b><span>a farmer whistles and a hen comes out of the henhouse: a subagent at work. It keeps beside its farmer, or scratches on the field by itself when it runs in the background (its farmer may sit on the porch meanwhile). Done, it walks home, pecks in the run a moment and lays an egg in the nest (hover it for the result); one that failed flutters home with no egg. Hens waiting in the run: more than four for one farmer, or their farmer is not out. Hover a hen for its task, click it for its farmer's subagents</span>
      <b>Pigeons</b><span>one agent messaging another (Claude Code's SendMessage between sessions): a pigeon flies the note from one farmer to the other, and the diary says what it said; the agents' conversations show it too</span>
      <b>Day and night</b><span>the light follows your clock: cloud shadows drift over by day; at night the windows, the lamps and lanterns glow and fireflies come out. The Sky switch holds it at day or night</span>
      <b>Click</b><span>a farmer to answer or message it in the sidebar; a field for the files agents touched there</span>
      <b>Zoom</b><span>+ / − on the right (or ⌘/Ctrl + scroll, or pinch) zooms the farm inside its frame; drag or scroll to move around (the map in the corner shows where you are; click it to go somewhere); the % button shows the whole farm again</span>
      <b>Stats, bell</b><span>the stats add up what the sessions have cost and their harvests. Bell: a chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you</span>
    </div>`;
  }

  /* ---------- the farm, as a world: the bridge (web/worlds/sdk/bridge.js) runs it ---------- */

  window.Agentville.world(makeFarm());
  // The farm's own pieces, for its tests (and the world tools to come).
  window.AgentvilleFarm = {
    farmScene, makeFarm, actionOf, paint, growthStage, STAGES, skyAt, PALETTE, ink, spriteRows, walkFrame, stepParticles, seasonOf, siloOf, glyphOf, textWidth,
    weatherOf, helpHtml, layoutFor, packedLayout, rowsOfGroup, cartRoute, cartGoal, cutMid, tagText, shortName, bedLegs, bedStanding, henRoute, drawHen, COOP,
    tallyOf, tallyLines, spanText, WORK_GROUPS,
    cat: { SPOTS: CAT, UP: CAT_UP, LANE: CAT_LANE, plan: catPlan, stretch: catStretch, legs: catLegs, leap: catLeap, draw: drawPorchCat },
    porch: { SPOTS: PORCH_SPOTS, STAGES: PORCH_STAGES, SEATING, PASTIMES, SURPRISES, ALBUM, stage: porchStage, seats: porchSeats, seatingOf, pastimeOf, surpriseOf, now: porchNow, seasonalOf },
  };
})();
