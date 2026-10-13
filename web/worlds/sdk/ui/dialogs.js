// The dialogs every world of api 2 has: a repo's close-up (the files agents read or wrote in it), the notice
// board (what each project remembers), and how to read the world. Plain HTML in one <dialog>; what they show
// is asked of the page (docs/worlds.md, "Messages": request). No three.js.
import { STEP_NAMES } from '../core/steps.js';
import { ago, clip, esc } from '../core/util.js';

const GIT_WORD = { M: 'modified', U: 'new, not committed', A: 'added', D: 'deleted', R: 'renamed' };
const kindOf = f => (f.doc ? 'doc' : f.wrote && f.agents.filter(a => a.wrote).length > 1 ? 'shared' : f.wrote ? 'write' : 'read');
const KIND_WORD = { write: 'written', read: 'read only', shared: 'written by two or more', doc: 'document' };

/** How to read a world: the signs over the agents, the same in every world, and this world's own words. HTML. */
export function helpHtml(world) {
  const n = world.nouns;
  const signs = [['!', 'waits for your permission'], ['?', 'asks you something'], ['📋', 'a plan waits for your approval'], ['✓', 'finished its turn: it is yours'], ['💤', 'idle, or napping until it wakes by itself'], ['…', 'stale: untouched for days'], ['💭', 'thinking, or between two steps']];
  return `${world.help ? `<p>${esc(world.help)}</p>` : ''}
    <dl class="wv-key"><dt>${esc(n.agents)}</dt><dd>one for each agent working on this computer; its colour is its colour in the list</dd><dt>${esc(n.repos)}</dt><dd>one for each repo an agent works in: click one for the files touched there</dd><dt>subagents</dt><dd>helpers of their parent agent; their appearance depends on the world</dd><dt>a letter in the air</dt><dd>a message from one agent to another</dd></dl>
    <h4>Over each ${esc(n.agent)}</h4><dl class="wv-key">${signs.map(([g, t]) => `<dt>${g}</dt><dd>${esc(t)}</dd>`).join('')}</dl>
    <h4>At work</h4><dl class="wv-key wv-steps">${STEP_NAMES.map(k => `<dt>${esc(world.steps[k].glyph)}</dt><dd>${esc(world.steps[k].verb)}</dd>`).join('')}</dl>`;
}

/**
 * `host`: where the dialog is put; `request(kind, args)`: asks the page (a promise of { ok, status, data?, error? });
 * `nouns`: the world's words; `colorOf(id)`, `nameOf(id)`: an agent's colour and name.
 */
export function makeDialogs(host, { request, nouns, colorOf, nameOf }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'wv-dlg px-help px-dlg';
  dlg.innerHTML = '<header><b class="wv-dlg-title px-dlg-title"></b><button type="button" class="x" data-do="dlg-close" aria-label="Close">×</button></header><div class="wv-dlg-body px-dlg-body"></div>';
  host.appendChild(dlg);
  const body = dlg.querySelector('.wv-dlg-body');
  let asked = 0, repo = null; // the close-up showing: { key, name, data, sel }
  function show(title, html) {
    dlg.querySelector('.wv-dlg-title').textContent = title;
    body.innerHTML = html;
    if (!dlg.open) dlg.showModal();
  }
  function repoHtml() {
    const { data, sel } = repo, groups = new Map();
    for (const f of data.files ?? []) { const dir = f.path.includes('/') ? `${f.path.split('/')[0]}/` : './'; if (!groups.has(dir)) groups.set(dir, []); groups.get(dir).push(f); }
    const who = f => f.agents.map(a => `<i style="background:${esc(colorOf(a.id))}" title="${esc(nameOf(a.id) ?? a.id)}"></i>`).join('');
    const rows = [...groups].sort((a, b) => (a[0] === './' ? 1 : b[0] === './' ? -1 : a[0].localeCompare(b[0])))
      .map(([dir, list]) => `<li class="dir">${esc(dir)}</li>${list.map(f => `<li><button type="button" class="wv-file${sel === f.path ? ' on' : ''}" data-file="${esc(f.path)}"><i class="k k-${kindOf(f)}"></i><span>${esc(dir === './' ? f.path : f.path.slice(dir.length))}</span><span class="who">${who(f)}</span><time>${ago(f.at)}</time></button></li>`).join('')}`).join('');
    const f = (data.files ?? []).find(x => x.path === sel);
    const detail = f ? `<div class="wv-detail"><b>${esc(f.path)}</b><div class="muted">${esc(KIND_WORD[kindOf(f)])} · by ${f.agents.map(a => esc(nameOf(a.id) ?? a.id)).join(' and ')} · ${ago(f.at)} ago · git: ${f.git ? esc(GIT_WORD[f.git] ?? f.git) : 'committed'}</div>${f.doc ? '<div><button type="button" class="act" data-do="file-read">Open in the reader</button></div>' : ''}${kindOf(f) === 'shared' ? `<div class="warnline">Two or more ${esc(nouns.agents)} wrote this file: this is where a collision would bite.</div>` : ''}</div>` : '';
    return `${data.branch ? `<p class="muted">branch ${esc(clip(data.branch, 40))}</p>` : ''}<ul class="wv-files">${rows || '<li class="muted">Nothing touched in the last 24 hours.</li>'}</ul>${detail}<p class="faint">Only files agents read or wrote in the last 24 h are shown, not the whole folder.${data.truncated ? ' Showing the newest 300.' : ''}</p>`;
  }
  return {
    get open() { return dlg.open; },
    close() { repo = null; if (dlg.open) dlg.close(); },
    show,
    /** A repo's close-up: the files agents read or wrote there. */
    async repo(r) {
      const mine = ++asked;
      repo = null;
      show(`${r.name} ${nouns.repo}`, '<p class="muted">Reading…</p>');
      const res = await request('repoTouched', { repo: r.key }).catch(err => ({ ok: false, status: 0, error: String(err?.message ?? err) }));
      if (mine !== asked || !dlg.open) return;
      if (!res.ok) { body.innerHTML = `<p class="muted">${esc(res.error ?? `Could not load the ${nouns.repo} (HTTP ${res.status}).`)}</p>`; return; }
      repo = { key: r.key, data: res.data ?? {}, sel: null };
      body.innerHTML = repoHtml();
    },
    /** The notice board: each of `sessions` ({ id, cwd })'s project files and memory. */
    async board(sessions) {
      const mine = ++asked;
      repo = null;
      show('The notice board: what your projects remember', '<p class="muted">Reading…</p>');
      const parts = await Promise.all(sessions.map(async s => {
        const name = esc(String(s.cwd ?? '').split('/').pop() || s.cwd || s.name);
        const r = await request('agentFiles', { agentId: s.id }).catch(() => ({ ok: false, status: 0 }));
        if (!r.ok && r.status === 0) return `<h4>${name}</h4><p class="muted">Could not read it.</p>`;
        const files = (r.ok ? r.data : null)?.memory ?? [];
        return `<h4>${name}</h4>${files.length ? `<ul class="wv-files">${files.map(m => `<li><button type="button" class="act" data-mem="${esc(s.id)}" data-path="${esc(m.path)}">${esc(m.label)}</button><span class="muted">${esc(m.where)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing remembered here yet.</p>'}`;
      }));
      if (mine === asked && dlg.open) body.innerHTML = parts.join('') || '<p class="muted">No sessions here.</p>';
    },
    /** A click inside the dialog: what it asks for, as { close } | { doc: [agentId, path] } | null (handled here, or nothing). */
    click(target) {
      if (target === dlg || target.closest('[data-do="dlg-close"]')) return { close: true };
      const mem = target.closest('[data-mem]');
      if (mem) return { doc: [mem.dataset.mem, mem.dataset.path] };
      if (!repo) return null;
      const read = target.closest('[data-do="file-read"]'), file = target.closest('[data-file]');
      const f = repo.data.files?.find(x => x.path === (read ? repo.sel : file?.dataset.file));
      if (read && f?.agents.length) return { doc: [f.agents[0].id, `${repo.data.repo ?? repo.key}/${f.path}`] };
      if (file && f) { repo.sel = f.path; body.innerHTML = repoHtml(); }
      return null;
    },
  };
}
