import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix, win32 } from 'node:path';
import { samePath, within } from '../lib/within.mjs';

test('within: where a path is below a folder, written with "/"; null when it is not', () => {
  assert.equal(within('/w/app', '/w/app/src/a.ts', posix), 'src/a.ts');
  assert.equal(within('/w/app/', '/w/app/a.ts', posix), 'a.ts', 'a slash at the end of the folder');
  for (const outside of ['/w/app', '/w/application/a.ts', '/w/app/../x', '/x', 'src/a.ts']) assert.equal(within('/w/app', outside, posix), null, outside);
  assert.equal(within('', '/a', posix), null);
  assert.equal(within(null, '/a', posix), null);
});

test('within on Windows: either slash, the drive letter and the names in any case', () => {
  assert.equal(within('C:\\Users\\me\\app', 'C:\\Users\\me\\app\\src\\a.ts', win32), 'src/a.ts');
  assert.equal(within('C:\\Users\\me\\app', 'C:/Users/me/app/src/a.ts', win32), 'src/a.ts', 'git writes C:/…');
  assert.equal(within('C:\\Users\\me\\app', 'c:\\users\\ME\\App\\a.ts', win32), 'a.ts');
  assert.equal(within('C:\\Users\\me\\app', 'C:\\Users\\me\\application\\a.ts', win32), null);
  assert.equal(within('C:\\Users\\me\\app', 'D:\\Users\\me\\app\\a.ts', win32), null, 'another drive');
  assert.equal(within('C:\\Users\\me\\app', '\\\\host\\share\\Users\\me\\app\\a.ts', win32), null, 'another machine');
});

test('samePath: the same place however it is spelled here', () => {
  assert.equal(samePath('/h/me', '/h/me/', posix), true);
  assert.equal(samePath('/h/me', '/h/Me', posix), false, 'case counts where the system says so');
  assert.equal(samePath('/h/me', '/h/me/code', posix), false);
  assert.equal(samePath('C:\\Users\\me', 'c:/users/ME', win32), true);
  assert.equal(samePath('C:\\Users\\me', 'C:\\Users\\me2', win32), false);
  assert.equal(samePath('', '', posix), false);
  assert.equal(samePath(undefined, '/a', posix), false);
});
