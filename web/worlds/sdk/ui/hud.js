// The HUD every world of api 2 has, the same in each: top left, a panel with what the dashboard's top bar
// says (cost, compactions, the counts, memory, processor and the plan's limits); top right, one Menu with the
// dashboard's own buttons, this world's switches, the bell, help and zoom. It is HTML made from the scene
// and a few switches; the runtime draws it and reads its buttons by their data-do attribute. A world gives it
// only its words (world.json, "nouns"). No three.js.
import { ago, esc } from '../core/util.js';

const gb = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
const tone = r => (r >= 0.8 ? 'bad' : r >= 0.5 ? 'warn' : 'ok');
const bar = r => `<span class="wv-bar"><i class="${tone(r)}" style="width:${Math.round(Math.max(0, Math.min(1, r)) * 100)}%"></i></span>`;
const used = w => (w ? (w.reset ? 0 : Math.round(w.pct)) : null); // a limit's window, in percent used; null: no reading

/**
 * The HUD's HTML. `s`: { scene (web/scene.js), nouns, own (a world from your folder: the page's own buttons lie
 * top left, so the panel sits below them), orbit (the view can be turned), still, zoom, saysOn, skyMode, follow,
 * canFollow, restingHidden (how many, or null: shown), bell, awake, nav ({ theme, side, live }), panelOpen, menuOpen }.
 */
export function hudHtml(s) {
  const scene = s.scene ?? { agents: [], chrome: {}, accounts: [] }, n = s.nouns, ch = scene.chrome ?? {}, c = ch.counts ?? {}, nav = s.nav ?? {};
  const agents = scene.agents ?? [];
  const spent = agents.reduce((t, a) => t + (a.cost ?? 0), 0), compacted = agents.reduce((t, a) => t + (a.compactions ?? 0), 0);
  const need = agents.filter(a => a.state === 'waiting' || a.question).length;
  const kpi = (state, glyph, cls, name, count, sub, hot, title) => `<button type="button" class="wv-kpi${hot ? ' hot' : ''}"${state && count ? ` data-do="state:${state}"` : ' disabled'} title="${esc(title)}"><i class="${cls}">${glyph}</i><b>${count ?? 0}</b><span>${esc(name)}<small>${esc(sub)}</small></span></button>`;
  const gauge = (label, ratio, value, note, title) => `<div class="wv-gauge" title="${esc(title)}"><span>${esc(label)}</span>${bar(ratio)}<b>${esc(value)}</b><small>${esc(note)}</small></div>`;
  const ram = ch.ram?.totalMb ? ch.ram.usedMb / ch.ram.totalMb : 0, cpu = (ch.cpu?.used ?? 0) / ((ch.cpu?.cores || 1) * 100);
  const five = used(scene.plan?.fiveHour), week = used(scene.plan?.weekly), accounts = scene.accounts ?? [];
  const limits = accounts.length > 1
    ? accounts.map((a, i) => { // with two or more Claude accounts: each one's week, and its 5 hours beside it
      const wk = used(a.plan?.weekly), f5 = used(a.plan?.fiveHour), name = typeof a.name === 'string' && a.name ? a.name : `account ${i + 1}`;
      return gauge(name.slice(0, 8), (wk ?? 0) / 100, wk === null ? '–' : `${wk}%`, `week · 5h ${f5 === null ? '–' : `${f5}%`}`, `${name}: ${wk === null ? 'no weekly reading' : `${wk}% of its week`}, ${f5 === null ? 'no 5-hour reading' : `${f5}% of its 5 hours`}`);
    }).join('')
    : `${five === null ? '' : gauge('5h', five / 100, `${five}%`, '5-hour limit', "Your plan's 5-hour limit")}${week === null ? '' : gauge('Week', week / 100, `${week}%`, 'this week', "Your plan's weekly limit")}`;
  const item = (action, label, state, title, { pressed, disabled } = {}) => `<button type="button" data-do="${action}" title="${esc(title)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}${disabled ? ' disabled' : ''}><span>${esc(label)}</span>${state ? `<em>${esc(state)}</em>` : ''}</button>`;
  const brand = typeof window !== 'undefined' && window.Agentville?.svg ? window.Agentville.svg({ size: 18, cls: 'wv-logo' }) : ''; // Agentville's mark (web/brand.js)
  return `<div class="wv-panel${s.panelOpen ? '' : ' folded'}${s.own ? ' own' : ''}">
      <button type="button" class="wv-brand" data-do="panel" aria-expanded="${Boolean(s.panelOpen)}" title="${s.panelOpen ? 'Fold this panel away' : 'Show the counts and meters'}">${brand}<b>Agentville</b><i class="wv-live${nav.live === false ? ' off' : ''}" title="${nav.live === false ? 'Disconnected from the collector: retrying' : 'Live'}"></i><span>${s.panelOpen ? '−' : '+'}</span></button>
      <div class="wv-line"><span title="What the sessions here have cost so far">$${spent.toFixed(2)}</span><span title="Each time a session's conversation was compacted">${compacted} compacted</span></div>
      <div class="wv-kpis">
        ${kpi('waiting', '!', 'k-wait', 'waiting on you', c.waiting, c.waiting ? `oldest ${ago(ch.oldestWaiting ?? Date.now())}` : 'all clear', c.waiting > 0, 'Agents waiting on you (a question or a permission): click for the first')}
        ${kpi('working', '›', 'k-work', 'working', c.working, ch.subagentsRunning ? `${ch.subagentsRunning} with subagents` : `${ch.agents ?? 0} agents tracked`, false, 'Agents at work: click for the first')}
        ${kpi('turn', '‹', 'k-turn', 'your turn', c.yourTurn, `${ch.asking ? `${ch.asking} ask you · ` : ''}${c.idle ?? 0} idle · ${c.stale ?? 0} stale`, ch.asking > 0, "Agents whose turn ended: it's yours. Click for the first")}
        ${kpi(null, '⚠', 'k-collide', 'collisions', c.collisions, c.collisions ? 'two in one repo' : 'none', c.collisions > 0, 'Two agents writing one repo')}
      </div>
      <div class="wv-gauges">
        ${gauge('RAM', ram, gb(ch.ram?.usedMb ?? 0), ch.ram?.totalMb ? `of ${gb(ch.ram.totalMb)}` : '', "Memory used by the agents, of this computer's")}
        ${gauge('CPU', cpu, `${Math.round(cpu * 100)}%`, `${ch.cpu?.cores ?? 1} cores`, `CPU used by the agents: ${Math.round(ch.cpu?.used ?? 0)}% of one core`)}
        ${limits}
      </div>
      ${(ch.errors ?? []).map(e => `<div class="wv-err">⚠ ${esc(e)}</div>`).join('')}
      ${need ? `<button type="button" class="wv-need" data-do="need" title="Open the first agent that needs you">${need} need${need > 1 ? '' : 's'} you</button>` : ''}
    </div>
    <div class="wv-nav">
      <button type="button" class="wv-menu-btn" data-do="menu" aria-expanded="${Boolean(s.menuOpen)}" title="The dashboard's buttons, the ${esc(n.place)}'s switches, the bell, help and zoom">☰ Menu</button>
      <div class="wv-menu" role="group" aria-label="Menu"${s.menuOpen ? '' : ' hidden'}>
        <h4>Dashboard</h4>
        <div class="wv-grid">
          ${item('nav:list', 'List', '', 'Back to the list view')}
          ${item('nav:worlds', 'World', '', 'Choose a world')}
          ${item('nav:session', 'Session', '', 'Start a new Claude Code session in a folder, or resume a past one')}
          ${item('nav:setup', 'Claude Code', '', 'Your Claude Code setup: plugins and skills, MCP servers, permission rules')}
          ${item('nav:side', 'Sidebar', '', `Show the selected ${n.agent}'s answer box, activity and files beside the ${n.place}`, { pressed: Boolean(nav.side) })}
          ${item('nav:broadcast', 'Broadcast', '', 'Message several agents at once')}
          ${item('nav:theme', 'Theme', String(nav.theme ?? 'auto'), 'Theme: dark, light, or auto: click to change')}
        </div>
        <h4>In the ${esc(n.place)}</h4>
        ${item('follow', 'Follow', s.follow ? 'on' : 'off', s.canFollow ? `Keep the ${n.agent} you picked in the middle of the view; dragging the view turns it off` : `Pick one of the ${n.agents} first, then Follow keeps it in view`, { disabled: !s.canFollow })}
        ${item('resting', 'Resting', s.restingHidden === null ? 'shown' : `hidden (${s.restingHidden})`, `Idle and stale ${n.agents}: show them, or hide them`)}
        ${item('bubbles', 'Bubbles', s.saysOn ? 'on' : 'off', `Speech bubbles with what each ${n.agent} last said. × hides one; its 💬 shows it again`)}
        ${item('sky', 'Sky', s.skyMode, 'The light: live follows your clock; or hold it at day or night')}
        ${item('motion', 'Motion', s.still ? 'off' : 'on', `Walking and animation in the ${n.place}`)}
        <hr>
        ${item('bell', 'Bell', s.bell ? 'on' : 'off', 'A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you')}
        ${item('awake', 'Screen', s.awake ? 'stays on' : 'may sleep', 'Keep this screen on while the dashboard is open. Needs HTTPS or localhost')}
        ${item('help', 'Help', '', `How to read the ${n.place}`)}
        <div class="wv-zoom" title="Zoom the ${esc(n.place)} inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around${s.orbit ? '; drag with the right button, or with Alt, to turn the view' : ''}"><span>Zoom</span><span><button type="button" data-do="zoom:-1" aria-label="Zoom out">−</button><button type="button" data-do="zoom:0" title="Show the whole ${esc(n.place)}">${Math.round((s.zoom ?? 1) * 100)}%</button><button type="button" data-do="zoom:1" aria-label="Zoom in">+</button></span></div>
      </div>
    </div>`;
}
