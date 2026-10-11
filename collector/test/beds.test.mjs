import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBeds } from '../derive/beds.mjs';

const snap = (...paths) => ({ generatedAt: 1, agents: [], collisions: [], repos: paths.map(p => (typeof p === 'string' ? { path: p, name: p.split('/').pop() } : p)) });
const bedsOf = s => Object.fromEntries(s.repos.map(r => [r.name, r.bed]));
const DAY = 86_400_000;

test('every repo gets a bed and keeps it; a new one takes a free bed; a gap stays a gap; a repo back within a day has its old bed', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'tracker-beds-')), 'beds.json'), beds = createBeds({ file });
  assert.deepEqual(bedsOf(beds.place(snap('/c/a', '/c/b', '/c/c'), 0)), { a: 0, b: 1, c: 2 });
  assert.deepEqual(bedsOf(beds.place(snap('/c/a', '/c/c'), 1000)), { a: 0, c: 2 }, 'b left: nobody moves up');
  assert.deepEqual(bedsOf(beds.place(snap('/c/c', '/c/d', '/c/a'), 2000)), { c: 2, d: 3, a: 0 }, 'd comes: b’s bed is held for b, so d takes the next free one; the order they are listed in doesn’t matter');
  assert.deepEqual(bedsOf(beds.place(snap('/c/a', '/c/b', '/c/c', '/c/d'), 3000)), { a: 0, b: 1, c: 2, d: 3 }, 'b back within the day: its old bed');
  assert.deepEqual(bedsOf(beds.place(snap('/c/a', '/c/c', '/c/d'), 4000)), { a: 0, c: 2, d: 3 });
  assert.deepEqual(bedsOf(beds.place(snap('/c/a', '/c/c', '/c/d', '/c/e'), 4000 + DAY + 1)), { a: 0, c: 2, d: 3, e: 1 }, 'a day later b’s bed is free again');
  assert.ok(existsSync(file) && JSON.parse(readFileSync(file, 'utf8'))['/c/e'].i === 1, 'kept on disk');
  const again = createBeds({ file });
  assert.deepEqual(bedsOf(again.place(snap('/c/e', '/c/f'), 5000 + DAY)), { e: 1, f: 4 }, 'after a restart everything is where it was: a, c and d are held, f takes the next');
});

test('the collector places fields as the grid does: a worktree right after its repo; over eighteen, no bed', () => {
  const beds = createBeds({ file: join(mkdtempSync(join(tmpdir(), 'tracker-beds-')), 'beds.json') });
  beds.place(snap('/c/a', '/c/b'), 0);
  const wt = { path: '/c/a-wt', name: 'a-wt', worktree: true, main: '/c/a' };
  assert.deepEqual(bedsOf(beds.place(snap('/c/a', '/c/b', '/c/z', wt), 10)), { a: 0, b: 1, z: 3, 'a-wt': 2 }, 'a’s worktree is placed with a, in the free bed nearest it; then the next repo');
  const many = Array.from({ length: 20 }, (_, i) => `/m/r${String(i).padStart(2, '0')}`);
  const full = createBeds({ file: null }).place(snap(...many), 0);
  assert.deepEqual([new Set(full.repos.slice(0, 18).map(r => r.bed)).size, full.repos.slice(18).every(r => r.bed >= 18)], [18, true], 'eighteen beds; the rest wait for one ("+2 more")');
});

test('a snapshot the scene can’t read leaves the beds alone and the collector running', () => {
  const logs = [], beds = createBeds({ file: null, log: m => logs.push(m) });
  const bad = { repos: [{ path: '/c/a', name: 'a' }], agents: null, collisions: { find: null } };
  assert.equal(beds.place(bad, 0), bad);
  assert.equal(logs.length, 1);
});
