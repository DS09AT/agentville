import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexThread, listCodexThreads, readThreadMeta } from '../sources/codex.mjs';

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

test('listCodexThreads lists the threads written to lately, with their folder and name, without subagents', () => {
  const dir = codexHome();
  const live = rollout(dir, 'a', [meta('t-live', '/p/shop')], 2000);
  rollout(dir, 'b', [meta('t-old', '/p/shop')], 500);
  rollout(dir, 'c', [meta('t-sub', '/p/shop', { thread_source: 'subagent' })], 2000);
  rollout(dir, 'd', [meta('t-sub2', '/p/shop', { source: { subagent: { thread_spawn: {} } } })], 2000);
  writeFileSync(join(dir, 'sessions', '2026', '01', '01', 'notes.jsonl'), 'x\n');
  writeFileSync(join(dir, 'session_index.jsonl'), `${JSON.stringify({ id: 't-live', thread_name: 'Old name' })}\n${JSON.stringify({ id: 't-live', thread_name: 'Fix the cart' })}\n{half`);
  assert.deepEqual(listCodexThreads(dir, 1000 * 1000), [{ id: 't-live', path: live, cwd: '/p/shop', name: 'Fix the cart', mtimeMs: 2000 * 1000 }]);
  assert.deepEqual(listCodexThreads(join(dir, 'missing'), 0), []);
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
