// The collector, run: `agentville run` (bin/agentville.mjs) and `npm start` both come here. Nothing has to be set
// beforehand: its data is in ~/.agentville (made on the first run; a clone's old state is brought over once), its
// settings are in config.json there (saved from the dashboard's Settings window), and the programs it runs are
// found by the PATH your terminal has.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLogger, startCollector } from './collector.mjs';
import { CODE_ROOT, adoptLegacyData, dataDirOf } from './paths.mjs';
import { dropSessionEnv } from './lib/session-env.mjs';
import { fullPath, pathKey } from './platform/tools.mjs';

/** Starts the collector and keeps it: { stop, port() }. A setting that needs it started again (the port, sharing on the network) does that in this process. */
export async function runCollector({ codeRoot = CODE_ROOT, dataDir = dataDirOf() } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const log = makeLogger(join(dataDir, 'logs'));
  // From its own folder, not the one it was started in (a repo, say): Windows looks there for a program, and for what a program loads.
  try { process.chdir(dataDir); } catch (err) { log(`could not move to ${dataDir}: ${err?.message ?? err}`); }
  // (a second copy beside the first, with a data folder of its own, starts empty)
  try { if (!process.env.AGENTVILLE_HOME) adoptLegacyData({ codeRoot, dataDir, log }); } catch (err) { log(`an earlier install's data could not be brought over: ${err?.message ?? err}`); }
  process.env[pathKey()] = await fullPath();
  const inherited = dropSessionEnv(); // a collector started inside a session must not pass its markers on
  if (inherited.length) log(`started from inside a Claude Code session: ${inherited.join(', ')} left out of what it starts`);
  const pidFile = join(dataDir, 'collector.pid');
  let handle = null, turn = Promise.resolve();
  const start = async () => {
    handle = await startCollector({ root: dataDir, webDir: join(codeRoot, 'web'), modFrom: join(codeRoot, 'mod'), log, restart: () => (turn = turn.then(async () => {
      await handle.stop();
      await start();
    }).catch(err => { log(`could not start again: ${err?.stack ?? err}`); process.exit(1); })) });
  };
  try { await start(); } catch (err) { log(`failed to start: ${err?.stack ?? err}`); throw err; }
  writeFileSync(pidFile, `${process.pid}\n`);
  return {
    port: () => handle.port,
    async stop() { await turn; rmSync(pidFile, { force: true }); await handle.stop(); },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const running = await runCollector();
    const shutdown = async () => { await running.stop(); process.exit(0); };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}
