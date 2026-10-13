// What is written over a world: each agent's tag (a glyph for what it does, its name when it needs you or is
// picked), speech bubbles, each plot's label with its repo's state, a count where a place is full, and words
// that pop up. All of it is HTML laid over the canvas at the points the stage gives, the same in every world
// of api 2, so names stay sharp and can be clicked, read aloud and searched. No three.js.
import { stepOf } from '../core/steps.js';
import { clip, cutMid, esc } from '../core/util.js';

const DEPLOY = { ok: ['✓', 'ok'], failed: ['✗', 'bad'], running: ['◌', 'run'], blocked: ['⏸', 'dim'] };

/** The glyph over an agent, and what it stands for: what it does now, in one sign. `steps`: the world's (manifest.steps). */
export function glyphOf(agent, steps) {
  if (agent.state === 'waiting') return agent.planAsk ? ['📋', 'a plan waits for your approval'] : agent.askKind === 'question' ? ['?', 'asks you a question'] : ['!', 'waits for your permission'];
  if (agent.nap) return ['💤', 'naps: it wakes by itself'];
  if (agent.state === 'turn') return agent.question ? ['?', 'asks you something'] : ['✓', 'finished its turn'];
  if (agent.state === 'idle') return ['💤', 'idle'];
  if (agent.state === 'stale') return ['…', 'stale: untouched for days'];
  const step = stepOf(agent);
  return step ? [steps[step].glyph, steps[step].verb] : ['💭', agent.thinking ? 'thinking' : 'between steps'];
}

/** A plot's label: the repo's name, and a chip for each thing to know of it. HTML. */
export function plotLabel(repo, over = 0) {
  const chips = [];
  const d = repo.deploy;
  if (d) { const [glyph, cls] = DEPLOY[d.state] ?? ['•', 'dim']; chips.push(`<i class="dep-${cls}" title="${esc(d.label ?? `deploy: ${d.state}`)}">${glyph}</i>`); }
  if (repo.collision) chips.push('<i class="dep-bad" title="Two agents write here at once">⚠</i>');
  if (repo.dirty) chips.push(`<i title="${repo.dirty} uncommitted">●${repo.dirty}</i>`);
  if (repo.ahead) chips.push(`<i title="${repo.ahead} unpushed">↑${repo.ahead}</i>`);
  if (repo.behind) chips.push(`<i title="${repo.behind} behind">↓${repo.behind}</i>`);
  const open = repo.prs?.open?.length ?? 0;
  if (open) chips.push(`<i title="${open} open pull request${open > 1 ? 's' : ''}">#${open}</i>`);
  if (over) chips.push(`<i title="${over} more here">+${over}</i>`);
  return `<b>${esc(cutMid(repo.name, 18))}</b>${chips.join('')}`;
}

/** `el`: the element over the canvas. */
export function makeOverlay(el, { steps, nouns }) {
  const tags = new Map(), says = new Map(), plots = new Map(), places = new Map(), labels = new Map();
  /** Puts an element at a point of the canvas; written to the page only when it has moved. */
  function at(node, x, y, how = 'translate(-50%, -100%)') {
    const where = `translate(${Math.round(x)}px, ${Math.round(y)}px) ${how}`;
    if (node.where !== where) { node.where = where; node.el.style.transform = where; }
  }
  const hitAt = (placed, left, bottom, w, h) => placed.find(r => left < r.right + 3 && left + w > r.left - 3 && bottom - h < r.bottom + 3 && bottom > r.top - 3);
  function sync(map, keys, make) { // one element per key: made when it comes, removed when it goes
    for (const [k, node] of map) if (!keys.has(k)) { node.el.remove(); map.delete(k); }
    for (const k of keys) if (!map.has(k)) { const node = { el: make(k), key: '' }; el.appendChild(node.el); map.set(k, node); }
  }
  return {
    /**
     * Everything placed anew. `marks`: where each agent shown is (stage.marks()); `agents`: id → agent;
     * `bubbles`: id → { text, min, toSidebar }, for those who have one; `plotMarks`: stage.plotMarks(); `over`:
     * how many more stand at each zone than it shows; `placeMarks`: [{ name, text, at }] for the places to label.
     */
    update({ marks, agents, selected, hover, bubbles, plotMarks, over, placeMarks, labels: extra = [] }) {
      const placed = [];
      sync(tags, new Set(marks.map(m => m.id)), id => { const b = document.createElement('button'); b.type = 'button'; b.dataset.agent = id; return b; });
      for (const m of marks) {
        const a = agents.get(m.id), t = tags.get(m.id);
        t.el.hidden = !a || !m.head || m.quiet && m.id !== selected && m.id !== hover && document.activeElement !== t.el;
        if (t.el.hidden) continue;
        const sel = m.id === selected, open = sel || m.id === hover || document.activeElement === t.el || !m.compact && (a.state === 'waiting' || (a.state === 'turn' && !a.nap));
        const [glyph, what] = glyphOf(a, steps), key = [a.state, a.name, glyph, what, open, sel, a.nap, Math.round((a.contextPct ?? 0) * 20), a.tasks?.done, a.tasks?.total].join('|');
        if (t.key !== key) {
          t.key = key;
          t.el.className = `wv-tag st-${a.state}${a.nap ? ' nap' : ''}${open ? ' open' : ''}${sel ? ' sel' : ''}`;
          t.el.title = `${a.name}: ${what}${a.summary ? ` (${clip(a.summary, 60)})` : ''}`;
          t.el.innerHTML = `<i>${esc(glyph)}</i>${open ? `<span>${esc(cutMid(a.name, 16))}${a.tasks ? ` ${a.tasks.done}/${a.tasks.total}` : ''}</span><em title="${Math.round((a.contextPct ?? 0) * 100)}% of its context used"><u style="width:${Math.round((a.contextPct ?? 0) * 100)}%"></u></em>` : ''}`;
          t.w = null;
        }
        if (t.w == null) { t.w = t.el.offsetWidth; t.h = t.el.offsetHeight; }
        // Two tags that would lie on each other: the later one is lifted clear.
        let bottom = m.head[1];
        for (let guard = 0; guard < 6; guard++) { const hit = hitAt(placed, m.head[0] - t.w / 2, bottom, t.w, t.h); if (!hit) break; bottom = hit.top - 4; }
        placed.push({ left: m.head[0] - t.w / 2, right: m.head[0] + t.w / 2, top: bottom - t.h, bottom });
        t.top = bottom - t.h;
        at(t, m.head[0], bottom);
      }
      const speaking = marks.filter(m => m.head && bubbles.has(m.id));
      sync(says, new Set(speaking.map(m => m.id)), id => { const d = document.createElement('div'); d.dataset.say = id; return d; });
      for (const m of [...speaking].sort((p, q) => p.head[0] - q.head[0])) {
        const a = agents.get(m.id), s = says.get(m.id), b = bubbles.get(m.id), key = [b.min, b.text, a.state, Boolean(a.question), b.toSidebar].join('|');
        if (s.key !== key) {
          s.key = key;
          s.el.className = b.min ? `wv-say-min px-say-min st-${a.state}` : `wv-say px-say st-${a.state}${a.question ? ' q' : ''}`;
          s.el.title = b.min ? `${a.name} ${a.state === 'waiting' ? 'is waiting for you' : 'said something'}: click the 💬 to show it` : `${a.name}: ${b.text} (click to ${b.toSidebar ? 'open it in the sidebar' : 'read the whole conversation'})`;
          s.el.innerHTML = b.min ? `<button type="button" data-do="say-open" aria-label="Show ${esc(a.name)}'s bubble">💬</button>` : `<span>${esc(b.text)}</span><button type="button" class="x" data-do="say-close" aria-label="Hide this bubble" title="Hide (a 💬 stays to show it again)">×</button>`;
          s.w = null;
        }
        if (s.w == null) { s.w = s.el.offsetWidth; s.h = s.el.offsetHeight; }
        const left = Math.max(4, Math.min(m.head[0] - s.w / 2, el.clientWidth - s.w - 4));
        let bottom = (tags.get(m.id)?.top ?? m.head[1]) - 6;
        for (let guard = 0; guard < 12; guard++) { const hit = hitAt(placed, left, bottom, s.w, s.h); if (!hit) break; bottom = hit.top - 5; }
        bottom = Math.max(s.h + 4, bottom);
        placed.push({ left, right: left + s.w, top: bottom - s.h, bottom });
        at(s, left, bottom, 'translate(0, -100%)');
      }
      sync(plots, new Set(plotMarks.map(p => p.bed)), bed => { const b = document.createElement('button'); b.type = 'button'; b.className = 'wv-plot'; b.dataset.plot = String(bed); return b; });
      for (const p of plotMarks) {
        const node = plots.get(p.bed), html = plotLabel(p.repo, over[`plot:${p.bed}`] ?? 0);
        if (node.key !== html) { node.key = html; node.el.innerHTML = html; node.el.title = `${p.repo.name}: the files agents read or wrote in this ${nouns.repo}`; node.el.classList.toggle('bad', Boolean(p.repo.collision) || p.repo.deploy?.state === 'failed'); }
        node.el.hidden = !p.at;
        if (p.at) at(node, p.at[0], p.at[1], 'translate(-50%, 0)');
      }
      sync(labels, new Set(extra.map(l => l.key)), key => { const b = document.createElement('button'); b.type = 'button'; b.className = 'wv-label'; b.dataset.label = key; return b; });
      for (const l of extra) {
        const node = labels.get(l.key), key = `${l.text}|${l.title}`;
        node.el.classList.toggle('in-world', l.inWorld === true);
        if (l.inWorld && l.size) { node.el.style.width = `${l.size[0]}px`; node.el.style.height = `${l.size[1]}px`; }
        if (node.key !== key) { node.key = key; node.el.innerHTML = l.text.split('\n').map(t => window.Agentville.pixelText.pxt(t, '#4e3626', null, 2 / 3)).join('<br>'); node.el.title = l.title ?? l.text; node.el.setAttribute('aria-label', `${l.title ?? ''}: ${l.text}`); node.w = null; }
        node.el.hidden = !l.at;
        if (l.at && l.inWorld) { at(node, l.at[0], l.at[1], 'translate(-50%, -50%)'); }
        else if (l.at) {
          if (node.w == null) { node.w = node.el.offsetWidth; node.h = node.el.offsetHeight; }
          let bottom = l.at[1];
          for (let guard = 0; guard < 12; guard++) { const hit = hitAt(placed, l.at[0] - node.w / 2, bottom, node.w, node.h); if (!hit) break; bottom = hit.top - 4; }
          placed.push({ left: l.at[0] - node.w / 2, right: l.at[0] + node.w / 2, top: bottom - node.h, bottom });
          at(node, l.at[0], bottom);
        }
      }
      sync(places, new Set(placeMarks.map(p => p.name)), () => { const d = document.createElement('div'); d.className = 'wv-place'; return d; });
      for (const p of placeMarks) {
        const node = places.get(p.name);
        if (node.key !== p.text) { node.key = p.text; node.el.textContent = p.text; }
        node.el.hidden = !p.at;
        if (p.at) at(node, p.at[0], p.at[1], 'translate(-50%, 0)');
      }
    },
    /** Words that pop up at a point of the canvas and are gone again. */
    pop(x, y, text, cls = '') {
      const d = document.createElement('div');
      d.className = `wv-pop ${['good', 'warn', 'dim'].includes(cls) ? cls : ''}`;
      d.textContent = text;
      d.style.left = `${Math.round(x)}px`;
      d.style.top = `${Math.round(y)}px`;
      el.appendChild(d);
      setTimeout(() => d.remove(), 1700);
    },
    /** Forgets every size measured: the frame was resized, or its text is drawn at another size. */
    measureAgain() { for (const m of [tags, says, labels]) for (const n of m.values()) n.w = null; },
  };
}
