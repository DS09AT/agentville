#!/usr/bin/env node
// Checks a world headless before you look at it: its world.json, the files it names, and its simulation run
// through every stop of the tour (scripts/lib/sim-check.mjs). Reports what is wrong with file and line, and
// pointers (a place too small for a stop, a field it does not know). Exits 1 on a problem.
//
// The check runs contained, in a Node of its own (scripts/lib/contained.mjs): it can read only the SDK and
// the world's folder, and can't write or start programs; the world's own code runs inside QuickJS, where it
// can reach nothing. It doesn't get your terminal: what it prints is printed here, without control sequences.
//
// LEGACY, a world of the pixel engine (api 1): every stop of the tour, a few frames each, in a vm with a
// canvas that records what is drawn (scripts/lib/world-vm.mjs); its code can read only the SDK and the
// world's world.js and world.json, but can still reach the network.
//
//   npm run check-world -- <world> [--worlds <dir>]
//   <world>: a built-in world's name (a folder of web/worlds: farm, factory, starter…), u/<folder> or <folder>
//   (one of yours). A built-in name wins over one of yours, with a line saying so: u/<folder> reaches yours.
import { readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_API, makeWorlds } from '../collector/worlds.mjs';
import { canContain, plainLines, runContained, runContainedSim, runnerArgs, worldFiles } from './lib/contained.mjs';
import { ROOT, keyOf, whichWorld, worldsDir } from './lib/worlds-dir.mjs';

const args = process.argv.slice(2);
const arg = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--worlds');
if (!arg) { console.error(whichWorld('check-world')); process.exit(1); }
const { dir: userDir } = worldsDir(), key = keyOf(arg, { userDir });
const dir = makeWorlds({ builtinDir: join(ROOT, 'web', 'worlds'), userDir, home: homedir() }).dirOf(key);
if (!dir) { console.error(`No world ${key}${key.startsWith('u/') ? ` in ${userDir}` : ''}.`); process.exit(1); }
if (!canContain()) { console.error(`check-world needs a Node that can contain a world (--permission: Node 22.13 or later, or 23.5 or later); this is ${process.version}.`); process.exit(1); }
let api = null;
try { api = JSON.parse(readFileSync(join(dir, 'world.json'), 'utf8'))?.api; } catch { /* the check says what is wrong with it */ }
let r;
if (api === LEGACY_API) { // LEGACY: the pixel engine's check
  let world;
  try { world = worldFiles(dir); } catch (err) { console.error(`${key}: ${err.message}`); process.exit(1); }
  r = runContained(world, runnerArgs(key, world));
} else r = runContainedSim(key, realpathSync(dir));
// The check's report, and anything else it printed, a line at a time with no control sequence in it: a world's
// words are its own to choose, and your terminal would act on them (scripts/lib/plain-text.mjs).
process.stdout.write(plainLines(r.stdout));
process.stderr.write(plainLines(r.stderr));
if (r.error || r.status === null) { console.error(`check-world couldn't run the contained check: ${r.error?.message ?? `it stopped (${r.signal})`}.`); process.exitCode = 1; }
else process.exitCode = r.status;
