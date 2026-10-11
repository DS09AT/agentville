#!/usr/bin/env node
// Makes the models the built-in worlds ship with (web/worlds/<world>/assets/*.glb), from the few shapes
// written down here. Run it again after changing one: the files it writes are checked in. With --check it
// writes nothing and exits 1 when a file is not what this would make. No dependencies.
//
//   node scripts/world-assets.mjs [--check]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { glb, turn } from './lib/glb.mjs';

const WORLDS = join(dirname(fileURLToPath(import.meta.url)), '..', 'web', 'worlds');
const loop = (duration, at) => { const times = [0, 0.25, 0.5, 0.75, 1].map(k => Number((k * duration).toFixed(4))); return { times, values: [0, 0.25, 0.5, 0.75, 1].map(at) }; };
const swing = (axis, amount, offset = 0) => k => turn(axis, offset + amount * Math.sin(k * Math.PI * 2));
const hold = value => ({ times: [0, 1], values: [value, value] });

const MODELS = {
  // The tennis club's trees: a trunk and two tiers of dark green.
  'tennis/assets/cypress.glb': {
    materials: { Trunk: '#6b4320', Leaves: '#2a5f3a' },
    nodes: [{ name: 'Cypress', parts: [
      { shape: 'cylinder', size: [0.34, 0.9, 0.34], at: [0, 0.45, 0], material: 'Trunk' },
      { shape: 'cone', size: [1.5, 2.2, 1.5], at: [0, 1.8, 0], material: 'Leaves' },
      { shape: 'cone', size: [1.1, 1.8, 1.1], at: [0, 3, 0], material: 'Leaves' },
    ] }],
  },
  // What a player holds while it works: a racket, its grip at the hand, pointing down the arm.
  'tennis/assets/racket.glb': {
    materials: { Grip: '#2a1d14', Frame: '#e04a3a', Strings: '#f4ecd8' },
    nodes: [
      { name: 'Racket', parts: [{ shape: 'cylinder', size: [0.05, 0.34, 0.05], at: [0, -0.17, 0], material: 'Grip' }] },
      { name: 'Head', parent: 'Racket', at: [0, -0.5, 0], parts: [
        { shape: 'box', size: [0.3, 0.04, 0.04], at: [0, 0.18, 0], material: 'Frame' }, { shape: 'box', size: [0.3, 0.04, 0.04], at: [0, -0.18, 0], material: 'Frame' },
        { shape: 'box', size: [0.04, 0.4, 0.04], at: [-0.15, 0, 0], material: 'Frame' }, { shape: 'box', size: [0.04, 0.4, 0.04], at: [0.15, 0, 0], material: 'Frame' },
        { shape: 'box', size: [0.27, 0.33, 0.01], at: [0, 0, 0], material: 'Strings' },
      ] },
    ],
  },
  // The tennis club's figure: a player whose shirt takes its agent's colour (the material named Shirt), with
  // the five moves every world's figures have, under names of its own (world.json's "figure.clips" maps them),
  // and a node at each wrist for what it holds.
  'tennis/assets/player.glb': {
    materials: { Shirt: '#ffffff', Skin: '#e0a878', Shorts: '#f4ecd8', Shoes: '#3a3a40', Cap: '#ffffff' },
    nodes: [
      { name: 'Player' },
      { name: 'Hips', parent: 'Player', at: [0, 0.66, 0] },
      { name: 'Torso', parent: 'Hips', parts: [{ shape: 'box', size: [0.56, 0.6, 0.34], at: [0, 0.3, 0], material: 'Shirt' }] },
      { name: 'Head', parent: 'Torso', at: [0, 0.6, 0], parts: [
        { shape: 'box', size: [0.44, 0.42, 0.42], at: [0, 0.23, 0], material: 'Skin' },
        { shape: 'box', size: [0.48, 0.12, 0.46], at: [0, 0.44, 0], material: 'Cap' }, { shape: 'box', size: [0.4, 0.04, 0.22], at: [0, 0.4, 0.3], material: 'Cap' },
      ] },
      ...[['L', 1], ['R', -1]].flatMap(([side, x]) => [ // (it looks along +z, so its left is at +x)
        { name: `Arm${side}`, parent: 'Torso', at: [x * 0.37, 0.56, 0], parts: [{ shape: 'box', size: [0.17, 0.22, 0.17], at: [0, -0.1, 0], material: 'Shirt' }, { shape: 'box', size: [0.14, 0.38, 0.14], at: [0, -0.39, 0], material: 'Skin' }] },
        { name: `Hand${side}`, parent: `Arm${side}`, at: [0, -0.58, 0] }, // what it holds hangs here (world.json's "figure.hand")
        { name: `Leg${side}`, parent: 'Hips', at: [x * 0.15, 0, 0], parts: [{ shape: 'box', size: [0.22, 0.26, 0.24], at: [0, -0.13, 0], material: 'Shorts' }, { shape: 'box', size: [0.16, 0.32, 0.16], at: [0, -0.42, 0], material: 'Skin' }, { shape: 'box', size: [0.2, 0.1, 0.3], at: [0, -0.61, 0.05], material: 'Shoes' }] },
      ]),
    ],
    animations: [
      { name: 'Stand', tracks: [{ node: 'ArmL', path: 'rotation', ...loop(2.4, swing('x', 0.06)) }, { node: 'ArmR', path: 'rotation', ...loop(2.4, swing('x', -0.06)) }, { node: 'Torso', path: 'rotation', ...loop(2.4, swing('x', 0.02)) }] },
      { name: 'Walk', tracks: [{ node: 'LegL', path: 'rotation', ...loop(0.8, swing('x', 0.6)) }, { node: 'LegR', path: 'rotation', ...loop(0.8, swing('x', -0.6)) }, { node: 'ArmL', path: 'rotation', ...loop(0.8, swing('x', -0.5)) }, { node: 'ArmR', path: 'rotation', ...loop(0.8, swing('x', 0.5)) }] },
      { name: 'Swing', tracks: [{ node: 'ArmR', path: 'rotation', ...loop(1, swing('x', 0.9, -1.3)) }, { node: 'ArmL', path: 'rotation', ...loop(1, swing('x', 0.2, -0.3)) }, { node: 'Torso', path: 'rotation', ...loop(1, swing('y', 0.35)) }] },
      { name: 'Wave', tracks: [{ node: 'ArmR', path: 'rotation', ...loop(0.9, swing('x', 0.3, -2.75)) }, { node: 'Hips', path: 'translation', ...loop(0.9, k => [0, 0.66 + 0.05 * Math.abs(Math.sin(k * Math.PI * 2)), 0]) }] },
      { name: 'Rest', tracks: [{ node: 'Hips', path: 'translation', ...hold([0, 0.24, 0]) }, { node: 'LegL', path: 'rotation', ...hold(turn('x', -1.5)) }, { node: 'LegR', path: 'rotation', ...hold(turn('x', -1.5)) }, { node: 'Torso', path: 'rotation', ...hold(turn('x', -0.3)) }, { node: 'Head', path: 'rotation', ...loop(3, swing('x', 0.04, 0.45)) }] },
    ],
  },
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [file, model] of Object.entries(MODELS)) {
  const path = join(WORLDS, file), bytes = glb(model);
  if (check) {
    const same = existsSync(path) && readFileSync(path).equals(bytes);
    if (!same) stale++;
    console.log(`${same ? 'same  ' : 'STALE '}${file}`);
    continue;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  console.log(`${file}  ${bytes.length} bytes`);
}
if (stale) { console.error('Run node scripts/world-assets.mjs to write them again.'); process.exit(1); }
