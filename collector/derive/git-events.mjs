import { resolve } from 'node:path';

/** Read shell arguments without evaluating scripts or interpolating their contents. */
export function shellInput(input) {
  if (typeof input === 'object' && input) return input;
  if (typeof input !== 'string') return {};
  try { const v = JSON.parse(input); if (v && typeof v === 'object') return v; } catch { /* a script, not JSON */ }
  const quoted = /\bcmd\s*:\s*("(?:[^"\\]|\\.)*")/g;
  const commands = [...input.matchAll(quoted)].flatMap(m => { try { return [JSON.parse(m[1])]; } catch { return []; } });
  const dirs = [...input.matchAll(/\b(?:workdir|cwd)\s*:\s*("(?:[^"\\]|\\.)*")/g)].flatMap(m => { try { return [JSON.parse(m[1])]; } catch { return []; } });
  if (new Set(dirs).size > 1) return {};
  return { cmd: commands.join('\n'), workdir: dirs[0] };
}

export function gitActions(input, cwd = '') {
  const args = shellInput(input), cmd = args.cmd ?? args.command;
  if (typeof cmd !== 'string') return [];
  const out = [];
  // Only executable command positions count; quoted documentation and echo output do not.
  const commands = [];
  let quote = '', part = '';
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (c === '\\' && quote !== "'") { part += c + (cmd[++i] ?? ''); continue; }
    if (quote) { part += c; if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; part += c; continue; }
    if (c === '#' && (!part || /\s$/.test(part))) { while (i < cmd.length && cmd[i] !== '\n') i++; commands.push(part); part = ''; continue; }
    if (c === ';' || c === '\n' || c === '&' || c === '|') { commands.push(part); part = ''; continue; }
    part += c;
  }
  commands.push(part);
  for (const command of commands) {
    const m = /^\s*(?:git\s+(?:-C\s+("[^"]+"|'[^']+'|[^\s;&]+)\s+)?(commit|push)\b|gh\s+pr\s+(create|merge)\b)([^\n;&]*)/.exec(command);
    if (!m) continue;
    if (/--dry-run\b/.test(m[4])) continue;
    const folder = m[1]?.replace(/^['"]|['"]$/g, '') ?? args.workdir ?? args.cwd ?? cwd;
    out.push({ kind: m[2] ?? `pr-${m[3]}`, cwd: folder ? resolve(cwd || '.', folder) : cwd, ...(m[3] === 'merge' && /\s+(\d+)\b/.test(m[4]) ? { pr: Number(/\s+(\d+)\b/.exec(m[4])[1]) } : {}) });
  }
  return out;
}

/** A completed operation needs output evidence; a tool that merely launched a process earns nothing. */
export function completedGit(actions, output, ok, id, at) {
  const text = typeof output === 'string' ? output : JSON.stringify(output ?? '');
  const exit = /(?:"?exit_code"?\s*:\s*|(?:Process exited with code|Exit code:)\s*)(-?\d+)/i.exec(text);
  if (exit) ok = Number(exit[1]) === 0;
  if (/Script running|Process running|"session_id"\s*:\s*\d+/.test(text) && !exit) return [];
  return actions.flatMap((a, i) => {
    const evidence = a.kind === 'commit' ? /\[[^\]\n]+\s([a-f0-9]{7,40})\]/i.exec(text)?.[1]
      : a.kind === 'push' ? /(?:[a-f0-9]{7,40}\.\.[a-f0-9]{7,40}|\[new (?:branch|tag)\])[^\n]*->[^\n]*/i.exec(text)?.[0]
      : a.kind === 'pr-create' ? /https:\/\/github\.com\/[^\s"\\]+\/pull\/\d+/.exec(text)?.[0]
      : /(?:Merged pull request|Successfully merged|merged[^\n]*pull request)[^\n]*/i.exec(text)?.[0];
    const outcome = evidence && !(ok === false && actions.length === 1) ? true : ok;
    if (outcome !== true && !(outcome === false && actions.length === 1)) return [];
    if (outcome && !evidence) return [];
    const pr = a.pr ?? Number(/(?:\/pull\/|#)(\d+)/.exec(evidence ?? '')?.[1]);
    return [{ id: `${id}:${i}`, at, kind: a.kind, cwd: a.cwd, ok: outcome, ...(pr ? { pr } : {}), evidence: evidence?.slice(0, 180) ?? '' }];
  });
}
