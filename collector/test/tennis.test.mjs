import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync,readFileSync,writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTennis, lineup, newScore, pointText, winPoint } from '../derive/tennis.mjs';
import { completedGit, gitActions } from '../derive/git-events.mjs';
import { CodexThread } from '../sources/codex.mjs';
import { RepoResolver } from '../sources/git.mjs';

const game = (s, team) => { for (let i = 0; i < 4; i++) winPoint(s, team); };
test('advantage games: deuce, lost advantage and two-point margin', () => {
  const s = newScore();
  for (let i = 0; i < 3; i++) { winPoint(s, 0); winPoint(s, 1); }
  assert.deepEqual(pointText(s), ['40', '40']);
  winPoint(s, 0); assert.deepEqual(pointText(s), ['AD', '40']);
  winPoint(s, 1); assert.deepEqual(pointText(s), ['40', '40']);
  winPoint(s, 1); winPoint(s, 1);
  assert.deepEqual(s.games, [0, 1]); assert.deepEqual(s.points, [0, 0]);
  assert.equal(s.server, 1); assert.equal(s.ends, 1);
});
test('6:6 tie-break, service rotation, 7:6 is not enough, and best of three', () => {
  const s = newScore(['a', 'b', 'c', 'd']);
  for (let i = 0; i < 6; i++) { game(s, 0); game(s, 1); }
  assert.equal(s.tie, true); assert.equal(s.server, 0);
  winPoint(s, 0); assert.equal(s.server, 1);
  winPoint(s, 1); assert.equal(s.server, 1);
  winPoint(s, 0); assert.equal(s.server, 2);
  winPoint(s, 1);
  for (let i = 0; i < 4; i++) { winPoint(s, 0); winPoint(s, 1); }
  winPoint(s, 0); assert.equal(s.tie, true);
  winPoint(s, 0); assert.deepEqual(s.results, [[7, 6]]); assert.equal(s.server, 1);
  for (let i = 0; i < 6; i++) game(s, 0);
  assert.equal(s.winner, 0); assert.deepEqual(s.sets, [2, 0]);
  winPoint(s, 1); assert.deepEqual(s.points, [0, 0]);
});
test('one player trains, two play singles, three never play 2v1, four play doubles; extra children have roles', () => {
  const p = { id: 'p' }, kids = n => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: 'subagent', state: 'running', startedAt: i }));
  assert.equal(lineup(p, []).mode, 'training');
  assert.deepEqual(lineup(p, kids(1)).teams, [['p'], ['c0']]);
  assert.deepEqual(lineup(p, kids(2)).helpers, [{ id: 'c1', role: 'ball-person' }]);
  assert.deepEqual(lineup(p, kids(3)).teams, [['p', 'c1'], ['c0', 'c2']]);
  assert.deepEqual(lineup(p, kids(5)).helpers, [{ id: 'c3', role: 'umpire' }, { id: 'c4', role: 'ball-person' }]);
  assert.equal(lineup(p, [{ id: 'shell', kind: 'bgjob', state: 'running' }]).mode, 'training');
});
test('confirmed Git output only: no add/stash/tag, command starts, no-op pushes, or echoed snippets', () => {
  assert.deepEqual(gitActions({ command: 'git add . && git stash && git tag v1' }), []);
  assert.deepEqual(gitActions({ command: 'echo "git commit -m x"' }), []);
  const a = gitActions({ command: 'git -C /repo commit -m x' });
  assert.equal(a[0].cwd, '/repo');
  assert.equal(completedGit(a, '[main abc1234] x', true, 'x', 10).length, 1);
  assert.equal(completedGit(a, 'Script running with cell ID 4', true, 'x', 10).length, 0);
  assert.equal(completedGit(gitActions({ command: 'git push' }), 'Everything up-to-date', true, 'x', 10).length, 0);
  assert.equal(completedGit(a, 'permission denied', false, 'x', 10)[0].ok, false);
  assert.equal(completedGit(gitActions({ command: 'gh pr create' }), 'https://github.com/acme/app/pull/7', true, 'p', 10).length, 1);
});
test('Codex outputs confirm tool calls, including a process polled after exec_command', () => {
  const t = new CodexThread(), line = p => JSON.stringify({ timestamp: '2026-10-13T12:00:00Z', type: 'response_item', payload: p });
  t.applyLines([line({ type: 'function_call', name: 'exec_command', call_id: 'call', arguments: JSON.stringify({ cmd: 'git commit -m x' }) }), line({ type: 'function_call_output', call_id: 'call', output: JSON.stringify({ session_id: 42, output: '' }) })]);
  assert.equal(t.gitEvents.length, 0);
  t.applyLines([line({ type: 'function_call', name: 'write_stdin', call_id: 'poll', arguments: JSON.stringify({ session_id: 42 }) }), line({ type: 'function_call_output', call_id: 'poll', output: JSON.stringify({ exit_code: 0, output: '[main abc1234] x' }) })]);
  assert.equal(t.gitEvents.length, 1); assert.equal(t.gitEvents[0].id, 'call:0');
});
test('persisted scores: no points from old history, no duplicates after reload/restart, correct actor and mode transitions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-tennis-'));
  try {
    const file = join(dir, 'scores.json'), repos = [{ path: '/repo' }], lookup = () => '/repo';
    const a = { id: 'p', name: 'Parent', cwd: '/repo', state: 'working', children: [], gitEvents: [{ id: 'old', at: 1, kind: 'commit', ok: true }] };
    let ledger = createTennis({ file, now: 100 });
    assert.deepEqual(ledger.update([a], repos, 100, lookup)['/repo'].points, ['0', '0']);
    a.gitEvents.push({ id: 'first', at: 110, kind: 'commit', ok: true });
    assert.deepEqual(ledger.update([a], repos, 110, lookup)['/repo'].points, ['15', '0']);
    ledger = createTennis({ file, now: 200 });
    assert.deepEqual(ledger.update([a], repos, 200, lookup)['/repo'].points, ['15', '0']);
    a.children = [{ id: 's', label: 'Opponent', kind: 'subagent', state: 'running', gitEvents: [] }];
    assert.equal(ledger.update([a], repos, 300, lookup)['/repo'].mode, 'training');
    assert.equal(ledger.update([a], repos, 2600, lookup)['/repo'].mode, 'singles');
    a.children[0].gitEvents.push({ id: 'sub-commit', at: 2700, kind: 'commit', ok: true });
    assert.deepEqual(ledger.update([a], repos, 2700, lookup)['/repo'].points, ['15', '15']);
    a.gitEvents.push({ id: 'failure', at: 2800, kind: 'push', ok: false });
    assert.deepEqual(ledger.update([a], repos, 2800, lookup)['/repo'].points, ['15', '30']);
    a.state = 'yourTurn';
    assert.equal(ledger.update([a], repos, 2900, lookup)['/repo'].active, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tennis uses the cached repo path even when the working folder has a different spelling', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agentville-tennis-'));
  try {
    const resolver = new RepoResolver({ runner: async () => ({ code: 0, stdout: '/canonical/repo\n' }) });
    await resolver.topOf(dir);
    const agent = { id: 'a', name: 'A', cwd: dir, state: 'working', children: [], gitEvents: [{ id: 'commit', at: 110, kind: 'commit', ok: true, cwd: dir }] };
    const matches = createTennis({ now: 100 }).update([agent], [{ path: '/canonical/repo' }], 110, p => resolver.lookup(p));
    assert.deepEqual(matches['/canonical/repo']?.points, ['15', '0']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a known PR merged later earns one point, even if the same merge is subsequently reported by the CLI', () => {
  const ledger = createTennis({ now: 100 }), r = { path: '/r', prs: { merged: [] } };
  const a = { id: 'a', name: 'A', cwd: '/r', state: 'working', children: [], gitEvents: [{ id: 'create', at: 110, kind: 'pr-create', ok: true, pr: 7 }] };
  assert.deepEqual(ledger.update([a], [r], 120)['/r'].points, ['15', '0']);
  r.prs.merged = [{ number: 7, at: 130 }];
  assert.deepEqual(ledger.update([a], [r], 140)['/r'].points, ['30', '0']);
  a.gitEvents.push({ id: 'merge-cli', at: 150, kind: 'pr-merge', ok: true, pr: 7 });
  assert.deepEqual(ledger.update([a], [r], 160)['/r'].points, ['30', '0']);
  r.prs.merged.push({ number: 8, at: 170 });
  assert.deepEqual(ledger.update([a], [r], 180)['/r'].points, ['30', '0'], 'an unknown PR has no invented owner');
});

test('a finishing subagent earns its last point before its departure changes the match', () => {
  const ledger = createTennis({ now: 100 }), r = { path: '/r' };
  const child = { id: 'c', kind: 'subagent', state: 'running', gitEvents: [] };
  const a = { id: 'a', cwd: '/r', state: 'working', name: 'A', children: [child] };
  ledger.update([a], [r], 100);
  child.state = 'done'; child.gitEvents.push({ id: 'final', at: 5000, kind: 'commit', ok: true });
  const m = ledger.update([a], [r], 5010)['/r'];
  assert.equal(m.mode, 'singles'); assert.deepEqual(m.points, ['0', '15']);
  const next = ledger.update([a], [r], 8000)['/r'];
  assert.equal(next.mode, 'training'); assert.deepEqual(next.history[0].score.points, [0, 1]);
});
test('a delayed known merge is not lost behind newer tool events', () => {
  const ledger = createTennis({ now: 100 }), r = { path: '/r', prs: { merged: [] } };
  const a = { id: 'a', name: 'A', cwd: '/r', state: 'working', children: [], gitEvents: [{ id: 'create', at: 110, kind: 'pr-create', pr: 7, ok: true }] };
  ledger.update([a], [r], 120);
  a.gitEvents.push({ id: 'commit', at: 150, kind: 'commit', ok: true });
  ledger.update([a], [r], 160);
  r.prs.merged.push({ number: 7, at: 140 });
  assert.deepEqual(ledger.update([a], [r], 180)['/r'].points, ['40', '0']);
  assert.deepEqual(ledger.update([a], [r], 190)['/r'].points, ['40', '0']);
});

test('quoted shell examples cannot award points and earlier successful chained operations still count', () => {
  assert.deepEqual(gitActions({ command: 'echo "; git commit -m fake" && echo "[main abc1234] fake"' }), []);
  assert.deepEqual(gitActions({ command: 'printf "\ngit push\n"; # git commit -m ignored' }), []);
  const actions = gitActions({ command: 'git commit -m "release; git push" && git push' });
  assert.equal(actions.length, 2);
  const done = completedGit(actions, '[main abc1234] release\nerror: failed to push\nExit code: 1', false, 'chain', 100);
  assert.equal(done.length, 1); assert.equal(done[0].kind, 'commit'); assert.equal(done[0].ok, true);
});

test('Claude tool results carry confirmed Git identity and the actual working folder', async () => {
  const { SessionModel } = await import('../transcript/session-model.mjs');
  const m = new SessionModel(), stamp = '2026-10-13T12:00:00Z';
  const use = JSON.stringify({ type: 'assistant', timestamp: stamp, cwd: '/r', message: { content: [{ type: 'tool_use', id: 'g', name: 'Bash', input: { command: 'git commit -m done' } }] } });
  m.applyLines([use]); assert.equal(m.gitEvents.length, 0);
  m.applyLines([JSON.stringify({ type: 'user', timestamp: stamp, message: { content: [{ type: 'tool_result', tool_use_id: 'g', content: '[main abc1234] done' }] } })]);
  assert.equal(m.gitEvents.length, 1); assert.equal(m.gitEvents[0].cwd, '/r'); assert.equal(m.gitEvents[0].id, 'g:0');
});

test('an operation ID stays unique even when a repeated result has a later timestamp', () => {
  const ledger = createTennis({ now: 100 }), r = { path: '/r' }, a = { id: 'a', name: 'A', cwd: '/r', state: 'working', children: [], gitEvents: [{ id: 'same-call', at: 110, kind: 'commit', ok: true }] };
  ledger.update([a], [r], 120);
  a.gitEvents.push({ id: 'same-call', at: 130, kind: 'commit', ok: true });
  assert.deepEqual(ledger.update([a], [r], 140)['/r'].points, ['15', '0']);
});

test('doubles partners and scores stay fixed across repeated snapshots', () => {
  const kids = [0, 1, 2].map(i => ({ id: `c${i}`, kind: 'subagent', state: 'running', startedAt: i })), parent = { id: 'a', cwd: '/r', name: 'A', state: 'working', children: kids };
  const first = lineup(parent, kids);
  assert.deepEqual(lineup(parent, kids, first).teams, first.teams);
  const ledger = createTennis({ now: 100 }), repos = [{ path: '/r' }];
  const start = ledger.update([parent], repos, 100)['/r'];
  const again = ledger.update([parent], repos, 5000)['/r'];
  assert.deepEqual(again.teams, start.teams); assert.deepEqual(again.history, []);
});
test('the final tie-break point changes ends once even when it is the twelfth point', () => {
  const s = newScore(); s.games = [6, 6]; s.tie = true;
  for (let i = 0; i < 5; i++) { winPoint(s, 0); winPoint(s, 1); }
  assert.equal(s.ends, 1);
  winPoint(s, 0); winPoint(s, 0);
  assert.equal(s.ends, 0); assert.deepEqual(s.results, [[7, 6]]);
});

test('Git scores survive helper joins and departures across solo, singles and doubles',()=>{
  const ledger=createTennis({now:100}),a={id:'a',name:'A',cwd:'/r',state:'working',children:[],gitEvents:[{id:'c',at:110,kind:'commit',ok:true}]},r={path:'/r'};
  assert.deepEqual(ledger.update([a],[r],110)['/r'].points,['15','0']);
  for(const count of [1,3,2,0,3]){a.children=Array.from({length:count},(_,i)=>({id:'c'+i,kind:'subagent',state:'running',startedAt:i}));const m=ledger.update([a],[r],3000+count*3000);assert.deepEqual(m['/r'].points,['15','0']);assert.equal(m['/r'].last.id,'c');assert.ok(m['/r'].score.server<m['/r'].score.order.length);}
});
test('legacy zeroed formation changes recover an already confirmed parent point once, without inventing history',()=>{
  const dir=mkdtempSync(join(tmpdir(),'tennis-roster-'));try{
    const file=join(dir,'scores.json'),a={id:'a',name:'A',cwd:'/r',state:'working',children:[],gitEvents:[{id:'c',at:110,kind:'commit',ok:true}]},r={path:'/r'},ledger=createTennis({file,now:100});ledger.update([a],[r],110);
    const old=JSON.parse(readFileSync(file));delete old.rosterScores;old.courts['/r'].score=newScore(['a','@machine']);old.courts['/r'].last=null;old.courts['/r'].changeAt=200;writeFileSync(file,JSON.stringify(old));
    a.gitEvents.push({...a.gitEvents[0],at:111});const restored=createTennis({file,now:300});assert.deepEqual(restored.update([a],[r],300)['/r'].points,['15','0']);assert.deepEqual(restored.update([a],[r],400)['/r'].points,['15','0']);assert.equal(JSON.parse(readFileSync(file)).rosterScores,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
