import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameOver } from '../lib/replace.mjs';

const busy = code => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

test('a file Windows has open somewhere is replaced once it is let go: tried again, a little later each time', () => {
  const waits = [];
  let calls = 0;
  const rename = () => { if (++calls < 4) throw busy('EPERM'); };
  renameOver('a.tmp', 'a', { rename, platform: 'win32', sleep: ms => waits.push(ms) });
  assert.equal(calls, 4);
  assert.deepEqual(waits, [25, 50, 75]);
});

test('it gives up after its tries, and says what the system said', () => {
  let calls = 0;
  assert.throws(() => renameOver('a.tmp', 'a', { tries: 3, rename: () => { calls++; throw busy('EBUSY'); }, platform: 'win32', sleep: () => {} }), { code: 'EBUSY' });
  assert.equal(calls, 3);
});

test('another error, or any error elsewhere than Windows, is thrown at once', () => {
  let calls = 0;
  assert.throws(() => renameOver('a', 'b', { rename: () => { calls++; throw busy('ENOENT'); }, platform: 'win32', sleep: () => {} }), { code: 'ENOENT' });
  assert.throws(() => renameOver('a', 'b', { rename: () => { calls++; throw busy('EPERM'); }, platform: 'linux', sleep: () => {} }), { code: 'EPERM' });
  assert.equal(calls, 2);
});

test('it renames over an existing file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'replace-'));
  writeFileSync(join(dir, 'state.json'), 'old');
  writeFileSync(join(dir, 'state.json.tmp'), 'new');
  renameOver(join(dir, 'state.json.tmp'), join(dir, 'state.json'));
  assert.equal(readFileSync(join(dir, 'state.json'), 'utf8'), 'new');
});
