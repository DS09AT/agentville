// check-world's containment: the check runs in a Node of its own under Node's permission model. It may read
// only what a check needs; it may not write, start programs or workers; and it gets no environment, so nothing
// secret is in reach of it. Nor does it get your terminal: no input, and what it prints comes back here, to be
// printed plain (plainLines).
//
// A world of api 2: the check may read the SDK and the world's own folder. The world's code runs inside
// QuickJS (sim-check.mjs), where it reads nothing and reaches nothing at all.
// LEGACY, a world of the pixel engine: its code runs in this Node itself, so the check may read only the files
// world-vm.mjs lists and the world's world.js and world.json, never its folder (Node follows a link inside a
// folder it may read), and the code can still reach the network.
import { spawnSync } from 'node:child_process';
import { lstatSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { plain } from './plain-text.mjs';
import { FILES as SIM_FILES } from './sim-check.mjs';
import { FILES } from './world-vm.mjs';

export const RUNNER = fileURLToPath(new URL('./check-world-run.mjs', import.meta.url)); // LEGACY
export const SIM_RUNNER = fileURLToPath(new URL('./check-sim-run.mjs', import.meta.url));
const PLAIN = fileURLToPath(new URL('./plain-text.mjs', import.meta.url)); // the runner prints with it
const LINE_MAX = 2000;
/** Can this Node contain a world? (--permission is Node 22.13 and later, and 23.5 and later.) */
export const canContain = () => process.allowedNodeEnvironmentFlags.has('--permission');

/**
 * LEGACY. The world's two files, each as its real path, which must be a regular file inside the real path of the
 * world's own folder (so a link out of the folder is refused): { dir, js, json }. A world.json that isn't
 * there at all is let through, for the check to report. Throws an Error of one line naming the file otherwise.
 */
export function worldFiles(folder) {
  const dir = realpathSync(folder);
  const one = (name, mayBeMissing = false) => {
    const at = join(dir, name);
    let real;
    try { real = realpathSync(at); } catch (err) {
      let there = true;
      try { lstatSync(at); } catch { there = false; }
      if (!there && mayBeMissing) return at; // the check says "world.json is missing."
      throw new Error(there ? `${name} is a link to something that isn't there.` : `${name} is missing.`);
    }
    if (!real.startsWith(dir + sep)) throw new Error(`${name} is a link to a file outside the world's folder: check-world won't run this world.`);
    if (!statSync(real).isFile()) throw new Error(`${name} isn't a file.`);
    return real;
  };
  return { dir, js: one('world.js'), json: one('world.json', true) };
}

/** LEGACY. Node's flags for a contained run that may read the check's own files and the world's two files, and nothing else. */
export const containedFlags = world => ['--permission', ...[RUNNER, PLAIN, ...FILES, world.js, world.json].map(p => `--allow-fs-read=${p}`)];
/** LEGACY. Runs `args` (a script and its arguments) in a contained Node with an empty environment, no input, and its output piped back as text. */
export const runContained = (world, args, { stdio = ['ignore', 'pipe', 'pipe'] } = {}) =>
  spawnSync(process.execPath, [...containedFlags(world), ...args], { stdio, env: {}, encoding: 'utf8' });
/** What a contained run printed, a line at a time through plain(): a world that got out of its vm chooses it. */
export const plainLines = text => String(text ?? '').split('\n').map(line => plain(line, LINE_MAX)).join('\n');
/** LEGACY. The runner's arguments for a world: its key, its folder, and its two files relative to the folder. */
export const runnerArgs = (key, world) => [RUNNER, key, world.dir, relative(world.dir, world.js), relative(world.dir, world.json)];

/** A world of api 2, checked contained: `dir` is its folder (its real path), `key` its key. Its output comes back as text. */
export const runContainedSim = (key, dir, { stdio = ['ignore', 'pipe', 'pipe'] } = {}) =>
  spawnSync(process.execPath, ['--permission', ...[SIM_RUNNER, PLAIN, ...SIM_FILES, dir].map(p => `--allow-fs-read=${p}`), SIM_RUNNER, key, dir], { stdio, env: {}, encoding: 'utf8' });
