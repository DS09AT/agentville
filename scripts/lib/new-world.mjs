// A world of your own from the starter (web/worlds/starter/): its files (and its assets folder, when it has
// one) copied into your worlds folder under the name you give, with that name (as a title) in world.json. A
// taken or bad name is refused, and a copy that fails half-way is removed, so nothing is left half-made. For
// scripts/new-world.mjs and its tests.
import { copyFileSync, cpSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WORLD_NAME } from '../../collector/worlds.mjs';

const exists = p => { try { lstatSync(p); return true; } catch { return false; } };
/** 'my-bakery' → 'My bakery'. */
export const titleOf = name => name.replace(/-+/g, ' ').trim().replace(/^./, c => c.toUpperCase());

export function newWorld({ name, worldsDir, starterDir }) {
  if (typeof name !== 'string' || !WORLD_NAME.test(name)) throw new Error("A world's name is lowercase letters, digits and dashes, up to 40, like my-bakery.");
  if (exists(worldsDir) && !statSync(worldsDir).isDirectory()) throw new Error(`${worldsDir} is not a folder: set worldsDir in config.json to a folder.`);
  const dir = join(worldsDir, name);
  if (exists(dir)) throw new Error(`${dir} already exists: pick another name, or move that folder away first.`);
  mkdirSync(worldsDir, { recursive: true });
  mkdirSync(dir); // not recursive: if something made it meanwhile, this fails and nothing is touched
  const title = titleOf(name);
  try {
    for (const f of readdirSync(starterDir)) {
      if (f.startsWith('.')) continue;
      const from = join(starterDir, f);
      if (f === 'assets' && statSync(from).isDirectory()) { cpSync(from, join(dir, f), { recursive: true }); continue; }
      if (!statSync(from).isFile()) continue;
      // The name is put in place in the text itself: the file keeps its layout, a line for each thing.
      if (f === 'world.json') writeFileSync(join(dir, f), readFileSync(from, 'utf8').replace(/("name"\s*:\s*)"(?:[^"\\]|\\.)*"/, (_, key) => `${key}${JSON.stringify(title)}`));
      else copyFileSync(from, join(dir, f));
    }
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error(`Couldn't copy the starter world: ${err.message}`);
  }
  return { dir, title };
}

// A folder as one word on a command line: as it is when plain, else quoted.
// Windows gets double quotes because cmd.exe does not read single quotes.
const shellArg = (s, platform = process.platform) => {
  if (platform === 'win32') return /^[\w@+=:,./\\-]+$/.test(s) ? s : `"${s}"`;
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", "'\\''")}'`;
};

/**
 * What to do next, for the new world's message. Its commands name it u/<name> (a world of yours called farm is
 * not the farm), and repeat `--worlds <dir>` when `worlds` (that folder) was given; the dashboard and its test
 * page show only your worlds folder, so that case says so.
 */
export function nextSteps({ dir, name, title, port = 7777, worlds = null, platform = process.platform }) {
  const key = `u/${name}`, w = worlds ? ` --worlds ${shellArg(worlds, platform)}` : '';
  return `Made ${title} in ${dir}.

Next:
  1. Edit ${join(dir, 'world.json')}: it describes the whole world (docs/worlds.md is the guide).
     sim.js and view.js are for rules and looks of its own; delete them if it needs none.
  2. With the dashboard running, see it on the test page: http://localhost:${port}/worlds/test?world=${key}
  3. npm run check-world -- ${key}${w}
  4. npm run world-shots -- ${key}${w}
  5. In the dashboard, World ▾ → ${title}, among your worlds (after the built-in ones).${worlds ? `
The dashboard and its test page show only your worlds folder (worldsDir in config.json, else
~/.agentville/worlds): for steps 2 and 5, the world has to be in it.` : ''}`;
}
