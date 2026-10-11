// What happened between two scenes, for every world alike: an agent came or changed its state, a compaction,
// a pull request merged, a deploy that ended, a message from one agent to another. The frame writes each in
// the diary; those marked `pop` the simulation also pops up where they happened, for everyone watching.
// No DOM and no three.js.

const STATE_WORDS = { waiting: 'waits for you', turn: 'finished its turn', working: 'gets to work', idle: 'rests', stale: 'went quiet' };

/**
 * The events from `prev` to `next` (two scenes, web/scene.js). With no `prev` (the world has just opened) only the
 * messages on their way are news: all else was already so. Each is { kind, text, cls, pop?, agent? | repo? } with
 * `agent` an agent's id and `repo` a repo's key: where it happened. `mail` events carry { from, to } instead.
 */
export function eventsOf(prev, next) {
  const out = [];
  const before = new Map((prev?.agents ?? []).map(a => [a.id, a]));
  for (const a of prev ? next.agents : []) {
    const was = before.get(a.id);
    if (!was) { out.push({ kind: 'arrive', agent: a.id, text: 'arrives', cls: '' }); continue; }
    if (a.state !== was.state && Object.hasOwn(STATE_WORDS, a.state)) out.push({ kind: 'state', agent: a.id, text: STATE_WORDS[a.state], cls: '' });
    if ((a.compactions ?? 0) > (was.compactions ?? 0)) out.push({ kind: 'compacted', agent: a.id, text: 'Compacted', cls: 'good', pop: true });
  }
  const repos = new Map((prev?.repos ?? []).map(r => [r.key, r]));
  for (const r of next.repos) {
    const was = repos.get(r.key);
    if (!was) continue;
    const merged = new Set((was.prs?.merged ?? []).map(p => p.number));
    for (const p of r.prs?.merged ?? []) if (!merged.has(p.number)) out.push({ kind: 'merged', repo: r.key, text: `Merged #${p.number}`, cls: 'good', pop: true });
    const state = r.deploy?.state ?? null;
    if (state !== (was.deploy?.state ?? null) && (state === 'ok' || state === 'failed')) out.push({ kind: state === 'ok' ? 'deployOk' : 'deployFailed', repo: r.key, text: state === 'ok' ? 'Deployed' : 'Deploy failed', cls: state === 'ok' ? 'good' : 'warn', pop: true });
  }
  const seen = new Set((prev?.mail ?? []).map(m => `${m.from}>${m.to}@${m.at}`));
  for (const m of next.mail ?? []) if (!seen.has(`${m.from}>${m.to}@${m.at}`)) out.push({ kind: 'mail', from: m.from, to: m.to, text: String(m.text ?? ''), cls: 'good' });
  return out;
}

/**
 * The bed of each repo of a scene (key → bed): the collector's, so every browser has the same; a scene that
 * names none (the test page's made-up ones) gets the first free bed for each repo, kept in `kept` while the
 * repo stays.
 */
export function bedsOf(repos, kept = new Map()) {
  const out = new Map(), taken = new Set();
  for (const r of repos) if (Number.isInteger(r.bed)) { out.set(r.key, r.bed); taken.add(r.bed); }
  for (const [key, bed] of kept) if (!repos.some(r => r.key === key) || out.has(key) || taken.has(bed)) kept.delete(key); else taken.add(bed);
  for (const r of repos) {
    if (out.has(r.key)) continue;
    if (!kept.has(r.key)) { let bed = 0; while (taken.has(bed)) bed++; kept.set(r.key, bed); taken.add(bed); }
    out.set(r.key, kept.get(r.key));
  }
  return out;
}
