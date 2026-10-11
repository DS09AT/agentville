import { SessionModel } from '../transcript/session-model.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../config.mjs';
import { applySince, buildAgent, codexChildrenOf, countStates, effortOf, modeOf, nowOf, sortAgents, tasksOf, turnOf } from '../derive/agent.mjs';
import { at, modelOf, prompt, reply, title, toolResult, toolUse, turnEnd } from './fixtures.mjs';

const cfg = { ...DEFAULTS };
const repoOf = p => (p.startsWith('/p/backend') ? '/p/backend' : null);
const base = (over = {}) => ({ id: 's1', kind: 'interactive', name: 'my-app', cwd: '/p', pid: 10, ...over });

test('buildAgent assembles state, now, feed, process and repo-mapped touches', () => {
  const m = modelOf(
    title('Fix invoices'),
    prompt(0, 'fix it'),
    toolUse(5, 't1', 'Edit', { file_path: '/p/backend/src/a.ts' }),
    toolResult(6, 't1'),
    toolUse(7, 't2', 'Bash', { command: 'npm test', description: 'Run tests' }, '/p/backend'),
  );
  const a = buildAgent({
    base: base({ cliId: 'abc' }), model: m, registry: { status: 'busy' },
    proc: { cpu: 5, rssMb: 300, childCount: 1, children: ['node x'] }, cpuHistory: [{ at: at(7), cpu: 5, rssMb: 300 }],
    repoOf, now: at(8), cfg, home: '/h',
  });
  assert.equal(a.state, 'working');
  assert.equal(a.name, 'my-app');
  assert.equal(a.title, 'Fix invoices');
  assert.equal(a.cliId, 'abc');
  assert.deepEqual(a.now, { tool: 'Bash', summary: 'Run tests', step: 'test', startedAt: at(7) });
  assert.equal(a.feed[0].tool, 'Bash');
  assert.equal(a.touching.find(t => t.mode === 'write').repo, '/p/backend');
  assert.deepEqual(a.proc.history, { at: [at(7)], cpu: [5], rssMb: [300] });
  assert.equal(a.lastPrompt, 'fix it');
});

test('name falls back to the transcript title, then the folder name', () => {
  const titled = buildAgent({ base: base({ name: '' }), model: modelOf(title('Fix invoices')), repoOf, now: at(0), cfg, home: '/h' });
  assert.equal(titled.name, 'Fix invoices');
  const bare = buildAgent({ base: base({ name: '', cwd: '/x/site' }), model: null, repoOf, now: at(0), cfg, home: '/h' });
  assert.equal(bare.name, 'site');
});

test('codex agents take their state and last reply from their thread, their name from their folder, and have no feed', () => {
  const base = { id: 'codex:t1', kind: 'codex', name: undefined, cwd: '/p/shop' };
  const a = buildAgent({ base, model: null, codex: { turnOpen: true, lastActivityAt: at(0), lastTurnEndAt: 0, lastReply: null }, repoOf, now: at(1), cfg, home: '/h' });
  assert.deepEqual([a.state, a.name, a.cwd, a.lastActivityAt], ['working', 'shop', '/p/shop', at(0)]);
  assert.deepEqual(a.feed, []);
  const done = buildAgent({ base: { ...base, name: 'Fix the cart' }, model: null, codex: { turnOpen: false, lastActivityAt: at(5), lastTurnEndAt: at(5), lastReply: 'Done.' }, repoOf, now: at(9), cfg, home: '/h' });
  assert.deepEqual([done.state, done.name, done.lastReply, done.sinceHint], ['yourTurn', 'Fix the cart', 'Done.', at(5)]);
});

test("a subagent's own transcript keeps it running, and its calls count as the parent's touches", () => {
  const parent = modelOf(prompt(0, 'go'), toolUse(1, 'tA', 'Agent', { description: 'Find routes', run_in_background: true }), toolResult(2, 'tA'));
  const child = modelOf(prompt(1, 'task'), toolUse(50, 'c1', 'Edit', { file_path: '/p/backend/x.ts' }));
  const a = buildAgent({ base: base(), model: parent, childModels: new Map([['tA', child]]), repoOf, now: at(55), cfg, home: '/h' });
  assert.equal(a.children[0].state, 'running');
  assert.equal(a.children[0].now.tool, 'Edit');
  assert.ok(a.touching.some(t => t.repo === '/p/backend' && t.mode === 'write'));
});

test("each subagent goes out with its steps so far, what it last said, its step now in words, and once done its result", () => {
  const finished = JSON.stringify({ type: 'user', timestamp: new Date(at(40)).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'tB', content: 'No blocking issues.\nTwo nits.' }] } });
  const parent = modelOf(prompt(0, 'go'),
    toolUse(1, 'tA', 'Agent', { description: 'Find callers', subagent_type: 'Explore', prompt: 'Find every caller of createOrder' }),
    toolUse(2, 'tB', 'Agent', { description: 'Review it', subagent_type: 'code-reviewer', prompt: 'Review' }), finished);
  const working = modelOf(prompt(1, 'Find every caller of createOrder'), toolUse(3, 'c1', 'Read', { file_path: '/w/a.ts' }), toolResult(4, 'c1'), reply(5, 'Two callers so far.\nChecking the webhook.'), toolUse(50, 'c2', 'Grep', { pattern: 'createOrder', path: '/w/src' }));
  const reviewed = modelOf(prompt(2, 'Review'), toolUse(10, 'r1', 'Read', { file_path: '/w/order.ts' }), toolResult(11, 'r1'), reply(39, 'No blocking issues.'));
  const a = buildAgent({ base: base(), model: parent, childModels: new Map([['tA', working], ['tB', reviewed]]), repoOf, now: at(55), cfg, home: '/h' });
  const [review, explore] = a.children;
  assert.deepEqual({ ...explore, now: undefined }, { id: 'tA', kind: 'subagent', agentType: 'Explore', label: 'Find callers', state: 'running', startedAt: at(1), background: false, now: undefined, steps: 2, lastSaid: 'Two callers so far.', lastAt: at(50), endedAt: undefined, result: undefined });
  assert.equal(explore.now.tool, 'Grep');
  assert.match(explore.now.summary, /createOrder/);
  assert.deepEqual([review.state, review.steps, review.endedAt, review.result, review.lastSaid], ['done', 1, at(40), 'No blocking issues.', 'No blocking issues.']);
});

test('finished children older than an hour are dropped', () => {
  const parent = modelOf(prompt(0, 'go'), toolUse(1, 'tA', 'Agent', { description: 'Old' }), toolResult(2, 'tA'));
  const a = buildAgent({ base: base(), model: parent, repoOf, now: at(2 + 3700), cfg, home: '/h' });
  assert.deepEqual(a.children, []);
});

test('applySince keeps the first time an agent entered its state', () => {
  const first = applySince({ id: 'a', state: 'working', sinceHint: undefined }, undefined, 1000);
  assert.equal(first.stateSince, 1000);
  assert.equal('sinceHint' in first, false);
  const again = applySince({ id: 'a', state: 'working' }, first, 5000);
  assert.equal(again.stateSince, 1000);
  const moved = applySince({ id: 'a', state: 'yourTurn', sinceHint: 4000 }, again, 6000);
  assert.equal(moved.stateSince, 4000);
  const switched = applySince({ id: 'a', state: 'idle' }, moved, 7000);
  assert.equal(switched.stateSince, 7000);
});

test('sortAgents orders by state, then newest activity', () => {
  const list = [
    { id: 'i', state: 'idle' },
    { id: 'w1', state: 'working', lastActivityAt: 1 },
    { id: 'q', state: 'waiting' },
    { id: 'w2', state: 'working', lastActivityAt: 2 },
    { id: 's', state: 'stale' },
    { id: 'y', state: 'yourTurn' },
  ];
  assert.deepEqual(sortAgents(list).map(a => a.id), ['q', 'w2', 'w1', 'y', 's', 'i']);
});

test('countStates counts each state and the collisions', () => {
  assert.deepEqual(countStates([{ state: 'working' }, { state: 'working' }, { state: 'stale' }], [{}]), { waiting: 0, working: 2, yourTurn: 0, stale: 1, idle: 0, collisions: 1 });
});

test('an offered question that is still pending can be answered from the dashboard', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_Q1', 'AskUserQuestion', { questions: [{ question: 'Pick a colour?' }] }));
  const questions = [{ question: 'Pick a colour?', header: 'Colour', multiSelect: false, options: [{ label: 'Red' }, { label: 'Blue' }] }];
  const a = buildAgent({ base: base(), model: m, offer: { kind: 'question', toolUseId: 'toolu_Q1', createdAt: at(5), heartbeatAt: at(6), questions }, repoOf, now: at(6), cfg, home: '/h' });
  assert.equal(a.state, 'waiting');
  assert.deepEqual(a.ask, { kind: 'question', toolUseId: 'toolu_Q1', questions });
});

test("a question the mod offers counts before Claude Code writes it to the transcript (it now writes it once answered): the agent waits", () => {
  const m = modelOf(prompt(0, 'go'), reply(3, 'A few points could go two ways; I will check them with you.'));
  const questions = [{ question: 'Drop the quote?', header: 'About', multiSelect: false, options: [{ label: 'Yes' }, { label: 'No' }] }];
  const a = buildAgent({ base: base(), model: m, offer: { kind: 'question', toolUseId: 'toolu_Q9', createdAt: at(5), heartbeatAt: at(6), questions }, repoOf, now: at(6), cfg, home: '/h' });
  assert.deepEqual([a.state, a.stateReason, a.sinceHint], ['waiting', 'question pending', at(5)]);
  assert.deepEqual(a.ask, { kind: 'question', toolUseId: 'toolu_Q9', questions });
  const answered = modelOf(prompt(0, 'go'), toolUse(7, 'toolu_Q9', 'AskUserQuestion'), toolResult(7, 'toolu_Q9')); // written together, once answered
  assert.equal(buildAgent({ base: base(), model: answered, offer: { kind: 'question', toolUseId: 'toolu_Q9', createdAt: at(5), heartbeatAt: at(7), questions }, repoOf, now: at(7), cfg, home: '/h' }).ask, undefined);
});

test('an offered question that was already answered in the terminal is not answerable', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_Q1', 'AskUserQuestion'), toolResult(7, 'toolu_Q1'));
  const a = buildAgent({ base: base(), model: m, offer: { kind: 'question', toolUseId: 'toolu_Q1', createdAt: at(5), questions: [] }, repoOf, now: at(8), cfg, home: '/h' });
  assert.equal(a.ask, undefined);
});

test('an offered permission prompt makes the agent certainly waiting, with Allow/Deny details', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_P1', 'Bash', { command: 'mkdir /tmp/x' }));
  const offer = { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'mkdir /tmp/x', createdAt: at(5), heartbeatAt: at(6), expiresAt: at(20) };
  const a = buildAgent({ base: base(), model: m, registry: { status: 'busy' }, cpuHistory: [{ at: at(5), cpu: 40 }], offer, repoOf, now: at(6), cfg, home: '/h' });
  assert.equal(a.state, 'waiting');
  assert.equal(a.stateReason, 'permission needed: Bash');
  assert.equal(a.sinceHint, at(5));
  assert.deepEqual(a.ask, { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'mkdir /tmp/x', expiresAt: at(20) });
});

test("a permission offer from a session whose mode decides without you (bypass, auto, don't ask) is not shown: nobody has to answer it", () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_P1', 'mcp__claude-in-chrome__navigate', { url: 'http://localhost' }));
  const offer = { kind: 'permission', toolUseId: 'toolu_P1', tool: 'mcp__claude-in-chrome__navigate', summary: 'http://localhost', createdAt: at(5), heartbeatAt: at(6), expiresAt: at(20) };
  const agentIn = command => buildAgent({ base: base(), model: m, registry: { status: 'busy' }, command, cpuHistory: [{ at: at(5), cpu: 40 }], offer, repoOf, now: at(6), cfg, home: '/h' });
  for (const command of ['claude --dangerously-skip-permissions', 'claude --permission-mode auto', 'claude --permission-mode dontAsk']) {
    const a = agentIn(command);
    assert.deepEqual([a.state, a.ask], ['working', undefined], command);
  }
  for (const command of ['claude', 'claude --permission-mode acceptEdits']) assert.equal(agentIn(command).stateReason, 'permission needed: mcp__claude-in-chrome__navigate', command);
});

test('the shell commands it runs now, each matched to its Bash call: background or not, its output file, its time, CPU and memory', () => {
  const started = sec => JSON.stringify({ type: 'user', timestamp: new Date(at(sec)).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'bg1', content: 'Command running in background with ID: bgx. Output is being written to: /private/tmp/claude-501/-p/s1/tasks/bgx.output' }] } });
  const m = modelOf(prompt(0, 'go'), toolUse(2, 'bg1', 'Bash', { command: 'npm run dev', description: 'Start the dev server', run_in_background: true }), started(2), toolUse(5, 'fg1', 'Bash', { command: 'npm test' }));
  const shells = [{ pid: 110, command: 'npm run dev', startedAt: at(2), cpu: 20, rssMb: 100 }, { pid: 120, command: 'npm test', startedAt: at(5), cpu: 50, rssMb: 200 }, { pid: 130, command: 'make\nmake install', startedAt: at(1), cpu: 0, rssMb: 1 }];
  const a = buildAgent({ base: base(), model: m, shells, repoOf, now: at(10), cfg, home: '/h' });
  assert.deepEqual(a.shells, [
    { pid: 110, command: 'npm run dev', about: 'Start the dev server', startedAt: at(2), cpu: 20, rssMb: 100, background: true, toolUseId: 'bg1', output: true },
    { pid: 120, command: 'npm test', startedAt: at(5), cpu: 50, rssMb: 200, background: false, toolUseId: 'fg1', output: false },
    { pid: 130, command: 'make', startedAt: at(1), cpu: 0, rssMb: 1, background: false, output: false }, // a subagent's, or one the transcript hasn't written yet: its first line
  ]);
  assert.equal(buildAgent({ base: base(), model: m, repoOf, now: at(10), cfg, home: '/h' }).shells, undefined);
  const later = modelOf(prompt(50, 'later')); // after a restart: the call is in the part of the transcript read in the background
  later.addEarlierBackground([{ id: 'bg9', name: 'Bash', input: { command: 'npm run dev', run_in_background: true }, background: true, at: at(1), outputPath: '/private/tmp/claude-501/-p/s1/tasks/b9.output' }]);
  assert.deepEqual(buildAgent({ base: base(), model: later, shells: [shells[0]], repoOf, now: at(60), cfg, home: '/h' }).shells.map(s => [s.toolUseId, s.background, s.output]), [['bg9', true, true]]);
});

test('the MCP servers it called in the last hour, newest first, for their carts on the farm', () => {
  const m = modelOf(prompt(0, 'go'),
    toolUse(10, 'm1', 'mcp__claude_ai_Gmail__search_threads', { query: 'x' }), toolResult(11, 'm1'),
    toolUse(20, 'm2', 'mcp__playwright__browser_navigate', { url: 'http://localhost' }), toolResult(21, 'm2'),
    toolUse(30, 'm3', 'mcp__claude_ai_Gmail__get_thread', { id: 'x' }), toolResult(31, 'm3'),
    toolUse(40, 'b1', 'Bash', { command: 'ls' }));
  assert.deepEqual(buildAgent({ base: base(), model: m, repoOf, now: at(50), cfg, home: '/h' }).mcp, [{ server: 'Gmail', at: at(30) }, { server: 'playwright', at: at(20) }]);
  assert.deepEqual(buildAgent({ base: base(), model: m, repoOf, now: at(50) + 3_600_000, cfg, home: '/h' }).mcp, undefined, 'an hour later: none');
});

test("Claude Code's options after Always allow… keep the agent waiting, each worded from its suggestion", () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_P1', 'Bash', { command: 'npm test' }));
  const suggestions = [
    { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }], behavior: 'allow', destination: 'localSettings' },
    { type: 'addDirectories', directories: ['/Users/me'], destination: 'localSettings' },
    { type: 'addDirectories', directories: ['/Users/me/a', '/Users/me/b'], destination: 'session' },
    { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    null, // one the collector could not read
    { type: 'setMode', mode: 'auto', destination: 'session' },
    { type: 'addRules', rules: [{ toolName: 'WebFetch', ruleContent: 'domain:example.com' }, { toolName: 'Read' }], behavior: 'allow', destination: 'userSettings' },
  ];
  const offer = { kind: 'always', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'npm test', suggestions, createdAt: at(5), heartbeatAt: at(6), expiresAt: at(14) };
  const a = buildAgent({ base: base(), model: m, registry: { status: 'busy' }, offer, repoOf, now: at(6), cfg, home: '/h' });
  assert.equal(a.state, 'waiting');
  assert.deepEqual(a.ask.options.map(o => o.label), [
    'Always allow Bash(npm test:*) in this project (just you)',
    'Always allow access to /Users/me from this project (just you)',
    'Allow access to /Users/me/a and /Users/me/b for this session',
    'Accept edits for this session',
    'Switch to auto mode for this session',
    'Always allow WebFetch(domain:example.com) and Read everywhere',
  ]);
  assert.deepEqual(a.ask.options.map(o => o.option), [0, 1, 2, 3, 5, 6], 'each keeps its place in Claude Code\'s list');
  assert.deepEqual({ ...a.ask, options: undefined }, { kind: 'always', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'npm test', options: undefined, expiresAt: at(14) });
});

test('an expired permission offer is ignored', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_P1', 'Bash'));
  const offer = { kind: 'permission', toolUseId: 'toolu_P1', tool: 'Bash', summary: 'x', createdAt: at(5), expiresAt: at(20) };
  const a = buildAgent({ base: base(), model: m, registry: { status: 'busy' }, offer, repoOf, now: at(21), cfg, home: '/h' });
  assert.equal(a.state, 'working');
  assert.equal(a.ask, undefined);
});

test('process history keeps the last 200 samples for the 10-minute charts', () => {
  const hist = Array.from({ length: 250 }, (_, i) => ({ at: at(i * 3), cpu: i, rssMb: 100 + i }));
  const a = buildAgent({ base: base(), model: null, proc: { cpu: 1, rssMb: 1, childCount: 0, children: [] }, cpuHistory: hist, repoOf, now: at(750), cfg, home: '/h' });
  assert.equal(a.proc.history.cpu.length, 200);
  assert.equal(a.proc.history.cpu[0], 50);
  assert.equal(a.proc.history.rssMb.at(-1), 349);
});

test('activity counts tool calls per minute over the last 30 minutes, newest last', () => {
  const m = modelOf(
    prompt(0, 'go'),
    toolUse(10, 't1', 'Read', { file_path: '/a' }),
    toolUse(20, 't2', 'Read', { file_path: '/b' }),
    toolUse(29 * 60 + 5, 't3', 'Bash', { command: 'ls' }),
  );
  const a = buildAgent({ base: base(), model: m, repoOf, now: at(30 * 60), cfg, home: '/h' });
  assert.equal(a.activity.length, 30);
  assert.equal(a.activity[0], 2);
  assert.equal(a.activity[29], 1);
  assert.equal(a.activity.reduce((t, n) => t + n, 0), 3);
});

test('the timeline lists recent tool calls with their time, newest last', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 't1', 'Edit', { file_path: '/a' }), toolUse(9, 't2', 'Bash', { command: 'ls' }));
  const a = buildAgent({ base: base(), model: m, repoOf, now: at(10), cfg, home: '/h' });
  assert.deepEqual(a.timeline, [{ at: at(5), tool: 'Edit', step: 'edit' }, { at: at(9), tool: 'Bash', step: 'read' }], 'each with the kind of step it is (ls is a look round)');
});

test('an offer whose mod stopped refreshing it is not answerable, so the page cannot promise a delivery', () => {
  const m = modelOf(prompt(0, 'go'), toolUse(5, 'toolu_Q1', 'AskUserQuestion'));
  const offer = { kind: 'question', toolUseId: 'toolu_Q1', createdAt: at(5), heartbeatAt: at(6), questions: [] };
  assert.notEqual(buildAgent({ base: base(), model: m, offer, repoOf, now: at(10), cfg, home: '/h' }).ask, undefined);
  assert.equal(buildAgent({ base: base(), model: m, offer, repoOf, now: at(12), cfg, home: '/h' }).ask, undefined);
});

test("an agent shows whether its session's mod is listening for dashboard answers", () => {
  const listening = buildAgent({ base: base(), model: null, beacon: { version: '0.2.0', live: true }, repoOf, now: at(0), cfg, home: '/h' });
  assert.deepEqual(listening.mod, { version: '0.2.0', live: true });
  assert.equal(buildAgent({ base: base(), model: null, repoOf, now: at(0), cfg, home: '/h' }).mod, undefined);
});

test("an agent carries its session's cost and context from its mod; the plan's windows stay out of it", () => {
  const beacon = { version: '0.4.0', live: true, usage: { costUsd: 2.5, contextPercent: 41.5, rateLimits: [{ kind: 'five_hour', percentUsed: 30, resetsAt: null }] } };
  const a = buildAgent({ base: base(), model: null, beacon, repoOf, now: at(0), cfg, home: '/h' });
  assert.deepEqual(a.usage, { costUsd: 2.5, contextPercent: 41.5 });
  assert.deepEqual(a.mod, { version: '0.4.0', live: true });
  assert.equal(buildAgent({ base: base(), model: null, beacon: { version: '0.3.1', live: true }, repoOf, now: at(0), cfg, home: '/h' }).usage, undefined);
});

test('documents come from the session and its subagents, newest first', () => {
  const parent = modelOf(prompt(0, 'go'), toolUse(1, 'p1', 'Read', { file_path: '/p/README.md' }), toolUse(3, 'p2', 'Write', { file_path: '/p/docs/spec.md' }));
  const child = modelOf(prompt(1, 'task'), toolUse(2, 'c1', 'Write', { file_path: '/p/docs/plan.md' }), toolUse(4, 'c2', 'Read', { file_path: '/p/README.md' }));
  const a = buildAgent({ base: base(), model: parent, childModels: new Map([['tA', child]]), repoOf, now: at(5), cfg, home: '/h' });
  assert.deepEqual(a.docs, [
    { path: '/p/README.md', wrote: false, at: at(4) },
    { path: '/p/docs/spec.md', wrote: true, at: at(3) },
    { path: '/p/docs/plan.md', wrote: true, at: at(2) },
  ]);
  assert.deepEqual(buildAgent({ base: base(), model: null, repoOf, now: at(5), cfg, home: '/h' }).docs, []);
});

test("children carry their subagent type", () => {
  const parent = modelOf(prompt(0, 'go'), toolUse(1, 'tE', 'Agent', { description: 'Look around', subagent_type: 'Explore' }));
  const a = buildAgent({ base: base(), model: parent, repoOf, now: at(2), cfg, home: '/h' });
  assert.equal(a.children[0].agentType, 'Explore');
});

test('an agent whose turn ended with a question says what it asks', () => {
  const asking = modelOf(prompt(0, 'go'), reply(1, 'Built it.\n\nShould I deploy?'), turnEnd(2));
  assert.equal(buildAgent({ base: base(), model: asking, repoOf, now: at(3), cfg, home: '/h' }).question, 'Should I deploy?');
  const telling = modelOf(prompt(0, 'go'), reply(1, 'Built and deployed.'), turnEnd(2));
  assert.equal(buildAgent({ base: base(), model: telling, repoOf, now: at(3), cfg, home: '/h' }).question, undefined);
  const busy = modelOf(prompt(0, 'go'), reply(1, 'Should I? Let me check.'), toolUse(2, 't', 'Bash'));
  assert.equal(buildAgent({ base: base(), model: busy, repoOf, now: at(3), cfg, home: '/h' }).question, undefined);
});

test('the snapshot carries a 600-character preview of a long message, marked as having more', () => {
  const long = `Intro\n\n${'y'.repeat(900)}`;
  const m = modelOf(prompt(0, 'short ask'), reply(1, long));
  const a = buildAgent({ base: base(), model: m, registry: { status: 'idle' }, repoOf, now: at(2), cfg, home: '/h' });
  const [r, p] = a.feed;
  assert.equal(r.more, true);
  assert.equal(r.body, `${long.slice(0, 600)}…`);
  assert.equal(p.body, 'short ask');
  assert.equal(p.more, undefined);
  assert.equal(m.feed[0].body, long, 'the model keeps the whole message for /feed');
});

test("a session's mode: the flag its process started with, unless the transcript recorded one since it started", () => {
  const started = at(10);
  const logged = (mode, when) => ({ permissionMode: mode, permissionModeAt: when });
  assert.equal(modeOf(logged('bypassPermissions', at(5)), 'claude --resume x --permission-mode auto', started), 'auto', 'resumed in auto: the old entry predates it');
  assert.equal(modeOf(logged('plan', at(20)), 'claude --resume x --permission-mode auto', started), 'plan', 'Shift+Tab after it started, recorded since');
  assert.equal(modeOf(logged('default', at(5)), 'claude --dangerously-skip-permissions --resume x', started), 'bypassPermissions');
  assert.equal(modeOf(logged('acceptEdits', at(5)), 'claude', started), 'acceptEdits', 'no flag: what the transcript says');
  assert.equal(modeOf(null, 'claude --permission-mode=plan', started), 'plan');
  assert.equal(modeOf(null, 'claude', started), undefined);
  assert.equal(modeOf(logged('auto', at(5)), undefined, undefined), 'auto');
});

test("an agent's task list in short: done of total, what it is on now, the items", () => {
  const m = modelOf(prompt(0, 'go'), toolUse(1, 'w1', 'TodoWrite', { todos: [{ content: 'Plan', status: 'completed', activeForm: 'Planning' }, { content: 'Build', status: 'in_progress', activeForm: 'Building it' }, { content: 'Ship', status: 'pending' }] }));
  assert.deepEqual(tasksOf(m), { done: 1, total: 3, current: 'Building it', items: [{ text: 'Plan', status: 'completed' }, { text: 'Build', status: 'in_progress' }, { text: 'Ship', status: 'pending' }] });
  assert.equal(tasksOf(modelOf(prompt(0, 'go'))), undefined);
});

test('a connector or web call says where it goes, for the farm\'s road to town', () => {
  assert.equal(nowOf(modelOf(prompt(0, 'go'), toolUse(1, 'm1', 'mcp__claude_ai_Gmail__search_threads', { query: 'x' }))).service, 'Gmail');
  assert.equal(nowOf(modelOf(prompt(0, 'go'), toolUse(1, 'm1', 'Read', { file_path: '/w/a' }))).service, undefined);
});

test('the snapshot carries the task list, compactions, fast mode and a wake-up still to come', () => {
  const compact = JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: new Date(at(2)).toISOString(), compactMetadata: { trigger: 'manual' } });
  const m = modelOf(prompt(0, 'go'), compact, toolUse(3, 'w1', 'ScheduleWakeup', { delaySeconds: 600 }), toolResult(4, 'w1'), turnEnd(5));
  const a = buildAgent({ base: base(), model: m, now: at(10), cfg, repoOf, home: '/h' });
  assert.equal(a.compactions, 1);
  assert.equal(a.lastCompactAt, at(2));
  assert.equal(a.wakeAt, at(3) + 600_000);
  assert.equal(a.fast, undefined);
  assert.equal(buildAgent({ base: base(), model: m, now: at(700), cfg, repoOf, home: '/h' }).wakeAt, undefined, 'its time passed');
});

test("a session's effort: what /effort last set since it started, else its --effort flag", () => {
  const set = JSON.stringify({ type: 'system', subtype: 'local_command', timestamp: new Date(at(5)).toISOString(), content: '<local-command-stdout>Set effort level to max (this session only): Maximum</local-command-stdout>' });
  const m = modelOf(prompt(0, 'go'), set);
  assert.equal(m.effort, 'max');
  assert.equal(effortOf(m, 'claude --effort low', at(1)), 'max', 'set after the process started');
  assert.equal(effortOf(m, 'claude --effort low', at(9)), 'low', 'the flag of a process started after it');
  assert.equal(effortOf(modelOf(prompt(0, 'go')), 'claude --resume x --effort high'), 'high');
  assert.equal(effortOf(modelOf(prompt(0, 'go')), 'claude'), undefined, "the model's default");
});

test("a session's model as /model last named it goes out beside the model of its last reply", () => {
  const set = JSON.stringify({ type: 'system', subtype: 'local_command', timestamp: new Date(at(5)).toISOString(), content: '<local-command-stdout>Set model to `Opus 5.5 (1M context)` and saved as your default for new sessions</local-command-stdout>' });
  const a = buildAgent({ base: base(), model: modelOf(prompt(0, 'go'), reply(1, 'ok'), set), now: at(10), cfg, repoOf, home: '/h' });
  assert.equal(a.model, 'claude-opus-5-5');
  assert.equal(a.modelLabel, 'Opus 5.5 (1M context)');
  assert.equal(buildAgent({ base: base(), model: modelOf(prompt(0, 'go'), reply(1, 'ok')), now: at(10), cfg, repoOf, home: '/h' }).modelLabel, undefined);
});

test("a working session's turn: since when and its tokens from the transcript, the working line's word and mode from its mod", () => {
  const m = modelOf(prompt(10, 'go'), reply(12, 'x'));
  assert.deepEqual(turnOf(m, undefined), { startedAt: at(10) });
  assert.deepEqual(turnOf(m, { turn: { startedAt: at(11), word: 'Slithering', mode: 'thinking' } }), { startedAt: at(11), word: 'Slithering', mode: 'thinking' });
  const working = buildAgent({ base: base(), model: modelOf(prompt(10, 'go'), toolUse(11, 't1', 'Bash', { command: 'sleep 9' })), now: at(12), cfg, repoOf, home: '/h', beacon: { version: '0.5.0', live: true, effort: 'xhigh' } });
  assert.equal(working.effort, 'xhigh', 'the effort its requests go out with, from its mod');
  assert.equal(working.turn.startedAt, at(10));
});

test('a Codex thread’s subagents are its children: running while a turn of theirs is open, done or failed between turns, gone an hour after', () => {
  const now = 10_000_000_000, MIN = 60_000;
  const thread = over => ({ turnOpen: undefined, lastActivityAt: now - MIN, turnStartAt: 0, lastTurnEndAt: 0, aborted: false, lastReply: null, ...over });
  const sub = (id, over, extra = {}) => ({ id, at: now - 50 * MIN, nickname: 'Socrates', role: 'ship-reviewer', task: `${id}_task`, ...extra, thread: thread(over) });
  const kids = codexChildrenOf([
    sub('busy', { turnOpen: true, turnStartAt: now - 5 * MIN, lastActivityAt: now - 1000, lastReply: 'An earlier answer.', lastTurnEndAt: now - 20 * MIN }),
    sub('fresh', { lastActivityAt: now - 1000 }, { role: undefined, nickname: undefined }),
    sub('done', { turnOpen: false, turnStartAt: now - 12 * MIN, lastTurnEndAt: now - 10 * MIN, lastReply: 'No findings.' }),
    sub('cut', { turnOpen: false, turnStartAt: now - 9 * MIN, lastTurnEndAt: now - 8 * MIN, aborted: true }),
    sub('old', { turnOpen: false, lastTurnEndAt: now - 61 * MIN, lastActivityAt: now - 61 * MIN }),
    sub('hung', { turnOpen: true, turnStartAt: now - 200 * MIN, lastActivityAt: now - 90 * MIN }),
  ], now, cfg);
  assert.deepEqual(kids.map(c => [c.id, c.kind, c.agentType, c.label, c.state, c.startedAt, c.endedAt, c.result]), [
    ['busy', 'subagent', 'ship-reviewer', 'busy_task · Socrates', 'running', now - 5 * MIN, undefined, undefined],
    ['cut', 'subagent', 'ship-reviewer', 'cut_task · Socrates', 'failed', now - 9 * MIN, now - 8 * MIN, undefined],
    ['done', 'subagent', 'ship-reviewer', 'done_task · Socrates', 'done', now - 12 * MIN, now - 10 * MIN, 'No findings.'],
    ['fresh', 'subagent', 'subagent', 'fresh_task', 'running', now - 50 * MIN, undefined, undefined],
  ], 'newest first; one quiet for an hour and a half with its turn open is no longer shown as running');
  const agent = buildAgent({ base: { id: 'codex:t', kind: 'codex', name: 'Fix the cart', cwd: '/p', subagents: [sub('busy', { turnOpen: true, lastActivityAt: now - 1000 })] }, model: null, codex: thread({ turnOpen: true, lastActivityAt: now - 1000 }), now, cfg, home: '/h', repoOf: () => null });
  assert.deepEqual(agent.children.map(c => [c.id, c.state]), [['busy', 'running']]);
});

test('a subagent said to be running that gave no sign of life for six hours is not shown (its session was killed, or its notice never came); a background command is', () => {
  const now = 10_000_000_000, H = 3_600_000;
  const child = (id, startedAt) => [id, { id, kind: 'subagent', label: id, state: 'running', startedAt }];
  const model = Object.assign(new SessionModel(), { children: new Map([child('zombie', now - 7 * H), child('quietButAlive', now - 7 * H), child('long', now - 5 * H), ['server', { id: 'server', kind: 'bgjob', label: 'npm run dev', state: 'running', startedAt: now - 30 * H }]]) });
  const childModels = new Map([['quietButAlive', Object.assign(new SessionModel(), { lastActivityAt: now - 2 * H })]]);
  const agent = buildAgent({ base: { id: 's', kind: 'interactive', name: 's', cwd: '/p' }, model, childModels, now, cfg, home: '/h', repoOf: () => null });
  assert.deepEqual(agent.children.map(c => [c.id, c.state]).sort(), [['long', 'running'], ['quietButAlive', 'running'], ['server', 'running']]);
});

test('a session’s work is counted as it goes: its steps by kind, those that failed (and how many in a row just now), and how its last test run went', () => {
  const m = modelOf(prompt(0, 'go'),
    toolUse(1, 't1', 'Read', { file_path: '/a' }), toolResult(2, 't1'),
    toolUse(3, 't2', 'Edit', { file_path: '/a' }), toolResult(4, 't2'),
    toolUse(5, 't3', 'Edit', { file_path: '/b' }), toolResult(6, 't3', true),
    toolUse(7, 't4', 'Bash', { command: 'npm test' }), toolResult(8, 't4', true),
    toolUse(9, 't5', 'Write', { file_path: '/c' }));
  const a = buildAgent({ base: base(), model: m, repoOf, now: at(10), cfg, home: '/h' });
  assert.deepEqual(a.work, { steps: { read: 1, edit: 2, test: 1, write: 1 }, failed: 2, streak: 2, lastTest: { ok: false, at: at(8) } });
  assert.deepEqual(a.timeline.map(t => [t.step, t.ok]), [['read', undefined], ['edit', undefined], ['edit', false], ['test', false], ['write', undefined]], 'the last half hour says which failed');
  m.applyLine(toolResult(11, 't5'));
  m.applyLine(toolUse(12, 't6', 'Bash', { command: 'npm test' }));
  m.applyLine(toolResult(13, 't6'));
  assert.deepEqual([m.work.streak, m.work.failed, m.work.lastTest], [0, 2, { ok: true, at: at(13) }], 'one that goes through ends the run of failures');
  m.addEarlierWork({ edit: 10, commit: 2 });
  assert.deepEqual(m.work.steps, { read: 1, edit: 12, test: 2, write: 1, commit: 2 }, 'with what the part of the transcript read later holds');
  assert.equal(buildAgent({ base: base(), model: null, repoOf, now: at(10), cfg, home: '/h' }).work, undefined, 'no transcript, no record');
});
