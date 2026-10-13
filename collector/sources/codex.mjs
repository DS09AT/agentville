import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { firstLine } from '../transcript/summarize.mjs';
import { stepOf } from '../derive/step.mjs';
import { completedGit, gitActions, shellInput } from '../derive/git-events.mjs';

const META_BYTES = 256 * 1024;

/**
 * A rollout's first line: the thread's id and folder, and whether it is a subagent's. Null while it can't be read.
 * A subagent's also says whose it is (`parent`), since when (`at`), and what Codex calls it: its `nickname`
 * ("Socrates"), its `role` (the agent type: "ship-reviewer") and its `task` (the last part of its agent path).
 */
export function readThreadMeta(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const buf = Buffer.alloc(META_BYTES);
    const head = buf.subarray(0, readSync(fd, buf, 0, META_BYTES, 0));
    const nl = head.indexOf(0x0a);
    if (nl === -1) return null;
    const { type, payload, timestamp } = JSON.parse(head.subarray(0, nl).toString('utf8'));
    if (type !== 'session_meta' || typeof payload?.id !== 'string') return null;
    const subagent = payload.thread_source === 'subagent' || Boolean(payload.source?.subagent);
    const meta = { id: payload.id, cwd: typeof payload.cwd === 'string' ? payload.cwd : '', subagent };
    if (!subagent) return meta;
    const spawn = payload.source?.subagent?.thread_spawn ?? {}, text = v => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined);
    return { ...meta, parent: text(payload.parent_thread_id ?? spawn.parent_thread_id), at: Date.parse(payload.timestamp ?? timestamp) || 0,
      nickname: text(payload.agent_nickname ?? spawn.agent_nickname), role: text(payload.agent_role ?? spawn.agent_role), task: text(String(payload.agent_path ?? spawn.agent_path ?? '').split('/').pop()) };
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
 * Codex threads written to since `since`: [{ id, path, cwd, name, mtimeMs, subagents }]. A subagent's thread is
 * no thread of its own here (its parent's turn stays open while it runs): it is among its thread's `subagents`
 * [{ id, path, mtimeMs, at, nickname, role, task }], a subagent's subagent with the thread they all started from.
 * `metaCache` keeps each rollout's first line.
 */
export function listCodexThreads(codexDir, since, metaCache = new Map()) {
  const root = join(codexDir, 'sessions');
  let files;
  try { files = readdirSync(root, { recursive: true }); } catch { return []; }
  const names = readThreadNames(codexDir);
  const threads = [], subs = [], parentOf = new Map();
  for (const rel of files) {
    if (!/(^|[\\/])rollout-[^\\/]*\.jsonl$/.test(rel)) continue;
    const path = join(root, rel);
    let mtimeMs;
    try { mtimeMs = statSync(path).mtimeMs; } catch { continue; }
    if (mtimeMs < since) continue;
    const meta = metaCache.get(path) ?? readThreadMeta(path);
    if (!meta) continue;
    metaCache.set(path, meta);
    if (!meta.subagent) threads.push({ id: meta.id, path, cwd: meta.cwd, name: names.get(meta.id), mtimeMs, subagents: [] });
    else { parentOf.set(meta.id, meta.parent); subs.push({ id: meta.id, path, mtimeMs, at: meta.at, nickname: meta.nickname, role: meta.role, task: meta.task }); }
  }
  const byId = new Map(threads.map(t => [t.id, t]));
  for (const s of subs) {
    let up = parentOf.get(s.id);
    for (let i = 0; i < 8 && up && !byId.has(up); i++) up = parentOf.get(up); // a subagent's subagent: up to the thread itself
    byId.get(up)?.subagents.push(s);
  }
  return threads;
}

const WINDOW_KIND = { 300: 'five_hour', 10080: 'seven_day' }; // by its length in minutes, under the names Claude Code's windows have
/**
 * Codex's plan windows, from the rate_limits a token_count event carries: [{ kind, percentUsed, resetsAt }]
 * (as the plan's usage has them: derive/plan.mjs). `at`: when the event was written, for a reset given in seconds from then.
 */
export function codexLimits(limits, at = 0) {
  return [limits?.primary, limits?.secondary].filter(w => Number.isFinite(w?.used_percent)).map(w => ({
    kind: WINDOW_KIND[w.window_minutes] ?? `${w.window_minutes}m`,
    percentUsed: w.used_percent,
    resetsAt: Number.isFinite(w.resets_at) ? w.resets_at * 1000 : Number.isFinite(w.resets_in_seconds) ? at + w.resets_in_seconds * 1000 : null,
  }));
}

const CODEX_STEPS = { apply_patch: 'edit', spawn_agent: 'agent', followup_task: 'agent', send_message: 'agent', wait_agent: 'agent', web_search: 'web', update_plan: 'plan', view_image: 'read', sleep: 'serve', wait: 'serve' };
/** The kind of step a Codex tool call is (derive/step.mjs has the kinds): a shell command is read as Claude Code's are (test, commit, push…). */
function codexStep(call) {
  if (CODEX_STEPS[call.name]) return CODEX_STEPS[call.name];
  const text = typeof call.input === 'string' ? call.input : typeof call.arguments === 'string' ? call.arguments : '';
  if (/\btools\.mcp__/.test(text)) return 'mcp'; // a connector, called from its script
  if (/\btools\.write_stdin\(/.test(text)) return 'serve'; // it looks in on a command it left running
  const cmd = /\bcmd"?\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1] ?? /"command"\s*:\s*\[?\s*"((?:[^"\\]|\\.)*)"/.exec(text)?.[1];
  if (cmd === undefined) return 'other';
  if (/apply_patch/.test(cmd)) return 'edit';
  return stepOf('Bash', { command: cmd.replace(/\\(["\\n])/g, (m, c) => (c === 'n' ? '\n' : c)) });
}

const MESSAGE_KEPT = 4000;
/**
 * What a thread's rollout says about its turn (and Codex's limits), kept up to date line by line.
 * `from`: turns from before then are not its own. A subagent's rollout opens with its parent's history, written
 * again when it was spawned: those turns say when they really were, and are left out.
 */
export class CodexThread {
  constructor(lastActivityAt = 0, { from = 0 } = {}) {
    this.from = from;
    this.turnOpen = undefined; // unknown until a turn starts or ends in the part that was read
    this.lastActivityAt = lastActivityAt;
    this.turnStartAt = 0;
    this.lastTurnEndAt = 0;
    this.aborted = false; // its last turn was cut short
    this.lastReply = null;
    this.lastMessage = null; // its last answer, whole (a subagent's result)
    // What it has done since the dashboard first read it, as a session's work is kept (SessionModel.work): its tool calls by kind of step.
    this.work = { steps: {}, failed: 0, streak: 0, lastTest: null };
    this.lastStep = null; // { step, tool, at }: its latest tool call
    this.gitEvents = [];
    this.gitPending = new Map();
    this.gitRunning = new Map();
    this.recent = []; // its latest tool calls, oldest first (120 at most): { at, name, step }, for its last half hour
    this.limits = null; // { at, rateLimits, planType, credits }: the account's, as of its last answer from the API
  }

  applyLines(lines) {
    for (const line of lines) {
      const at = Date.parse(line.match(/^\{"timestamp":"([^"]+)"/)?.[1] ?? '');
      if (at > this.lastActivityAt) this.lastActivityAt = at;
      const limits = line.includes('"type":"token_count"') && line.includes('"rate_limits":{');
      if (!limits && !/"type":"(task_started|task_complete|turn_aborted|custom_tool_call|function_call|custom_tool_call_output|function_call_output)"/.test(line)) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === 'response_item' && /^(?:custom_tool_call_output|function_call_output)$/.test(ev.payload?.type ?? '')) {
        const p = ev.payload, pending = this.gitPending.get(p.call_id);
        if (pending) {
          const text = typeof p.output === 'string' ? p.output : JSON.stringify(p.output ?? '');
          const events = completedGit(pending.actions, text, undefined, pending.id, at || this.lastActivityAt);
          this.gitEvents.push(...events); this.gitEvents = this.gitEvents.slice(-200);
          const session = /["']?session_id["']?\s*:\s*(\d+)/.exec(text)?.[1];
          const ended = events.length || /(?:"?exit_code"?\s*:\s*|(?:Process exited with code|Exit code:)\s*)-?\d+/i.test(text);
          if (pending.session && ended) this.gitRunning.delete(pending.session);
          if (session && !ended) this.gitRunning.set(session, { ...pending, session });
          if (this.gitRunning.size > 100) this.gitRunning.delete(this.gitRunning.keys().next().value);
          this.gitPending.delete(p.call_id);
        }
        continue;
      }
      if (ev.type === 'response_item' && (ev.payload?.type === 'custom_tool_call' || ev.payload?.type === 'function_call')) { // a tool call: what kind of step it is
        const p = ev.payload, input = p.arguments ?? p.input, args = shellInput(input);
        const actions = gitActions(input), running = this.gitRunning.get(String(args.session_id ?? ''));
        if (actions.length || running) this.gitPending.set(p.call_id, running ?? { actions, id: p.call_id });
        if (this.gitPending.size > 200) this.gitPending.delete(this.gitPending.keys().next().value);
        const step = codexStep(ev.payload);
        this.work.steps[step] = (this.work.steps[step] ?? 0) + 1;
        this.lastStep = { step, tool: String(ev.payload.name ?? 'tool').slice(0, 40), at: at || this.lastActivityAt };
        this.recent.push({ at: this.lastStep.at, name: this.lastStep.tool, step });
        if (this.recent.length > 120) this.recent.shift();
        continue;
      }
      if (ev.type !== 'event_msg') continue;
      if (limits && ev.payload?.type === 'token_count') {
        const rl = ev.payload.rate_limits, rateLimits = codexLimits(rl, at);
        if (rateLimits.length) this.limits = { at: at || this.lastActivityAt, rateLimits, planType: typeof rl.plan_type === 'string' ? rl.plan_type : null, credits: Number.isFinite(Number(rl.credits?.balance)) ? Number(rl.credits.balance) : null };
        continue;
      }
      const p = ev.payload, own = sec => (Number(sec) > 0 ? Number(sec) * 1000 : at || this.lastActivityAt); // when the turn itself says it was
      if (p?.type === 'task_started') {
        if (own(p.started_at) < this.from) continue;
        this.turnOpen = true;
        this.turnStartAt = own(p.started_at);
      } else if (p?.type === 'task_complete' || p?.type === 'turn_aborted') {
        if (own(p.completed_at) < this.from) continue;
        this.turnOpen = false;
        this.lastTurnEndAt = at || this.lastActivityAt;
        this.aborted = p.type === 'turn_aborted';
        if (typeof p.last_agent_message === 'string') { this.lastReply = firstLine(p.last_agent_message); this.lastMessage = p.last_agent_message.slice(0, MESSAGE_KEPT); }
      }
    }
  }
}
