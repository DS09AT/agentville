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
  touching: [{ path: '/p/shop/src/checkout.ts', mode: 'write', lastAt: 3, repo: '/p/shop' }, { path: '/etc/hosts', mode: 'read', lastAt: 2 }], timeline: [{ at: 1, tool: 'Bash' }],
  work: { steps: { edit: 3, test: 1 }, failed: 0, streak: 0, lastTest: { ok: true, at: 4 } }, // counts only: nothing that was said
};
const snapshot = { generatedAt: 1, counts: { working: 1 }, repos: [{ path: '/p/shop', name: 'shop' }], agents: [agent], collisions: [] };

test('a guest snapshot keeps who works where with what tool, and drops everything that was said', () => {
  const g = guestSnapshot(snapshot);
  assert.deepEqual(g.agents[0], {
    id: 's1', kind: 'interactive', name: 'shop', cwd: '/p/shop', state: 'working', stateReason: 'running Bash', stateSince: 5,
    touching: [{ path: '/p/shop', mode: 'write', lastAt: 3, repo: '/p/shop' }], timeline: agent.timeline, work: agent.work,
    now: { tool: 'Bash', step: 'test', startedAt: 4 }, tasks: { done: 1, total: 2, items: [] }, feed: [],
    children: [{ id: 'c1', kind: 'subagent', agentType: 'Explore', label: '', state: 'running', startedAt: 2, background: true, now: { tool: 'Grep', step: 'search', startedAt: 3 }, steps: 4, lastAt: 3, endedAt: undefined }],
    docs: [],
  });
  assert.doesNotMatch(JSON.stringify(g), /cart|On it|Push it|Which one|why\?|Find callers|Found 3|Three callers|plan\.md|npm test|checkout\.ts|etc\/hosts/);
  assert.deepEqual([g.repos, g.counts], [snapshot.repos, snapshot.counts]);
  assert.equal(agent.lastReply, 'On it.', 'the snapshot itself is left alone');
});

test("a guest's agent between two steps keeps its last tool (the step alone, never its words), and a connector call its server's name: its farmer is drawn as yours is", () => {
  const between = { ...agent, now: undefined, feed: [{ at: 9, kind: 'reply', text: 'On it.' }, { at: 8, kind: 'tool', tool: 'Edit', step: 'edit', summary: 'src/checkout.ts' }, { at: 7, kind: 'tool', tool: 'Bash', step: 'test', summary: 'npm test -- cart' }] };
  const calling = { ...agent, id: 's2', now: { tool: 'mcp__notes__search', step: 'mcp', service: 'notes', summary: 'cart', startedAt: 4 } };
  const fetching = { ...agent, id: 's3', now: { tool: 'WebFetch', step: 'web', service: 'shop.example', summary: 'https://shop.example/cart', startedAt: 4 } };
  const g = guestSnapshot({ ...snapshot, agents: [between, calling, fetching] });
  assert.deepEqual(g.agents[0].feed, [{ at: 8, kind: 'tool', tool: 'Edit', step: 'edit' }], 'the newest tool step, as a tool and a kind of step');
  assert.deepEqual(g.agents[1].now, { tool: 'mcp__notes__search', step: 'mcp', startedAt: 4, service: 'notes' }, "a connector's name (the tool's own name has it)");
  assert.deepEqual(g.agents[2].now, { tool: 'WebFetch', step: 'web', startedAt: 4 }, 'never where a web call goes');
  assert.doesNotMatch(JSON.stringify(g), /On it|checkout\.ts|npm test|shop\.example/);
  // that a message went between two agents (the pigeon that carries it), never what it said
  const mailed = guestSnapshot({ ...snapshot, agents: [{ ...agent, feed: [{ at: 9, kind: 'peer', dir: 'out', other: 'api', text: 'the cart endpoint is ready' }, { at: 8, kind: 'peer', dir: 'in', other: 'helper', helper: true, text: 'a name for you' }, { at: 7, kind: 'tool', tool: 'Edit', step: 'edit', summary: 'x' }] }] });
  assert.deepEqual(mailed.agents[0].feed, [{ at: 7, kind: 'tool', tool: 'Edit', step: 'edit' }, { at: 9, kind: 'peer', dir: 'out', other: 'api' }]);
  assert.doesNotMatch(JSON.stringify(mailed), /endpoint is ready|a name for you/);
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

test('a guest snapshot says which source fails, not with what words, and keeps the helper’s last error to itself', () => {
  const g = guestSnapshot({ ...snapshot, sources: { git: { ok: true, at: 1 }, prs: { ok: false, error: 'gh: /Users/me/secret-repo: not found', at: 2 } }, helper: { on: true, lastError: 'quota for key sk-123', today: { calls: 1 } } });
  assert.deepEqual(g.sources, { git: { ok: true, at: 1 }, prs: { ok: false, error: 'failing', at: 2 } });
  assert.deepEqual(g.helper, { on: true, lastError: null, today: { calls: 1 } });
  assert.doesNotMatch(JSON.stringify(g), /secret-repo|sk-123/);
});

test('a guest snapshot has your accounts by name and limits only, and none of the helper’s lines', () => {
  const plan = { windows: [{ kind: 'seven_day', percentUsed: 40 }] };
  const g = guestSnapshot({ ...snapshot, accounts: [{ key: 'main', name: 'Work', email: 'me@example.com', org: 'Acme', signedIn: true, plan, open: 2, costUsd: 12 }], chatter: { at: 1, lines: [{ kind: 'cat', when: 'idle', text: 'the cart test failed again' }] } });
  assert.deepEqual(g.accounts, [{ key: 'main', name: 'Work', plan }]);
  assert.equal(g.chatter, null);
  assert.doesNotMatch(JSON.stringify(g), /example\.com|Acme|cart test/);
  assert.deepEqual(guestSnapshot(snapshot).accounts, [], 'a snapshot without accounts: none');
});

test('tennis scores keep numbers and roles while subagent task labels stay private', () => {
  const g = guestSnapshot({ ...snapshot, tennis: { '/p/shop': { parent: 's1', names: { s1: 'shop', c1: 'private customer credentials', '@machine': 'Ball machine' }, teams: [['s1'], ['c1']], points: ['15', '30'] } } });
  assert.equal(g.tennis['/p/shop'].names.c1, 'Subagent');
  assert.deepEqual(g.tennis['/p/shop'].points, ['15', '30']);
  assert.ok(!JSON.stringify(g).includes('private customer credentials'));
});
