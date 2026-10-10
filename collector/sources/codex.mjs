import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { firstLine } from '../transcript/summarize.mjs';

const META_BYTES = 256 * 1024;

/** A rollout's first line: the thread's id and folder, and whether it is a subagent's. Null while it can't be read. */
export function readThreadMeta(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(META_BYTES);
    const head = buf.subarray(0, readSync(fd, buf, 0, META_BYTES, 0));
    const nl = head.indexOf(0x0a);
    if (nl === -1) return null;
    const { type, payload } = JSON.parse(head.subarray(0, nl).toString('utf8'));
    if (type !== 'session_meta' || typeof payload?.id !== 'string') return null;
    return { id: payload.id, cwd: typeof payload.cwd === 'string' ? payload.cwd : '', subagent: payload.thread_source === 'subagent' || Boolean(payload.source?.subagent) };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The names Codex gave its threads (session_index.jsonl): id → name, the latest line winning. */
export function readThreadNames(codexDir) {
  const names = new Map();
  let text;
  try { text = readFileSync(join(codexDir, 'session_index.jsonl'), 'utf8'); } catch { return names; }
  for (const line of text.split('\n')) {
    try {
      const { id, thread_name: name } = JSON.parse(line);
      if (typeof id === 'string' && typeof name === 'string' && name.trim()) names.set(id, name.trim());
    } catch { /* a half-written line */ }
  }
  return names;
}

/**
 * Codex threads written to since `since`: [{ id, path, cwd, name, mtimeMs }]. A subagent's thread is
 * left out: its parent's turn stays open while it runs. `metaCache` keeps each rollout's first line.
 */
export function listCodexThreads(codexDir, since, metaCache = new Map()) {
  const root = join(codexDir, 'sessions');
  let files;
  try { files = readdirSync(root, { recursive: true }); } catch { return []; }
  const names = readThreadNames(codexDir);
  const threads = [];
  for (const rel of files) {
    if (!/(^|\/)rollout-[^/]*\.jsonl$/.test(rel)) continue;
    const path = join(root, rel);
    let mtimeMs;
    try { mtimeMs = statSync(path).mtimeMs; } catch { continue; }
    if (mtimeMs < since) continue;
    const meta = metaCache.get(path) ?? readThreadMeta(path);
    if (!meta) continue;
    metaCache.set(path, meta);
    if (!meta.subagent) threads.push({ id: meta.id, path, cwd: meta.cwd, name: names.get(meta.id), mtimeMs });
  }
  return threads;
}

/** What a thread's rollout says about its turn, kept up to date line by line. */
export class CodexThread {
  constructor(lastActivityAt = 0) {
    this.turnOpen = undefined; // unknown until a turn starts or ends in the part that was read
    this.lastActivityAt = lastActivityAt;
    this.lastTurnEndAt = 0;
    this.lastReply = null;
  }

  applyLines(lines) {
    for (const line of lines) {
      const at = Date.parse(line.match(/^\{"timestamp":"([^"]+)"/)?.[1] ?? '');
      if (at > this.lastActivityAt) this.lastActivityAt = at;
      if (!/"type":"(task_started|task_complete|turn_aborted)"/.test(line)) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type !== 'event_msg') continue;
      if (ev.payload?.type === 'task_started') {
        this.turnOpen = true;
      } else if (ev.payload?.type === 'task_complete' || ev.payload?.type === 'turn_aborted') {
        this.turnOpen = false;
        this.lastTurnEndAt = at || this.lastActivityAt;
        if (typeof ev.payload.last_agent_message === 'string') this.lastReply = firstLine(ev.payload.last_agent_message);
      }
    }
  }
}
