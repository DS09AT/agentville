# Agentville: notes for Claude

## Keep the docs in step with the code

Every change that adds or changes a feature updates the docs in the same change. A feature isn't
done until the docs match it. Fixes that change what the dashboard shows or does count too.

- **README.md** stays short: the feature list, install, settings, commands, and a few lines each on
  privacy, troubleshooting and limits. Details go in **docs/guide.md** (every part of the
  dashboard, troubleshooting, known limits) and **docs/security.md** (privacy and security).
  Update the page the change belongs to, and the README only where its short version changes.
- README, guide.md and security.md are user manuals. Write what a user needs to use the feature or
  to decide something, in a sentence or two. Leave out how it is implemented (file formats,
  protocols, algorithms, internal names): a developer reads the source.
- **docs/** screenshots: refresh them when the change shows in them. If you can't, say they are
  out of date. `farm.png` comes from `STILLS=<dir> STILLS_ONLY=1 npm run demo`; `farm-night.png`
  (`night`), `factory.png` (`factory-day`) and `worlds.png` (`worlds`) from
  `npm run golden -- --record --dir .private/golden`; `starter.png` from
  `npm run world-shots -- starter --stop everyone`, cropped to the world; `kits.png` from
  `npm run kit-sheet`.
- **docs/worlds.md**, the guide to making a world: any change to what a world gets or can do
  (the scene's fields, the messages between the frame and the page, the hooks and their
  defaults, the people and props kits, `world.json`) updates the guide, its starter world and
  its checklist in the same change. Write it for coding agents as much as for people: Claude Code
  should be able to make a world from the guide alone, so keep its examples runnable.
- **A new built-in world** goes in the README's list of worlds and the guide's catalogue, with
  its own screenshot in `docs/`.

The demo video is on demand, not part of this: update its tour (`scripts/demo-video.mjs`) or
record it (`npm run demo`) only when asked.

## Commits and releases

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `build:`, `ci:`, `chore:`; `!` or a `BREAKING CHANGE:` footer for a breaking change).
  release-please reads them to bump the version and write `CHANGELOG.md`: never edit either by hand.
- `main` takes changes only through pull requests. Work on `develop` or a feature branch.
- CI runs on Ubicloud's cheapest runner (`ubicloud-standard-2-ubuntu-2404`). Every job uses it.
