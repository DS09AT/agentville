import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { renameOver } from '../lib/replace.mjs';

export function newScore(players = ['A', 'B']) {
  return { points: [0, 0], games: [0, 0], sets: [0, 0], results: [], order: [...players], server: 0, ends: 0, tie: false, tieFirst: 0, winner: null };
}

export function pointText(s) {
  if (s.tie) return s.points.map(String);
  const [a, b] = s.points;
  if (a >= 3 && b >= 3) return a === b ? ['40', '40'] : a > b ? ['AD', '40'] : ['40', 'AD'];
  return s.points.map(p => ['0', '15', '30', '40'][Math.min(p, 3)]);
}

/** Standard advantage games, tie-break sets and best of three (ITF Rules 5–7, 10, 14–15). */
export function winPoint(s, team) {
  if (s.winner !== null) return;
  s.points[team]++;
  const total = s.points[0] + s.points[1];
  const won = s.points[team] >= (s.tie ? 7 : 4) && s.points[team] - s.points[1 - team] >= 2;
  if (s.tie) {
    if (total % 6 === 0 && !won) s.ends ^= 1;
    s.server = (s.tieFirst + 1 + Math.floor((total - 1) / 2)) % s.order.length;
  }
  if (!won) return;
  const wasTie = s.tie;
  if (wasTie) s.ends ^= 1;
  s.games[team]++;
  if (!wasTie && (s.games[0] + s.games[1]) % 2 === 1) s.ends ^= 1;
  s.server = ((wasTie ? s.tieFirst : s.server) + 1) % s.order.length;
  s.points = [0, 0];
  if (wasTie || (s.games[team] >= 6 && s.games[team] - s.games[1 - team] >= 2)) {
    s.results.push([...s.games]);
    s.sets[team]++;
    s.games = [0, 0]; s.tie = false;
    if (s.sets[team] === 2) s.winner = team;
  } else if (s.games[0] === 6 && s.games[1] === 6) {
    s.tie = true; s.tieFirst = s.server;
  }
}

export function lineup(parent, children, previous = null) {
  const active = children.filter(c => c.kind === 'subagent' && c.state === 'running');
  const old = previous?.mode === 'doubles' ? [previous.teams[1][0], previous.teams[0][1], previous.teams[1][1]] : previous ? previous.teams.flat().filter(id => id !== parent.id) : [];
  active.sort((a, b) => {
    const ai = old.indexOf(a.id), bi = old.indexOf(b.id);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi) || (a.startedAt ?? 0) - (b.startedAt ?? 0) || a.id.localeCompare(b.id);
  });
  const ids = active.map(c => c.id), mode = ids.length >= 3 ? 'doubles' : ids.length ? 'singles' : 'training';
  const teams = mode === 'doubles' ? [[parent.id, ids[1]], [ids[0], ids[2]]] : [[parent.id], [ids[0] ?? '@machine']];
  const helpers = ids.slice(mode === 'doubles' ? 3 : 1).map((id, i) => ({ id, role: mode === 'doubles' && i === 0 ? 'umpire' : 'ball-person' }));
  return { parent: parent.id, mode, teams, helpers };
}

function encounter(roster, previous, at) {
  const order = roster.mode === 'doubles' ? [roster.teams[0][0], roster.teams[1][0], roster.teams[0][1], roster.teams[1][1]] : roster.teams.flat();
  const history = previous ? [...(previous.history ?? []), { mode: previous.mode, teams: previous.teams, score: previous.score, at }].slice(-4) : [];
  return { ...roster, score: newScore(order), history, last: null, changeAt: at };
}

function continueScore(next, previous) {
  const order=next.score.order,old=previous.score,server=old.order[old.server],team=previous.teams.findIndex(t=>t.includes(server));
  next.score={...structuredClone(old),order};
  next.score.server=Math.max(0,order.indexOf(order.includes(server)?server:next.teams[Math.max(0,team)][0]));
  const first=old.order[old.tieFirst],firstTeam=previous.teams.findIndex(t=>t.includes(first));
  next.score.tieFirst=Math.max(0,order.indexOf(order.includes(first)?first:next.teams[Math.max(0,firstTeam)][0]));next.last=previous.last;
}

/** The collector owns and persists matches, including when no browser watches a world. */
export function createTennis({ file = null, now = Date.now(), log = () => {} } = {}) {
  let state = { version: 1, rosterScores: 1, since: now, courts: {}, cursors: {}, prs: {} }, saved = '';
  if (file && existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8'));
      if (data.version !== 1 || !data.courts || !data.cursors || !Number.isFinite(data.since)) throw new Error('invalid tennis state');
      state = { ...data, prs: data.prs ?? {} }; saved = JSON.stringify(state);
    } catch (err) { throw new Error(`Cannot read tennis scores (${file}): ${err.message}`); }
  }
  return {
    update(agents, repos, at, lookup = () => null) {
      const byId = new Map(agents.map(a => [a.id, a]));
      const repoFor = a => lookup(a.cwd) ?? repos.filter(r => a.cwd === r.path || a.cwd?.startsWith(`${r.path}/`)).sort((a, b) => b.path.length - a.path.length)[0]?.path;
      for (const r of repos) {
        const candidates = agents.filter(a => a.state === 'working' && repoFor(a) === r.path);
        let match = state.courts[r.path];
        const uncounted = (actor, e) => {
          const c = state.cursors[actor];
          return e.at >= state.since && !c?.recent?.includes(e.id) && (!c || e.at > c.at || (e.at === c.at && !c.ids.includes(e.id)));
        };
        const former = byId.get(match?.parent);
        const pending = match && former && [
          ...(former.gitEvents ?? []).map(e => [former.id, e]),
          ...(former.children ?? []).flatMap(c => (c.gitEvents ?? []).map(e => [c.id, e])),
        ].some(([actor, e]) => match.teams.some(t => t.includes(actor)) && uncounted(actor, e));
        const ready = at - (match?.last?.at ?? 0) >= 2400;
        const next = match?.score.winner !== null && ready ? candidates.find(a => a.id !== match?.parent) : null;
        const parent = pending || (!ready && former) ? former : next ?? candidates.find(a => a.id === match?.parent) ?? candidates[0];
        if (!parent) { if (match) match.active = false; continue; }
        const roster = lineup(parent, parent.children ?? [], match), key = v => JSON.stringify([v.parent, v.mode, v.teams]);
        if (!match || (key(match) !== key(roster) && ready && !pending)) {
          const previous=match;match=state.courts[r.path]=encounter(roster,previous,at);
          if(previous?.parent===roster.parent&&previous.score.winner===null)continueScore(match,previous);
        }
        match.active = parent.state === 'working' && repoFor(parent) === r.path;
        if (key(match) === key(roster)) match.helpers = roster.helpers;
        const names = new Map([[parent.id, parent.name], ...(parent.children ?? []).map(c => [c.id, c.label || c.agentType || 'Subagent']), ['@machine', 'Ball machine']]);
        match.names = Object.fromEntries([...match.teams.flat(), ...match.helpers.map(h => h.id)].map(id => [id, names.get(id) ?? id]));
      }
      if(!state.rosterScores){
        const complete=Object.values(state.cursors).every(c=>Array.isArray(c.recent)&&c.recent.length<200),total=Object.values(state.cursors).reduce((n,c)=>n+(c.recent?.length??200),0);
        for(const [path,m]of Object.entries(state.courts)){
          if(m.score.winner!==null||[...m.score.games,...m.score.sets].some(Boolean))continue;
          const ownerHistory=[...(m.history??[])].reverse();
          for(const h of m.score.points.some(Boolean)?[]:ownerHistory){
            if(h.teams[0][0]!==m.parent||h.score.winner!==null)break;
            if([...h.score.points,...h.score.games,...h.score.sets].some(Boolean)){continueScore(m,{...h,parent:m.parent,last:m.last});break;}
          }
          // Fewer than four fully retained events cannot have completed a game; restore known lost parent points only.
          if(!m.score.games.some(Boolean)&&!m.score.sets.some(Boolean)&&complete&&total<4&&ownerHistory.every(h=>h.teams[0][0]===m.parent&&h.score.winner===null)){
            const a=byId.get(m.parent);
            const restored=new Set(),known=[0,0];let latest=null;
            for(const e of a?.gitEvents??[])if(!restored.has(e.id)&&e.at>=state.since&&state.cursors[a.id]?.recent.includes(e.id)&&repoFor({cwd:e.cwd||a.cwd})===path){restored.add(e.id);known[e.ok?0:1]++;if(!latest||e.at>latest.at)latest=e;}
            const changed=known.some((n,i)=>n>m.score.points[i]);m.score.points=m.score.points.map((n,i)=>Math.max(n,known[i]));
            if(changed&&latest)m.last={id:latest.id,actor:a.id,at,eventAt:latest.at,kind:latest.kind,ok:latest.ok,team:latest.ok?0:1};
          }
        }
        state.rosterScores=1;
      }
      const events = agents.flatMap(a => [
        ...(a.gitEvents ?? []).map(e => ({ ...e, actor: a.id, parent: a.id, folder: a.cwd })),
        ...(a.children ?? []).flatMap(c => (c.gitEvents ?? []).map(e => ({ ...e, actor: c.id, parent: a.id, folder: a.cwd }))),
      ]).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      for (const r of repos) for (const p of r.prs?.merged ?? []) {
        const owner = state.prs[`${r.path}#${p.number}`];
        if (owner && !owner.merged && Number.isFinite(p.at)) events.push({ id: `pr-merged:${p.number}`, at: p.at, kind: 'pr-merge', pr: p.number, ok: true, external: true, actor: owner.actor, parent: owner.parent, folder: r.path });
      }
      events.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      for (const e of events) {
        if (!Number.isFinite(e.at) || e.at < state.since || !e.id) continue;
        const cursor = state.cursors[e.actor] ?? { at: state.since, ids: [] };
        if (!e.external && (cursor.recent?.includes(e.id) || e.at < cursor.at || (e.at === cursor.at && cursor.ids.includes(e.id)))) continue;
        if (!e.external) state.cursors[e.actor] = { at: e.at, ids: e.at === cursor.at ? [...cursor.ids, e.id] : [e.id], recent: [...(cursor.recent ?? cursor.ids), e.id].slice(-200) };
        const r = repoFor({ cwd: e.cwd || e.folder }), m = state.courts[r];
        if (!m || m.parent !== e.parent) continue;
        if (e.ok && e.pr) {
          const key = `${r}#${e.pr}`, owner = state.prs[key];
          if ((e.kind === 'pr-create' && owner) || (e.kind === 'pr-merge' && owner?.merged)) continue;
          state.prs[key] = { actor: owner?.actor ?? e.actor, parent: owner?.parent ?? e.parent, merged: e.kind === 'pr-merge' };
        }
        const team = m.teams.findIndex(t => t.includes(e.actor));
        if (team < 0) continue; // a ball person or umpire's work does not become a player's point
        if (m.score.winner !== null) state.courts[r] = encounter(m, m, e.at);
        const current = state.courts[r];
        winPoint(current.score, e.ok ? team : 1 - team);
        current.last = { id: e.id, actor: e.actor, at, eventAt: e.at, kind: e.kind, ok: e.ok, team: e.ok ? team : 1 - team };
      }
      const json = JSON.stringify(state);
      if (file && json !== saved) {
        try { writeFileSync(`${file}.tmp`, json); renameOver(`${file}.tmp`, file); saved = json; }
        catch (err) { log(`Cannot save tennis scores: ${err.message}`); }
      }
      return Object.fromEntries(repos.flatMap(r => state.courts[r.path] ? [[r.path, structuredClone({ ...state.courts[r.path], points: pointText(state.courts[r.path].score) })]] : []));
    },
  };
}
