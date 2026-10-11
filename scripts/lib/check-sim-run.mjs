// The contained half of npm run check-world for a world of api 2 (scripts/check-world.mjs starts it): checks
// one world and prints the report. It runs only under Node's permission model with no writes, programs or
// workers allowed (scripts/lib/contained.mjs), and refuses to run otherwise; the world's own code runs inside
// QuickJS besides (scripts/lib/sim-check.mjs). Every word of the world's in the report goes through oneLine()
// (scripts/lib/plain-text.mjs), and the command prints it all through plain() again.
//
//   node --permission --allow-fs-read=… scripts/lib/check-sim-run.mjs <key> <folder>
import { oneLine } from './plain-text.mjs';
import { checkSim } from './sim-check.mjs';

const p = process.permission;
if (!p || p.has('fs.write') || p.has('child') || p.has('worker')) {
  console.error('check-world runs a world only contained: use npm run check-world -- <world>.');
  process.exit(1);
}
const [key, dir] = process.argv.slice(2);
const r = await checkSim({ dir });
const out = [], say = line => out.push(line);
say(`check-world: ${oneLine(key)} (${oneLine(dir, 1000)})`);
say("  · contained: it can read only the SDK and this world's folder, and can't write or start programs; the world's own code runs where it can reach nothing");
if (r.json) say(`  ✗ world.json: ${oneLine(r.json.replace(/^world\.json:? /, ''))}`);
else say(`  ${r.errors.length ? '✗' : '✓'} ${r.ran} stop${r.ran === 1 ? '' : 's'} of the tour${r.errors.length ? `: ${r.errors.length} problem${r.errors.length === 1 ? '' : 's'}` : ''}`);
// The same problem at many stops is said once, with the first stop and how many more.
const seen = new Map();
for (const e of r.errors) { const k = `${e.message}\n${e.where}`; if (seen.has(k)) seen.get(k).more++; else seen.set(k, { ...e, more: 0 }); }
for (const e of seen.values()) say(`  ✗ ${oneLine(e.stop)}${e.more ? ` (and ${e.more} more stop${e.more === 1 ? '' : 's'})` : ''}: ${oneLine(e.message)}${e.where ? ` (${oneLine(e.where)})` : ''}`);
for (const n of r.notes) say(`  · ${oneLine(n)}`);
// Written at once, and the exit waits for it: what is printed goes down a pipe to the command.
process.stdout.write(`${out.join('\n')}\n`, () => process.exit(r.errors.length || r.json ? 1 : 0));
