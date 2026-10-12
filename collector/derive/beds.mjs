import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { renameOver } from '../lib/replace.mjs';

// The dashboard's own scene and grid, run here as the browser runs them: plain scripts with no DOM in them. So the
// collector places each repo's field with the very code a world lays it out with, and every browser gets the same beds.
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');
const GRID = { cols: 3, max: 18 }; // the engine's grid (the farm's): three beds across, eighteen in all
let kit = null;
function load() {
  if (kit) return kit;
  const window = {};
  vm.runInNewContext(`${readFileSync(join(WEB, 'scene.js'), 'utf8')}\n;${readFileSync(join(WEB, 'worlds', 'sdk', 'grid.js'), 'utf8')}\n;window.makeGrid = makeGrid;`, { window, Math, Date, JSON, Map, Set });
  const grid = window.makeGrid({ ...GRID, colW: 1, rowH: 1, cx0: 0, top0: 0, fence: () => ({}), height: () => 0 });
  return (kit = { toScene: window.AgentvilleScene.toScene, grid });
}

/**
 * The bed of each repo in a snapshot, kept across snapshots and restarts (in `file`): a repo keeps its bed, a new one
 * takes a free bed (near its project's; a worktree right after its repo), one that leaves has its bed held for a day.
 * Nothing ever moves up: a gap stays a gap, and everyone looking sees the same farm.
 */
export function createBeds({ file, log = () => {} } = {}) {
  let beds = {}, saved = '';
  try { const b = JSON.parse(readFileSync(file, 'utf8')); if (b && typeof b === 'object' && !Array.isArray(b)) beds = b; } catch { /* none yet */ }
  saved = JSON.stringify(beds);
  return {
    /** Gives each of the snapshot's repos its `bed` (a whole number; from 18 on: no bed, "+N more"). */
    place(snapshot, now = Date.now()) {
      try {
        const { toScene, grid } = load();
        const fields = toScene(snapshot).repos;
        beds = JSON.parse(JSON.stringify(grid.layoutFor(fields, beds, now).beds)); // out of the other realm
        for (const r of snapshot.repos) r.bed = Number.isInteger(beds[r.path]?.i) ? beds[r.path].i : null;
        const text = JSON.stringify(beds);
        if (file && text !== saved) { writeFileSync(`${file}.tmp`, text); renameOver(`${file}.tmp`, file); saved = text; }
      } catch (err) { log(`beds: ${err?.stack ?? err}`); }
      return snapshot;
    },
  };
}
