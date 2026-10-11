// Where Agentville's code is and where its data is kept. The code is wherever it was installed (npm's
// global folder, or a clone); the data (config.json, state/, logs/, mod/, worlds/) is in one folder of
// your own, ~/.agentville on every system, so the code can be replaced without touching it.
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CODE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The data folder: ~/.agentville, or AGENTVILLE_HOME for a second copy beside it (a test, a demo). */
export const dataDirOf = (env = process.env, home = homedir()) => (env.AGENTVILLE_HOME ? resolve(env.AGENTVILLE_HOME) : join(home, '.agentville'));

/**
 * Agentville used to keep its data beside its code (a clone's state/ and config.json). The first time
 * the data folder has no state of its own, what the clone holds is copied there (the clone's copy is
 * left alone): the token, your notes, what waits for a session. Returns what was brought over.
 */
export function adoptLegacyData({ codeRoot = CODE_ROOT, dataDir, log = () => {} }) {
  const brought = [];
  if (resolve(codeRoot) === resolve(dataDir)) return brought;
  mkdirSync(dataDir, { recursive: true });
  if (!existsSync(join(dataDir, 'state')) && existsSync(join(codeRoot, 'state', 'token'))) {
    cpSync(join(codeRoot, 'state'), join(dataDir, 'state'), { recursive: true, preserveTimestamps: true });
    try { chmodSync(join(dataDir, 'state', 'token'), 0o600); } catch { /* a system without modes */ }
    brought.push('state');
  }
  if (!existsSync(join(dataDir, 'config.json')) && existsSync(join(codeRoot, 'config.json')) && existsSync(join(codeRoot, 'collector', 'index.mjs'))) {
    copyFileSync(join(codeRoot, 'config.json'), join(dataDir, 'config.json'));
    brought.push('config.json');
  }
  if (brought.length) log(`brought over from ${codeRoot}: ${brought.join(', ')} (now kept in ${dataDir})`);
  return brought;
}
