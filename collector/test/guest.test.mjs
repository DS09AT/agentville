import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTrackerServer, guestSnapshot } from '../server.mjs';

const agent = {
  id: 's1', kind: 'interactive', name: 'shop', cwd: '/p/shop', state: 'working', stateReason: 'running Bash', stateSince: 5,
  lastPrompt: 'fix the cart', lastReply: 'On it.', question: 'Push it?', ask: { kind: 'question', questions: ['Which one?'] }, asides: [{ q: 'why?' }],
  now: { tool: 'Bash', summary: 'npm test -- cart', step: 'test', startedAt: 4 },
  tasks: { done: 1, total: 2, items: [{ text: 'Write the test', status: 'completed' }] },
  feed: [{ at: 1, kind: 'prompt', text: 'fix the cart' }],
  children: [{ id: 'c1', kind: 'subagent', agentType: 'Explore', label: 'Find callers', state: 'running', startedAt: 2, background: true, now: { tool: 'Grep', summary: 'cart', step: 'search', startedAt: 3 }, steps: 4, lastSaid: 'Found 3.', lastAt: 3, result: 'Three callers.' }],
  docs: [{ path: '/p/shop/plan.md', wrote: true, at: 1 }], shells: [{ pid: 9, command: 'npm test' }],
  touching: [{ path: '/p/shop/src', mode: 'write', repo: '/p/shop' }], timeline: [{ at: 1, tool: 'Bash' }],
  work: { steps: { edit: 3, test: 1 }, failed: 0, streak: 0, lastTest: { ok: true, at: 4 } }, // counts only: nothing that was said
};
const snapshot = { generatedAt: 1, counts: { working: 1 }, repos: [{ path: '/p/shop', name: 'shop' }], agents: [agent], collisions: [] };

test('a guest snapshot keeps who works where with what tool, and drops everything that was said', () => {
  const g = guestSnapshot(snapshot);
  assert.deepEqual(g.agents[0], {
    id: 's1', kind: 'interactive', name: 'shop', cwd: '/p/shop', state: 'working', stateReason: 'running Bash', stateSince: 5,
    touching: agent.touching, timeline: agent.timeline, work: agent.work,
    now: { tool: 'Bash', step: 'test', startedAt: 4 }, tasks: { done: 1, total: 2, items: [] }, feed: [],
    children: [{ id: 'c1', kind: 'subagent', agentType: 'Explore', label: '', state: 'running', startedAt: 2, background: true, now: { tool: 'Grep', step: 'search', startedAt: 3 }, steps: 4, lastAt: 3, endedAt: undefined }],
    docs: [],
  });
  assert.doesNotMatch(JSON.stringify(g), /cart|On it|Push it|Which one|why\?|Find callers|Found 3|Three callers|plan\.md|npm test/);
  assert.deepEqual([g.repos, g.counts], [snapshot.repos, snapshot.counts]);
  assert.equal(agent.lastReply, 'On it.', 'the snapshot itself is left alone');
});

const get = (host, port, path, { method = 'GET', headers = {} } = {}) => new Promise((resolve, reject) => {
  const req = request({ host, port, path, method, headers: { host: `${host}:${port}`, ...headers } }, res => {
    let body = '';
    res.on('data', d => { body += d; if (path === '/api/events') { res.destroy(); resolve({ status: res.statusCode, body }); } });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.end(method === 'POST' ? '{}' : undefined);
});

test('with the network open, a visitor from it gets no token, no words and no way to act; this Mac keeps all three', async t => {
  const own = Object.values(networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address;
  if (!own) return t.skip('this machine has no network address to visit from');
  const webFile = join(mkdtempSync(join(tmpdir(), 'tracker-guest-')), 'index.html');
  writeFileSync(webFile, '<html>token=__TRACKER_TOKEN__</html>');
  const acted = [];
  const srv = createTrackerServer({
    port: 0, token: 'tok', webFile, lan: true, log: () => {}, getSnapshot: () => snapshot,
    getFeed: () => [{ at: 1, kind: 'prompt', text: 'fix the cart' }], getConversation: async () => ({ total: 1, from: 0, items: [] }),
    actions: { reload: async () => { acted.push('reload'); return { ok: true }; } },
  });
  const port = await srv.listen();
  try {
    assert.equal((await get(own, port, '/')).body, '<html>token=</html>');
    const state = await get(own, port, '/api/state');
    assert.deepEqual(JSON.parse(state.body), JSON.parse(JSON.stringify(guestSnapshot(snapshot))));
    const stream = await get(own, port, '/api/events');
    assert.match(stream.body, /^event: snapshot/);
    assert.doesNotMatch(stream.body, /fix the cart|On it/);
    for (const path of ['/api/agent/s1/feed', '/api/agent/s1/conversation', '/agent/s1/transcript', '/api/sessions', '/raw/x/y']) {
      assert.equal((await get(own, port, path, { headers: { 'x-tracker-token': 'tok' } })).status, 403, path);
    }
    const post = { method: 'POST', headers: { 'x-tracker-token': 'tok', 'content-type': 'application/json' } };
    assert.equal((await get(own, port, '/api/actions/reload', { ...post, headers: { ...post.headers, origin: `http://${own}:${port}` } })).status, 403);

    assert.equal((await get('127.0.0.1', port, '/')).body, '<html>token=tok</html>');
    assert.match((await get('127.0.0.1', port, '/api/state')).body, /On it\./);
    assert.match((await get('127.0.0.1', port, '/api/agent/s1/feed')).body, /fix the cart/);
    assert.equal((await get('127.0.0.1', port, '/api/actions/reload', { ...post, headers: { ...post.headers, origin: `http://127.0.0.1:${port}` } })).status, 200);
    assert.deepEqual(acted, ['reload']);
  } finally {
    await srv.close();
  }
});
