import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { earlierFileCalls, earlierHistory } from '../transcript/backfill.mjs';

const use = (sec, name, input, cwd = '/w') => JSON.stringify({ type: 'assistant', timestamp: new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString(), cwd, message: { model: 'm', content: [{ type: 'tool_use', id: `t${sec}`, name, input }] } });

test('file-tool calls before a byte offset are found; everything else is skipped cheaply', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const head = [
    JSON.stringify({ type: 'user', timestamp: '2026-10-07T10:00:00.000Z', message: { content: 'go' } }),
    use(1, 'Write', { file_path: '/w/docs/spec.md', content: '# Spec' }),
    use(2, 'Bash', { command: 'cat /w/a.md' }),
    '{ broken',
    use(3, 'Read', { file_path: 'notes.md' }),
    use(4, 'NotebookEdit', { notebook_path: '/w/n.ipynb' }),
  ].join('\n') + '\n';
  writeFileSync(f, head + use(9, 'Edit', { file_path: '/w/late.ts' }) + '\n');
  const calls = await earlierFileCalls(f, Buffer.byteLength(head));
  assert.deepEqual(calls.map(c => [c.name, c.input.file_path ?? c.input.notebook_path, c.cwd, new Date(c.at).getUTCSeconds()]), [
    ['Write', '/w/docs/spec.md', '/w', 1],
    ['Read', 'notes.md', '/w', 3],
    ['NotebookEdit', '/w/n.ipynb', '/w', 4],
  ]);
  assert.deepEqual(await earlierFileCalls('/no/such/file', 100), []);
});

test('the conversation before a byte offset is found too: your prompts (typed or sent from the dashboard) and the replies', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const t = sec => new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString();
  const head = [
    JSON.stringify({ type: 'user', timestamp: t(0), origin: { kind: 'human' }, message: { content: 'typed ask' } }),
    JSON.stringify({ type: 'assistant', timestamp: t(1), message: { model: 'm', content: [{ type: 'text', text: 'A reply' }] } }),
    JSON.stringify({ type: 'user', timestamp: t(2), message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'big output' }] } }),
    JSON.stringify({ type: 'user', timestamp: t(3), origin: { kind: 'task-notification' }, message: { content: '<task-notification>done' } }),
    JSON.stringify({ type: 'user', timestamp: t(4), origin: { kind: 'plugin', name: 'agent-tracker', asUser: true }, message: { content: 'sent from the dashboard' } }),
    use(5, 'Write', { file_path: '/w/a.md', content: '#' }),
  ].join('\n') + '\n';
  writeFileSync(f, head + JSON.stringify({ type: 'user', timestamp: t(9), message: { content: 'after the offset' } }) + '\n');
  const h = await earlierHistory(f, Buffer.byteLength(head));
  assert.deepEqual(h.said.map(s => [s.kind, s.text, new Date(s.at).getUTCSeconds()]), [
    ['prompt', 'typed ask', 0], ['reply', 'A reply', 1], ['prompt', 'sent from the dashboard', 4],
  ]);
  assert.deepEqual(h.files.map(c => c.input.file_path), ['/w/a.md']);
  assert.deepEqual(await earlierHistory('/no/such/file', 100), { files: [], said: [], tasks: { ops: [], compactions: 0, lastCompactAt: 0 }, background: [], children: [], steps: {} });
});

test('background commands before the offset are found too, with the file their output goes to: one still running is followed after a restart', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const result = (sec, id, text) => JSON.stringify({ type: 'user', timestamp: new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] } });
  const head = [
    use(1, 'Bash', { command: 'npm run dev', description: 'Dev server', run_in_background: true }),
    result(1, 't1', 'Command running in background with ID: b1. Output is being written to: /private/tmp/claude-501/-w/s/tasks/b1.output'),
    use(2, 'Bash', { command: 'npm test' }),
  ].join('\n') + '\n';
  writeFileSync(f, head);
  const h = await earlierHistory(f, Buffer.byteLength(head));
  assert.deepEqual(h.background.map(c => [c.id, c.name, c.input.command, c.input.description, c.background, c.outputPath]), [['t1', 'Bash', 'npm run dev', 'Dev server', true, '/private/tmp/claude-501/-w/s/tasks/b1.output']]);
});

test('messages between sessions before the offset are found too', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const t = sec => new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString();
  const head = [
    JSON.stringify({ type: 'user', timestamp: t(0), origin: { kind: 'peer', name: 'docs-2', msg_id: 'm1' }, message: { content: '<cross-session-message from-name="docs-2">\nAll clear.\n</cross-session-message>' } }),
    JSON.stringify({ type: 'assistant', timestamp: t(1), message: { model: 'm', content: [{ type: 'tool_use', id: 't1', name: 'SendMessage', input: { to: 'docs-2', summary: 'Thanks', message: 'Thanks, deploying now.' } }] } }),
  ].join('\n') + '\n';
  writeFileSync(f, head);
  const h = await earlierHistory(f, Buffer.byteLength(head));
  assert.deepEqual(h.said.map(s => [s.kind, s.dir, s.other, s.text]), [['peer', 'in', 'docs-2', 'All clear.'], ['peer', 'out', 'docs-2', 'Thanks, deploying now.']]);
});

test('the task list and compactions before a byte offset are found too', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const t = sec => new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString();
  const head = [
    use(1, 'TaskCreate', { subject: 'Early task', activeForm: 'Doing the early task' }),
    JSON.stringify({ type: 'user', timestamp: t(2), message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'Task #4 created successfully: Early task' }] }, toolUseResult: { task: { id: '4', subject: 'Early task' } } }),
    JSON.stringify({ type: 'system', subtype: 'compact_boundary', timestamp: t(3), compactMetadata: { trigger: 'auto' } }),
    use(4, 'TaskUpdate', { taskId: '4', status: 'in_progress' }),
  ].join('\n') + '\n';
  writeFileSync(f, head);
  const h = await earlierHistory(f, Buffer.byteLength(head));
  assert.deepEqual(h.tasks.ops.map(o => [o.op, o.id, o.subject ?? o.status]), [['create', '4', 'Early task'], ['update', '4', 'in_progress']]);
  assert.equal(h.tasks.compactions, 1);
});

test('subagents launched before a byte offset are found too, each as far as that part says: done, failed, or still running', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const t = sec => new Date(Date.UTC(2026, 9, 7, 10, 0, sec)).toISOString();
  const result = (sec, id, content, extra = {}) => JSON.stringify({ type: 'user', timestamp: t(sec), ...extra, message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  const launched = (sec, id) => result(sec, id, 'Async agent launched successfully.', { toolUseResult: { isAsync: true, status: 'async_launched' } });
  const notice = (sec, id, status) => JSON.stringify({ type: 'queue-operation', operation: 'enqueue', timestamp: t(sec), content: `<task-notification>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n<result>All clear.</result>\n</task-notification>` });
  const head = [
    use(1, 'Agent', { description: 'Find callers', subagent_type: 'Explore', prompt: 'Find them' }),
    result(9, 't1', 'Three callers.'),
    notice(10, 't11', 'completed'), // a quick one: its notice is written before the call that launched it
    use(11, 'Agent', { description: 'Quick look', run_in_background: true }),
    launched(11, 't11'),
    use(12, 'Agent', { description: 'Long review', run_in_background: true }),
    launched(12, 't12'),
    use(13, 'Bash', { command: 'npm test', run_in_background: true }),
  ].join('\n') + '\n';
  writeFileSync(f, head);
  const { children } = await earlierHistory(f, Buffer.byteLength(head));
  assert.deepEqual(children.map(c => [c.id, c.kind, c.agentType, c.label, c.state, c.isBackground]), [
    ['t1', 'subagent', 'Explore', 'Find callers', 'done', false],
    ['t11', 'subagent', undefined, 'Quick look', 'done', true],
    ['t12', 'subagent', undefined, 'Long review', 'running', true],
  ], 'not the background command: those are found for themselves');
  assert.equal(children[0].result, 'Three callers.');
  assert.equal(children[1].result, 'All clear.');
});

test('the steps before a byte offset are counted by kind, for the session’s record', async () => {
  const f = join(mkdtempSync(join(tmpdir(), 'tracker-backfill-')), 's.jsonl');
  const head = [use(1, 'Read', { file_path: '/w/a.md' }), use(2, 'Edit', { file_path: '/w/a.md' }), use(3, 'Edit', { file_path: '/w/b.md' }), use(4, 'Bash', { command: 'npm test' }), use(5, 'Bash', { command: 'git commit -m x' }), use(6, 'Grep', { pattern: 'x' })].join('\n') + '\n';
  writeFileSync(f, head);
  assert.deepEqual((await earlierHistory(f, Buffer.byteLength(head))).steps, { read: 1, edit: 2, test: 1, commit: 1, search: 1 });
});
