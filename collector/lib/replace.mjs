import { renameSync } from 'node:fs';

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES']);
const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Windows refuses a rename over a file another process has open, so a busy error is retried briefly.
export function renameOver(from, to, { tries = 12, waitMs = 25, rename = renameSync, sleep = nap, platform = process.platform } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      return rename(from, to);
    } catch (err) {
      if (platform !== 'win32' || !BUSY.has(err?.code) || attempt >= tries) throw err;
      sleep(waitMs * attempt);
    }
  }
}
