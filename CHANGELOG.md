# Changelog

## [0.3.0](https://github.com/DS09AT/agentville/compare/v0.2.0...v0.3.0) (2026-10-11)


### Features

* draw worlds in 3D with three.js and keep the pixel engine as legacy ([6bc1b46](https://github.com/DS09AT/agentville/commit/6bc1b4687285e3f10f63da030e77bc2d2ba7cc08))


### Tests

* keep the keyboard on the headless page throughout the browser test ([115eb81](https://github.com/DS09AT/agentville/commit/115eb81949ad5b3b1f9158551f59fa32f6ba2f68))

## [0.2.0](https://github.com/DS09AT/agentville/compare/v0.1.0...v0.2.0) (2026-10-11)


### ⚠ BREAKING CHANGES

* `bin/agent-tracker`, `bin/run-collector.sh` and `launchd/local.agent-tracker.plist` are removed. Install with `npm install && npm link`, then run `agentville`. Data moves from the clone to `~/.agentville`; an existing clone's state is copied there once.

### Features

* **network:** guest password, address lists and HTTPS for network access ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))
* **notifications:** one switch for all system notifications ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))
* run on macOS, Linux and Windows through one `agentville` command ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))
* **settings:** edit every setting in the dashboard's Settings window ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))
* **web:** Screen switch that keeps a kiosk's display on ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))
* **worlds:** one world for everyone, moved by the collector ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))
* **worlds:** show how many viewers each world has ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))


### Bug Fixes

* **sessions:** quote terminal lines for every shell and refuse control characters ([a6938e6](https://github.com/DS09AT/agentville/commit/a6938e64e4d20f110a9d70929de44dfb763352af))


### Documentation

* rewrite the README and guides as short user manuals ([af03710](https://github.com/DS09AT/agentville/commit/af037100d957d40787747bcdc411399d7b22dd75))


### Tests

* keep the watch test of the farm animals off the hour of the day ([f127940](https://github.com/DS09AT/agentville/commit/f127940e8b2cc17972e49ca4a2773ae722bb2f6c))


### Continuous Integration

* run the tests on Ubicloud and release with release-please ([3459e90](https://github.com/DS09AT/agentville/commit/3459e90b12161cb876e2fd4c819307d6efc44347))
* stop the browser test hanging and run the unit and browser tests as parallel jobs ([26bfa76](https://github.com/DS09AT/agentville/commit/26bfa76a40a85709a1028d29e4e4d20306c26129))
