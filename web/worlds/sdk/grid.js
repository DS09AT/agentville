// The repo grid: which bed each repo's field has. A plain script with no DOM in it, so the collector runs the very
// same code (collector/derive/beds.mjs) to give every browser the same beds; the engine lays the fields out on it
// (docs/worlds.md, "Hooks": grid). Only makeGrid and projectOf are global.
'use strict';

// A project: the folder holding sibling repos. The scene says which (a repo's `project`); a field
// without one falls back to its path, read the same way as web/scene.js reads it.
const CATCH_ALL = new Set(['code', 'projects', 'repos', 'src', 'dev', 'work', 'tools', 'github', 'git', 'documents', 'desktop', 'downloads', 'workspace', 'workspaces', 'sites', 'apps', 'clients', 'tmp']);
function projectOf(path) {
  const parts = String(path).split('/').filter(Boolean).slice(0, -1);
  return parts.length >= 3 && !CATCH_ALL.has(parts.at(-1).toLowerCase()) ? `/${parts.join('/')}` : null;
}
// A field keeps its bed; one that leaves keeps it held for a day, so it comes back to the same place.
const BED_HELD_MS = 86_400_000;

/**
 * The repo grid an engine world lays its fields out on: a bed per repo, in rows of `cols`. While you
 * look a repo keeps its bed (a new one takes a free bed near its project's, a worktree right after its
 * repo), a repo that leaves keeps its bed for a day, and when the page opens the beds are packed. The
 * farm's is 3 across, 88 × 62, from (174, 100).
 */
function makeGrid({ cols = 3, colW, rowH, cx0, top0, minRows = 3, maxRows = 6, max = 18, slot = () => ({}), fence, height }) {
  const slotAt = i => { const cx = cx0 + (i % cols) * colW, rowTop = top0 + Math.floor(i / cols) * rowH; return { i, cx, rowTop, ...slot(cx, rowTop) }; };
  /** The fields as units to place: a project's repos together, else a repo alone; a worktree right after its repo. */
  function unitsOf(fields) {
    const byKey = new Map(fields.map(f => [f.key, f]));
    const home = f => (f.worktree && f.main ? f.main : f.key);
    const units = new Map();
    for (const f of fields) {
      const project = f.project !== undefined ? f.project : projectOf(home(f)), id = project ?? `repo:${home(f)}`;
      if (!units.has(id)) units.set(id, { project, name: f.projectName ?? (project ? project.split('/').pop() : null), keys: [] });
      units.get(id).keys.push(f.key);
    }
    for (const u of units.values()) { // each repo, then its worktrees
      const order = [];
      for (const k of u.keys) if (!byKey.get(k).worktree) { order.push(k); for (const w of u.keys) if (byKey.get(w).worktree && byKey.get(w).main === k) order.push(w); }
      for (const k of u.keys) if (!order.includes(k)) order.push(k);
      u.keys = order;
      if (u.project && new Set(u.keys.map(k => home(byKey.get(k)))).size < 2) u.project = null; // one repo is no project
    }
    return { byKey, units: [...units.values()] };
  }
  const groupsOf = units => units.filter(u => u.project).map(u => ({ name: u.name, keys: u.keys }));
  /** Which bed each field gets, the first time: a project's repos side by side (kept to one row when they fit). */
  function arrange(fields) {
    const { units } = unitsOf(fields);
    const slotOf = new Map(), queue = [...units];
    let row = 0, col = 0;
    const place = u => { for (const k of u.keys) { slotOf.set(k, row * cols + col); if (++col === cols) { col = 0; row++; } } };
    while (queue.length) {
      const n = queue[0].keys.length;
      if (col > 0 && (n > cols || col + n > cols)) { // it does not fit the rest of this row: a smaller one may, else the next row
        const j = queue.findIndex(u => u.keys.length <= cols - col);
        if (j > 0) place(queue.splice(j, 1)[0]); else { row++; col = 0; }
        continue;
      }
      place(queue.shift());
    }
    return { slotOf, groups: groupsOf(units) };
  }
  /** Beds that stay put, from `beds` (key → { i, left? }). Returns { slotOf, groups, beds } (beds: what to remember now). */
  function placeBeds(fields, beds, now) {
    if (!Object.keys(beds).length) {
      const { slotOf, groups } = arrange(fields);
      return { slotOf, groups, beds: Object.fromEntries([...slotOf].map(([k, i]) => [k, { i }])) };
    }
    const { byKey, units } = unitsOf(fields);
    const slotOf = new Map(), kept = {}, taken = new Set(), held = new Set();
    for (const [k, b] of Object.entries(beds)) {
      if (!Number.isInteger(b?.i)) continue;
      if (byKey.has(k)) { if (!taken.has(b.i)) { slotOf.set(k, b.i); taken.add(b.i); kept[k] = { i: b.i }; } }
      else if (now - (b.left ?? now) < BED_HELD_MS) { kept[k] = { i: b.i, left: b.left ?? now }; held.add(b.i); }
    }
    const dist = (i, j) => Math.abs(Math.floor(i / cols) - Math.floor(j / cols)) * 10 + Math.abs((i % cols) - (j % cols));
    const free = () => Array.from({ length: max }, (_, i) => i).filter(i => !taken.has(i) && !held.has(i));
    for (const u of units) {
      for (const k of u.keys) {
        if (slotOf.has(k)) continue;
        const f = byKey.get(k), open = free();
        const near = f.worktree && slotOf.has(f.main) ? [slotOf.get(f.main)] : u.project ? u.keys.filter(x => slotOf.has(x)).map(x => slotOf.get(x)) : [];
        let i;
        if (!open.length) i = max + slotOf.size; // the grid is full: "+N more"
        else if (near.length) {
          const next = near.map(n => n + 1).find(n => n % cols !== 0 && open.includes(n)); // right after it, in the same row
          i = next ?? open.reduce((best, b) => (Math.min(...near.map(n => dist(b, n))) < Math.min(...near.map(n => dist(best, n))) ? b : best));
        } else i = open[0];
        slotOf.set(k, i);
        taken.add(i);
        kept[k] = { i };
      }
    }
    return { slotOf, groups: groupsOf(units), beds: kept };
  }
  /** The ground for these fields: the beds remembered in `beds` stay put (null: laid out afresh). */
  function layoutFor(fields, beds = null, now = Date.now()) {
    const placed = beds ? placeBeds(fields, beds, now) : { ...arrange(fields), beds: null };
    const { slotOf, groups } = placed;
    const shown = fields.filter(f => slotOf.get(f.key) < max);
    const last = Math.max(-1, ...shown.map(f => slotOf.get(f.key)));
    const rows = Math.min(maxRows, Math.max(minRows, Math.floor(last / cols) + 1));
    const slots = Array.from({ length: rows * cols }, (_, i) => slotAt(i));
    const ST = shown.map(f => ({ key: f.key, ...slots[slotOf.get(f.key)] }));
    const used = new Set(ST.map(s => s.i));
    const GRID = fence(rows);
    return {
      // the key goes by bed: the same ground, whatever order the repos are listed in
      key: [...ST].sort((a, b) => a.i - b.i).map(s => `${s.key}@${s.i}`).join('\n'), ST, slots, empty: slots.filter(s => !used.has(s.i)), rows, GRID, H: height(GRID),
      groups: groups.map(g => ({ name: g.name, slots: g.keys.filter(k => slotOf.get(k) < rows * cols).map(k => slotOf.get(k)) })).filter(g => g.slots.length),
      more: fields.length - shown.length,
      beds: placed.beds,
    };
  }
  /** The ground when the page opens: the fields in the order of the beds they had, packed into the first free beds. */
  function packedLayout(fields, beds, now = Date.now()) {
    const at = k => (Number.isInteger(beds?.[k]?.i) ? beds[k].i : Infinity);
    return layoutFor([...fields].sort((x, y) => at(x.key) - at(y.key)), {}, now);
  }
  return { layoutFor, packedLayout, slotAt, cols };
}
