import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexThread, codexLimits, listCodexThreads, readThreadMeta } from '../sources/codex.mjs';

const iso = sec => new Date(Date.UTC(2026, 0, 1, 0, 0, sec)).toISOString();
const line = (sec, type, payload) => JSON.stringify({ timestamp: iso(sec), ordinal: sec, type, payload });
const meta = (id, cwd, extra = {}) => line(0, 'session_meta', { id, cwd, thread_source: 'user', ...extra });

function codexHome() {
  const dir = mkdtempSync(join(tmpdir(), 'codex-'));
  mkdirSync(join(dir, 'sessions', '2026', '01', '01'), { recursive: true });
  return dir;
}

function rollout(dir, name, lines, mtimeSec) {
  const path = join(dir, 'sessions', '2026', '01', '01', `rollout-${name}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  if (mtimeSec !== undefined) utimesSync(path, mtimeSec, mtimeSec);
  return path;
}

const subMeta = (id, parent, extra = {}) => meta(id, '/p/shop', { thread_source: 'subagent', parent_thread_id: parent, source: { subagent: { thread_spawn: { parent_thread_id: parent, depth: 1, agent_path: `/root/${id}_task`, agent_nickname: 'Socrates', agent_role: 'ship-reviewer' } } }, ...extra });

test('listCodexThreads lists the threads written to lately, with their folder and name; a subagent’s thread is among its thread’s subagents', () => {
  const dir = codexHome();
  const live = rollout(dir, 'a', [meta('t-live', '/p/shop')], 2000);
  rollout(dir, 'b', [meta('t-old', '/p/shop')], 500);
  const sub = rollout(dir, 'c', [subMeta('t-sub', 't-live')], 2000);
  const deep = rollout(dir, 'd', [subMeta('t-deep', 't-sub', { agent_nickname: 'Hypatia', agent_role: undefined })], 1500);
  rollout(dir, 'e', [subMeta('t-orphan', 't-old')], 2000);
  rollout(dir, 'f', [meta('t-bare', '/p/shop', { thread_source: 'subagent' })], 2000);
  writeFileSync(join(dir, 'sessions', '2026', '01', '01', 'notes.jsonl'), 'x\n');
  writeFileSync(join(dir, 'session_index.jsonl'), `${JSON.stringify({ id: 't-live', thread_name: 'Old name' })}\n${JSON.stringify({ id: 't-live', thread_name: 'Fix the cart' })}\n{half`);
  const at = Date.parse(iso(0));
  assert.deepEqual(listCodexThreads(dir, 1000 * 1000), [{ id: 't-live', path: live, cwd: '/p/shop', name: 'Fix the cart', mtimeMs: 2000 * 1000, subagents: [
    { id: 't-sub', path: sub, mtimeMs: 2000 * 1000, at, nickname: 'Socrates', role: 'ship-reviewer', task: 't-sub_task' },
    { id: 't-deep', path: deep, mtimeMs: 1500 * 1000, at, nickname: 'Hypatia', role: 'ship-reviewer', task: 't-deep_task' },
  ] }], 'a subagent’s subagent goes with the thread they started from; one whose thread is not listed, or that names none, is left out');
  assert.deepEqual(listCodexThreads(join(dir, 'missing'), 0), []);
});

test('a subagent’s rollout opens with its parent’s history: those turns are not its own', () => {
  const spawn = Date.parse(iso(100)), sec = ms => Math.round(ms / 1000);
  const t = new CodexThread(0, { from: spawn - 2000 });
  t.applyLines([ // all written at the spawn, the parent's turns saying when they really were
    line(100, 'event_msg', { type: 'task_started', started_at: sec(spawn) - 900 }),
    line(100, 'event_msg', { type: 'task_complete', completed_at: sec(spawn) - 800, last_agent_message: 'The parent’s old answer.' }),
    line(100, 'event_msg', { type: 'task_started', started_at: sec(spawn) - 60 }),
  ]);
  assert.deepEqual([t.turnOpen, t.lastReply, t.lastTurnEndAt], [undefined, null, 0], 'nothing of its own yet');
  t.applyLines([line(101, 'event_msg', { type: 'task_started', started_at: sec(spawn) + 1 })]);
  assert.deepEqual([t.turnOpen, t.turnStartAt], [true, (sec(spawn) + 1) * 1000]);
  t.applyLines([line(160, 'event_msg', { type: 'task_complete', completed_at: sec(spawn) + 60, last_agent_message: 'No findings.\nTwo nits.' })]);
  assert.deepEqual([t.turnOpen, t.lastReply, t.lastMessage, t.aborted, t.lastTurnEndAt], [false, 'No findings.', 'No findings.\nTwo nits.', false, Date.parse(iso(160))]);
  t.applyLines([line(170, 'event_msg', { type: 'task_started' }), line(175, 'event_msg', { type: 'turn_aborted' })]);
  assert.deepEqual([t.turnOpen, t.aborted, t.turnStartAt], [false, true, Date.parse(iso(170))], 'a turn cut short; one that names no time is as old as its line');
});

test('readThreadMeta is null for a rollout whose first line is not whole or not its meta', () => {
  const dir = codexHome();
  assert.equal(readThreadMeta(rollout(dir, 'a', [line(0, 'event_msg', { type: 'task_started' })])), null);
  const half = join(dir, 'sessions', '2026', '01', '01', 'rollout-half.jsonl');
  writeFileSync(half, '{"timestamp":"2026');
  assert.equal(readThreadMeta(half), null);
  assert.equal(readThreadMeta(join(dir, 'gone.jsonl')), null);
});

test('a codex thread follows its turns: open from task_started, ended by task_complete or turn_aborted', () => {
  const t = new CodexThread(Date.parse(iso(0)));
  t.applyLines([line(3, 'response_item', { type: 'message' })]);
  assert.deepEqual([t.turnOpen, t.lastActivityAt], [undefined, Date.parse(iso(3))]);
  t.applyLines([line(5, 'event_msg', { type: 'task_started', turn_id: 'x' }), line(6, 'response_item', { type: 'reasoning' })]);
  assert.equal(t.turnOpen, true);
  t.applyLines([line(9, 'event_msg', { type: 'task_complete', last_agent_message: '\nAll done.\nMore.' })]);
  assert.deepEqual([t.turnOpen, t.lastTurnEndAt, t.lastReply], [false, Date.parse(iso(9)), 'All done.']);
  t.applyLines([line(12, 'event_msg', { type: 'task_started' }), line(14, 'event_msg', { type: 'turn_aborted', reason: 'interrupted' })]);
  assert.deepEqual([t.turnOpen, t.lastTurnEndAt, t.lastReply], [false, Date.parse(iso(14)), 'All done.']);
});

test('a tool output that only quotes a turn event does not move the turn', () => {
  const t = new CodexThread();
  t.applyLines([line(5, 'event_msg', { type: 'task_started' }), line(6, 'response_item', { type: 'function_call_output', output: '{"type":"task_complete"}' }), 'not json "type":"task_complete"']);
  assert.equal(t.turnOpen, true);
});

test('Codex\u2019s limits come with its answers: the week and the 5 hours under the plan\u2019s names, the freshest kept, with its plan and credits', () => {
  const week = { used_percent: 100, window_minutes: 10080, resets_at: 1792127802 };
  assert.deepEqual(codexLimits({ primary: week, secondary: null }), [{ kind: 'seven_day', percentUsed: 100, resetsAt: 1792127802000 }]);
  assert.deepEqual(codexLimits({ primary: { used_percent: 12.5, window_minutes: 300, resets_in_seconds: 60 }, secondary: { used_percent: 40, window_minutes: 4320 } }, 1000),
    [{ kind: 'five_hour', percentUsed: 12.5, resetsAt: 61000 }, { kind: '4320m', percentUsed: 40, resetsAt: null }]);
  assert.deepEqual(codexLimits(null), []);
  const t = new CodexThread();
  t.applyLines([line(4, 'event_msg', { type: 'token_count', info: {}, rate_limits: { primary: { ...week, used_percent: 61 }, secondary: null, plan_type: 'pro', credits: { balance: '53902.18' } } })]);
  assert.deepEqual(t.limits, { at: Date.parse(iso(4)), rateLimits: [{ kind: 'seven_day', percentUsed: 61, resetsAt: 1792127802000 }], planType: 'pro', credits: 53902.18 });
  t.applyLines([line(6, 'event_msg', { type: 'token_count', info: {}, rate_limits: { primary: week, secondary: null } }), line(7, 'event_msg', { type: 'token_count', info: {}, rate_limits: { primary: null, secondary: null } }),
    line(8, 'response_item', { type: 'function_call_output', output: '{"type":"token_count","rate_limits":{"primary":{"used_percent":1,"window_minutes":10080}}}' })]);
  assert.deepEqual([t.limits.at, t.limits.rateLimits[0].percentUsed, t.limits.planType, t.limits.credits], [Date.parse(iso(6)), 100, null, null], 'the latest reading that has a window; a quoted one is not a reading');
  assert.equal(t.turnOpen, undefined, 'and it says nothing of the turn');
});

test('a Codex thread’s tool calls are counted by kind of step, as a session’s are: a patch is an edit, a command is read as Claude Code’s are', () => {
  const t = new CodexThread(0);
  const call = (sec, name, input) => line(sec, 'response_item', { type: 'custom_tool_call', name, input, call_id: `c${sec}` });
  t.applyLines([
    line(1, 'event_msg', { type: 'task_started' }),
    call(2, 'exec', 'text(await tools.exec_command({cmd:"rg -n \\"cart\\" src"}))'),
    call(3, 'apply_patch', '*** Begin Patch'),
    call(4, 'exec', 'text(await tools.exec_command({cmd:"pytest tests/unit -q"}))'),
    call(5, 'exec', 'text(await tools.exec_command({cmd:"git commit -m \\"fix\\""}))'),
    line(6, 'response_item', { type: 'function_call', name: 'spawn_agent', arguments: '{"task_name":"review"}' }),
    line(7, 'response_item', { type: 'custom_tool_call_output', call_id: 'c5', output: 'ok' }),
    line(8, 'response_item', { type: 'function_call', name: 'something_new', arguments: '{}' }),
  ]);
  assert.deepEqual(t.work.steps, { search: 1, edit: 1, test: 1, commit: 1, agent: 1, other: 1 }, 'a call’s output is not a call');
  assert.deepEqual(t.lastStep, { step: 'other', tool: 'something_new', at: Date.parse(iso(8)) });
  assert.equal(t.turnOpen, true);
});
