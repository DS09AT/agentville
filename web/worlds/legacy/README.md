# The pixel engine (api 1)

This folder draws the worlds of `"api": 1`: the farm, the robot factory, and worlds of yours made
before api 2. A world of api 2 is described by its `world.json` and drawn by the SDK in
`web/worlds/sdk/` with three.js; new worlds and new features go there ([docs/worlds.md](../../../docs/worlds.md)).

The pixel engine is kept only until its worlds have been moved to api 2. Nothing in the SDK imports
from this folder, and every line elsewhere that exists only for it is marked `LEGACY` in a comment.

## Before it goes

Three things are decisions, not deletions:

- **The farm and the factory.** Remake them as worlds of api 2, or drop them.
- **The default world.** The dashboard shows `farm` when nothing else is chosen and falls back to
  it when a world breaks (`web/worlds.js`: `FARM`, "Back to the farm"; `collector/worlds.mjs` lists
  it first). Name another world there.
- **Animals.** Creatures, their gags, the ✨ Helper's animal lines and "ask an animal" exist only
  here. A world of api 2 has none. Carry them over to the SDK, or remove what serves them:
  `collector/sources/lines.mjs`, the `cast`, `act`, `touch` and `chatter` messages
  (`web/worlds.js`, `web/worlds/sdk/bridge.js`, `web/live.js`) and the animals, jobs and says of a
  room's state (`collector/live.mjs`).

## What is deleted with it

- `web/worlds/legacy/` and `web/worlds/legacy-starter/` (and `web/worlds/farm/`,
  `web/worlds/factory/`, unless remade).
- `docs/worlds-legacy.md`, `docs/legacy-starter.png`, `docs/kits.png`, and "The pixel engine" in
  `docs/worlds.md`.
- `scripts/lib/world-vm.mjs`, `scripts/lib/check-world-run.mjs`, `scripts/kit-sheet.mjs`.
- The tests of the engine and its kits in `collector/test/`: `animals`, `creatures`, `engine`,
  `engine-hooks`, `jobs`, `people`, `props`, `watch`, `legacy-starter`, `farm`, `factory`, and the
  pixel-engine cases of `check-world`, `live`, `world-files` and `lines`.
- Every line marked `LEGACY` (`grep -rn "LEGACY[:.,) ]" collector web scripts`):
  - `collector/worlds.mjs`: `LEGACY_API`, the `taken` field, `world.js` as a required file, the
    `legacy` key, the pixel engine's frame;
  - `collector/live-world.mjs`: `SDK`, `loadWorld`, `loadWorldShutIn`;
  - `collector/live.mjs`: `LIVE_WORLDS`, `makeWorld`, and the branches for a world that runs in the
    collector's own process; `collector/live-child.mjs`: its branch;
  - `scripts/check-world.mjs` and `scripts/lib/contained.mjs`: the pixel engine's check;
  - `web/worlds.js`: `LIVE_WORLDS`, `LEGACY_API`.

`web/worlds/sdk/ui/` (shared lettering, HUD and styles), `web/worlds/sdk/bridge.js` and
`web/worlds/sdk/grid.js` are not part of the pixel engine: the bridge
carries every world's messages, and the collector gives each repo its bed with the grid.

Afterwards `scripts/world-golden.mjs` and the demo scripts need new views: theirs are the farm's.
