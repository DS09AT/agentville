# Changelog

## [0.3.1](https://github.com/DS09AT/agentville/compare/v0.3.0...v0.3.1) (2026-10-12)


### Bug Fixes

* keep the keyboard through redraws and Settings closed after a save ([2226d6d](https://github.com/DS09AT/agentville/commit/2226d6dc8137f1c8312bdb1b6c50f08936b058df))
* keep the keyboard where it was when the page is drawn anew ([3bf0277](https://github.com/DS09AT/agentville/commit/3bf02779683e8e147230a8d70810aa2e3ebef4ce))
* **mod:** answer and message sessions from the dashboard on Windows ([6022cc1](https://github.com/DS09AT/agentville/commit/6022cc1d92139272c61a6b957848c9453c37959f))
* **scripts:** check-world lines, new-world steps and Chrome on Windows ([37f5935](https://github.com/DS09AT/agentville/commit/37f593575ead63f51877379ff82ee22a552f6d05))
* Settings stays closed when a save finishes after you closed it ([0e2efd5](https://github.com/DS09AT/agentville/commit/0e2efd5206e97c8689f2c7c5f2c703785fbc7c06))
* **web:** Windows paths in the dashboard ([7c88a00](https://github.com/DS09AT/agentville/commit/7c88a00b8af832df198783ef676c30375edfa60b))
* **windows:** compare paths with either slash and in any case ([f6ac237](https://github.com/DS09AT/agentville/commit/f6ac23747d3f680fa54118f5cd02c34b59d20352))
* **windows:** retry a rename over a file that another process has open ([72a6cf5](https://github.com/DS09AT/agentville/commit/72a6cf54dadd1504e541a23c20f1e8e22e05e9eb))
* **windows:** sessions, terminals, the login entry and Explorer ([d6bf9f5](https://github.com/DS09AT/agentville/commit/d6bf9f57fdcea90ed57c13c282dba867368dfb38))


### Documentation

* Windows as checked on a real machine ([bac58c3](https://github.com/DS09AT/agentville/commit/bac58c39e5f39fc2c709fe612e04cb9ec884bf27))


### Tests

* ask the browser again when a question to a closing frame is never answered ([dd37453](https://github.com/DS09AT/agentville/commit/dd3745378036fef66a1a857bee330ecce3a44307))
* do not fail a browser run that passed over Chrome's leftover profile ([9356fd1](https://github.com/DS09AT/agentville/commit/9356fd1b2b1b97d1303858f75cb7771ec92265d7))
* press the page's buttons again until the page has taken them ([6767582](https://github.com/DS09AT/agentville/commit/67675824ab1cfc0050252a9be32d27f285f3a6d7))
* run the remaining tests on Windows as on macOS and Linux ([c4a8190](https://github.com/DS09AT/agentville/commit/c4a8190067a5aa63a695bcaa52093db1868a876d))

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
