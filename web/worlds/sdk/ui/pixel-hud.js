// The same Farm controls in every world; independent of its renderer.
'use strict';
const uiAgo = ms => { const m = Math.max(0, (Date.now() - ms) / 60000); return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; };
function uiSprite(rows, pal) { const c = document.createElement('canvas'); c.width = rows[0].length; c.height = rows.length; const g = c.getContext('2d'); rows.forEach((r,y) => { for(let x=0;x<r.length;x++) if(pal[r[x]]) { g.fillStyle=pal[r[x]]; g.fillRect(x,y,1,1); } }); return c; }
  const ICONS = {
    follow: ['....k....', '..kkkkk..', '.k.....k.', '.k.....k.', 'kk..r..kk', '.k.....k.', '.k.....k.', '..kkkkk..', '....k....'],
    resting: ['.....kkkk', '.......k.', '......k..', '.....kkkk', 'kkkkk....', '...k.....', '..k......', '.k.......', 'kkkkk....'],
    bubbles: ['.........', '.kkkkkkk.', 'kwwwwwwwk', 'kwkwkwkwk', 'kwwwwwwwk', '.kkwkkkk.', '..kk.....', '..k......', '.........'],
    day: ['....y....', '.y.....y.', '...yyy...', '..yyyyy..', 'y.yyyyy.y', '..yyyyy..', '...yyy...', '.y.....y.', '....y....'],
    night: ['...yyy..s', '..yy.....', '.yy......', '.yy...s..', '.yy......', '.yy......', '..yy.....', '...yyy...', '.........'],
    live: ['.........', '...yyy...', '..yyyyy..', '.yyyyyyy.', 'kkkkkkkkk', '.........', '..kkkkk..', '.........', '...kkk...'],
    play: ['..k......', '..kk.....', '..kgk....', '..kggk...', '..kgggk..', '..kggk...', '..kgk....', '..kk.....', '..k......'],
    pause: ['.........', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.kk...kk.', '.........'],
    help: ['..kkkkk..', '.kk...kk.', '......kk.', '....kkk..', '...kk....', '...kk....', '.........', '...kk....', '.........'],
    spring: ['.........', '.gg...gg.', '.ggg.ggg.', '..gg.gg..', '....g....', '....g....', '....g....', '..kkkkk..', '.........'],
    autumn: ['......oo.', '....oooo.', '..ooooo..', '.ooooo...', '.oooo....', '.ooo.....', '.k.......', 'k........', '.........'],
    list: ['.........', 'kk.kkkkkk', '.........', 'kk.kkkkkk', '.........', 'kk.kkkkkk', '.........', '.........', '.........'],
    world: ['..kkkkk..', '.kbbgbbk.', 'kbgggbbbk', 'kbbggbgbk', 'kbbbbbggk', 'kgbbbbbbk', 'kggbbgbbk', '.kbbgbbk.', '..kkkkk..'],
    plus: ['....k....', '....k....', '....k....', 'kkkkkkkkk', '....k....', '....k....', '....k....', '.........', '.........'],
    gear: ['....k....', '.k.kkk.k.', '..kkkkk..', '.kkk.kkk.', 'kkk...kkk', '.kkk.kkk.', '..kkkkk..', '.k.kkk.k.', '....k....'],
    side: ['kkkkkkkkk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'k...kyyyk', 'kkkkkkkkk', '.........', '.........'],
    bell: ['....k....', '...kyk...', '..kyyyk..', '..kyyyk..', '..kyyyk..', '.kyyyyyk.', 'kkkkkkkkk', '...kyk...', '....k....'],
    winter: ['....b....', '.b..b..b.', '..b.b.b..', '...bbb...', 'bbbbbbbbb', '...bbb...', '..b.b.b..', '.b..b..b.', '....b....'],
    animals: ['.k.k.k...', '.k.k.k...', '.........', 'k.kkk.k..', '.kkkkk...', '.kkkkk...', '..kkk....', '.........', '.........'],
    menu: ['.........', 'kkkkkkkkk', 'kkkkkkkkk', '.........', 'kkkkkkkkk', 'kkkkkkkkk', '.........', 'kkkkkkkkk', 'kkkkkkkkk'],
    broadcast: ['.......k.', '.....kkk.', 'k..kkyyk.', 'kkkyyyyk.', 'kkyyyyyk.', 'kkkyyyyk.', 'k..kkyyk.', '....k.kk.', '....kk...'],
  };
  const ICON_PAL = { k: '#4e3626', w: '#ffffff', y: '#f0b429', s: '#f4ecd8', r: '#e04a3a', g: '#3f9b3a', o: '#c8681a', b: '#a9dcf7' };
  const iconUrls = new Map();
  /** HTML for one of the farm's pixel icons (none without a DOM). */
  function iconImg(name) {
    if (typeof document === 'undefined' || !ICONS[name]) return '';
    if (!iconUrls.has(name)) iconUrls.set(name, uiSprite(ICONS[name], ICON_PAL).toDataURL());
    return `<i class="px-ico" aria-hidden="true" style="background-image:url(${iconUrls.get(name)})"></i>`;
  }

const SEASON_DEFAULTS = { switch: 'Season', spring: 'spring', summer: 'summer', autumn: 'autumn', winter: 'winter' }; // a world's seasonNames, unless it gives its own
/**
 * The HUD a world gets unless it draws its own: a Menu at the top right holding the dashboard's buttons,
 * then the sky (and the season, in a world with seasons), motion, animals, help and zoom.
 */
function defaultHud({ zoom = 1, skyMode = 'live', seasonMode = 'live', seasons = false, still = false, nav = {}, animals = null, menuOpen = false, seasonNames = SEASON_DEFAULTS }) {
  const btn = (attr, label, title, pressed) => `<button type="button" ${attr} title="${uiEsc(title)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${pxImg(label, '#4e3626', null)}<span class="px-sr">${uiEsc(label)}</span></button>`;
  return `<div class="px-nav">${btn(`data-farm-menu aria-expanded="${menuOpen}"`, 'Menu', "The dashboard's buttons, the switches and zoom")}
    <div class="px-menu" role="group" aria-label="Menu"${menuOpen ? '' : ' hidden'}>
      <div class="px-menu-grid">${btn('data-farm-nav="list"', 'List', 'The list of agents')}${btn('data-farm-nav="worlds"', 'World', 'Choose a world')}${btn('data-farm-nav="side"', 'Sidebar', 'The selected agent beside the map', Boolean(nav.side))}${btn('data-farm-nav="broadcast"', 'Broadcast', 'Message several agents at once')}</div>
      ${btn('data-farm-sky', `Sky: ${skyMode}`, 'Live follows your clock; or day, or night')}${seasons ? btn('data-farm-season', `${seasonNames.switch}: ${seasonMode === 'live' ? 'live' : seasonNames[seasonMode]}`, `Live follows this world's own seasons; or hold one: ${seasonNames.spring}, ${seasonNames.summer}, ${seasonNames.autumn} or ${seasonNames.winter}`) : ''}${btn('data-farm-motion', `Motion: ${still ? 'off' : 'on'}`, 'Walking and animation')}${animals === null ? '' : btn('data-farm-animals', `Animals: ${animals ? 'on' : 'off'}`, 'Animals that live here, just for fun: click one to pet or feed it', animals)}${btn('data-farm-help', 'Help', 'How to read this world')}
      <span class="px-zoombar">${btn('data-farm-zoom="-1"', '-', 'Zoom out')}${btn('data-farm-zoom="0"', `${Math.round(zoom * 100)}%`, 'The whole world')}${btn('data-farm-zoom="1"', '+', 'Zoom in')}</span>
    </div></div>`;
}

/**
 * Shared panel/Menu. Pass HUD state plus scene, season and icon/tooltip helpers; `words` overrides
 * the world's nouns, colours and tooltips (docs/worlds-legacy.md, "panelHud"). The engine owns
 * `menuOpen` and reads the buttons' data-farm-* attributes.
 */
function panelHud({ still, zoom = 1, saysOn = true, skyMode = 'live', seasonMode = 'live', seasons = true, seasonNames, follow = false, canFollow = false, restingHidden = null, bell = false, awake = false, nav = {}, panelOpen = true, animals = null, menuOpen = false,
  scene = { farmers: [] }, season = 'summer', iconImg = window.Agentville.iconImg, seasonIcon = s => s, seasonTip = () => '' }, words = {}) {
  const names = { ...SEASON_DEFAULTS, ...seasonNames }, named = s => (Object.hasOwn(names, s) ? names[s] : s);
  // Bound custom wording and fall back for invalid nouns.
  const given = words && typeof words === 'object' && !Array.isArray(words) ? words : {};
  const noun = (v, plain) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : plain);
  const place = noun(given.place, 'world'), agent = noun(given.agent, 'agent'), agents = noun(given.agents, 'agents');
  words = {
    costTip: `What the sessions in the ${place} have cost so far (from the mod)`, costIcon: 'coin',
    compactedWord: 'compacted', compactedTip: "Each time a session's conversation was compacted", compactedIcon: 'basket',
    textColor: '#fff3d6', shadowColor: '#2a1d14', dimColor: '#c9b48a', labelColor: '#a9c79a', brandColor: '#ffe8a3', toolColor: '#4e3626', toolStateColor: '#8b5a2b',
    sideTip: `Show the selected ${agent}'s answer box, activity and files beside the ${place}`,
    followTip: `Keep the ${agent} you picked in the middle of the view (zooms in); dragging the view turns it off`,
    followFirstTip: `Pick one of the ${agents} first, then Follow keeps it in view`,
    restingTip: `Idle and stale ${agents}: show them, or hide them to keep the ${place} to the ${agents} at work`,
    bubblesTip: `Speech bubbles with what each ${agent} last said. × hides one; its 💬 shows it again`,
    animalsTip: `Animals in the ${place}, just for fun: click one to pet or feed it. They never stand for anything`,
    skyTip: 'The light: live follows your clock (dawn, day, dusk, night); or hold it at day or night',
    seasonSwitchTip: `${names.switch}: live follows your plan's 5-hour limit; or hold one: ${names.spring}, ${names.summer}, ${names.autumn} or ${names.winter}. The panel's 📌 shows your real 5-hour use meanwhile`,
    motionTip: `Walking and animation in the ${place}`,
    helpTip: `How to read the ${place}`,
    zoomTip: `Zoom the ${place} inside its frame (or ⌘/Ctrl + scroll, or pinch); drag to move around when zoomed in`,
    zoomAllTip: `Show the whole ${place}`,
    menuTip: `The dashboard's buttons, the ${place}'s switches, the bell, help and zoom`,
    menuHead: `IN THE ${String(place).toUpperCase()}`,
    ...Object.fromEntries(Object.entries(given).filter(([, v]) => typeof v === 'string').map(([k, v]) => [k, v.slice(0, 300)])),
  };
  // In an attribute: & < > " escaped, an apostrophe left as it is (the farm's tooltips have them).
  const attr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const brand = typeof window !== 'undefined' && window.Agentville?.svg ? window.Agentville.svg({ size: 18, cls: 'px-logo' }) : ''; // Agentville's mark (brand.js, loaded in the frame after the bridge)
  const need = scene.farmers.filter(a => a.state === 'waiting' || a.question).length;
  const spent = scene.farmers.reduce((t, a) => t + (a.cost ?? 0), 0), compacted = scene.farmers.reduce((t, a) => t + (a.compactions ?? 0), 0);
  const ch = scene.chrome ?? {}, c = ch.counts ?? {};
  const w = t => pxt(t, words.textColor, words.shadowColor), dim = t => pxt(t, words.dimColor, null), label = t => pxt(t, words.labelColor, null);
  const gb = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
  const bar = (ratio, tone) => `<span class="px-bar"><i class="${tone}" style="width:${Math.round(Math.max(0, Math.min(1, ratio)) * 100)}%"></i></span>`;
  const tone = r => (r >= 0.8 ? 'bad' : r >= 0.5 ? 'warn' : 'ok');
  const kpi = (state, glyph, cls, name, n, sub, hot, title) => `<button type="button" class="px-kpi${hot ? ' hot' : ''}"${state && n ? ` data-farm-state="${state}"` : ' disabled'} title="${uiEsc(title)}"><span class="px-kpi-ico ${cls}">${pxt(glyph, '#ffffff', null)}</span><span class="px-kpi-n">${w(String(n ?? 0))}</span><span class="px-kpi-l">${label(name)}${sub ? `<br>${dim(sub)}` : ''}</span></button>`;
  const ramRatio = ch.ram?.totalMb ? ch.ram.usedMb / ch.ram.totalMb : 0, cpuRatio = (ch.cpu?.used ?? 0) / ((ch.cpu?.cores || 1) * 100);
  const windows = scene.plan?.windows ?? [], win = kind => windows.find(x => x.kind === kind), pctOf = x => (x ? (x.reset ? 0 : Math.round(x.percentUsed)) : null);
  const five = pctOf(win('five_hour')), week = pctOf(win('seven_day')), accs = scene.accounts ?? [];
  const tool = (attrs, icon, name, state, title, disabled = false) => `<button type="button" ${attrs}${disabled ? ' disabled' : ''} title="${uiEsc(title)}">${iconImg(icon)}${pxImg(name, words.toolColor, null)}${state ? `<span class="px-mi-s">${pxImg(state, words.toolStateColor, null)}</span>` : ''}<span class="px-sr">${uiEsc(state ? `${name}: ${state}` : name)}</span></button>`;
  const head = text => `<div class="px-menu-h">${pxt(text, words.toolStateColor, null)}</div>`;
  const navBtn = (what, icon, name, title, pressed) => `<button type="button" data-farm-nav="${what}" title="${uiEsc(title)}"${pressed === undefined ? '' : ` aria-pressed="${pressed}"`}>${iconImg(icon)}${pxImg(name, words.toolColor, null)}<span class="px-sr">${uiEsc(name)}</span></button>`;
  return `<div class="px-stats${panelOpen ? '' : ' folded'}">
            <button type="button" class="px-brand" data-farm-panel title="${panelOpen ? 'Fold this panel away' : 'Show the counts and meters'}" aria-expanded="${panelOpen}">${brand}${pxt('AGENTVILLE', words.brandColor, words.shadowColor)}<i class="px-live${nav.live === false ? ' off' : ''}" title="${nav.live === false ? 'Disconnected from the collector: retrying' : 'Live'}"></i>${pxt(panelOpen ? '-' : '+', words.dimColor, null)}</button>
            <div class="px-line"><span title="${attr(words.costTip)}"><b class="${attr(words.costIcon)}"></b>${w(`$${spent.toFixed(2)}`)}</span><span title="${attr(words.compactedTip)}"><b class="${attr(words.compactedIcon)}"></b>${w(`${compacted} ${words.compactedWord}`)}</span>${seasons ? `<span class="px-season" title="${uiEsc(seasonTip(seasonMode))}">${seasonMode === 'live' ? `${iconImg(seasonIcon(season))}${w(named(season))}` : `${iconImg(seasonIcon(seasonMode))}${w(named(seasonMode))} 📌 ${dim(five !== null ? `· 5-hour ${five}%` : '· no 5-hour reading')}`}</span>` : ''}</div>
            <div class="px-kpis">
              ${kpi('waiting', '!', 'k-wait', 'waiting on you', c.waiting, c.waiting ? `oldest ${uiAgo(ch.oldestWaiting ?? Date.now())}` : 'all clear', c.waiting > 0, 'Agents waiting on you (a question or a permission): click for the first')}
              ${kpi('working', '>', 'k-work', 'working', c.working, ch.subagentsRunning ? `${ch.subagentsRunning} with subagents` : `${ch.agents ?? 0} agents tracked`, false, 'Agents at work: click for the first')}
              ${kpi('turn', '<', 'k-turn', 'your turn', c.yourTurn, `${ch.asking ? `${ch.asking} ask you · ` : ''}${c.idle ?? 0} idle · ${c.stale ?? 0} stale`, ch.asking > 0, "Agents whose turn ended: it's yours. Click for the first")}
              ${kpi(null, '⚠', 'k-collide', 'collisions', c.collisions, c.collisions ? 'two in one repo' : 'none', c.collisions > 0, 'Two agents writing one repo')}
            </div>
            <div class="px-gauges">
              <span class="px-gauge" title="Memory used by the agents, of this computer's">${label('RAM')}${bar(ramRatio, tone(ramRatio))}${w(gb(ch.ram?.usedMb ?? 0))}${ch.ram?.totalMb ? dim(`of ${gb(ch.ram.totalMb)}`) : ''}</span>
              <span class="px-gauge" title="${uiEsc(`CPU used by the agents: ${Math.round(ch.cpu?.used ?? 0)}% of one core, ${ch.cpu?.cores ?? 1} cores`)}">${label('CPU')}${bar(cpuRatio, tone(cpuRatio))}${w(`${Math.round(cpuRatio * 100)}%`)}${dim('of this Mac')}</span>
              ${accs.length > 1 ? accs.map((a, i) => { // with two or more Claude accounts: each one's week, and its 5 hours beside it; one with no name is "account N", as the private scene names it
                const ws = a.plan?.windows ?? [], f5 = pctOf(ws.find(x => x.kind === 'five_hour')), wk = pctOf(ws.find(x => x.kind === 'seven_day')), name = typeof a.name === 'string' && a.name ? a.name : `account ${i + 1}`;
                const num = /^account (\d+)$/.exec(name)?.[1]; // a numbered one (the private scene's) reads ACC N: cut to six letters, two would both be ACCOUN
                return `<span class="px-gauge" title="${uiEsc(`Your ${num ? `account ${num}` : `${name} account`}: ${wk === null ? 'no weekly reading' : `${wk}% of its week`}, ${f5 === null ? 'no 5-hour reading' : `${f5}% of its 5 hours`} (from the mod)`)}">${label(num ? `ACC ${num}` : name.toUpperCase().slice(0, 6))}${bar((wk ?? 0) / 100, tone((wk ?? 0) / 100))}${w(wk === null ? '–' : `${wk}%`)}${dim(`week · 5h ${f5 === null ? '–' : `${f5}%`}`)}</span>`;
              }).join('') : `${five !== null ? `<span class="px-gauge" title="Your plan's 5-hour limit (from the mod)">${label('5H')}${bar(five / 100, tone(five / 100))}${w(`${five}%`)}${dim('5-hour limit')}</span>` : ''}
              ${week !== null ? `<span class="px-gauge" title="Your plan's weekly limit (from the mod)">${label('WEEK')}${bar(week / 100, tone(week / 100))}${w(`${week}%`)}${dim('this week')}</span>` : ''}`}
              ${ch.collector ? `<span class="px-gauge" title="The tracker itself">${dim(`tracker ${ch.collector.cpu ?? 0}% CPU · ${ch.collector.rssMb ?? 0} MB`)}</span>` : ''}
            </div>
            ${(ch.errors ?? []).map(e => `<div class="px-err">⚠ ${uiEsc(e)}</div>`).join('')}
            ${need ? `<button type="button" class="px-need" data-farm-need title="Open the first agent that needs you">${pxt(`${need} need${need > 1 ? '' : 's'} you`, '#ffffff', '#5a1f19')}</button>` : ''}
          </div>
          <div class="px-nav">
            <button type="button" data-farm-menu aria-expanded="${menuOpen}" title="${attr(words.menuTip)}">${iconImg('menu')}${pxImg('MENU', words.toolColor, null)}<span class="px-sr">Menu</span></button>
            <div class="px-menu" role="group" aria-label="Menu"${menuOpen ? '' : ' hidden'}>
              ${head('DASHBOARD')}
              <div class="px-menu-grid">
                ${navBtn('list', 'list', 'LIST', 'Back to the list view')}
                ${navBtn('worlds', 'world', 'WORLD', 'Choose a world')}
                ${navBtn('session', 'plus', 'SESSION', 'Start a new Claude Code session in a folder, or resume a past one')}
                ${navBtn('setup', 'gear', 'CLAUDE CODE', 'Your Claude Code setup: plugins and skills (and what each costs in context), MCP servers, permission rules')}
                ${navBtn('side', 'side', 'SIDEBAR', words.sideTip, Boolean(nav.side))}
                ${navBtn('broadcast', 'broadcast', 'BROADCAST', 'Message several agents at once: all of them, or the ones you pick')}
                ${navBtn('theme', nav.theme === 'light' ? 'day' : nav.theme === 'auto' ? 'live' : 'night', String(nav.theme ?? 'dark').toUpperCase(), 'Theme: dark, light, or auto (as macOS is): click to change')}
              </div>
              ${head(words.menuHead)}
              ${tool('data-farm-follow', 'follow', 'Follow', follow ? 'on' : 'off', canFollow ? words.followTip : words.followFirstTip, !canFollow)}
              ${tool('data-farm-resting', 'resting', 'Resting', restingHidden === null ? 'shown' : `hidden (${restingHidden})`, words.restingTip)}
              ${tool('data-farm-bubbles', 'bubbles', 'Bubbles', saysOn ? 'on' : 'off', words.bubblesTip)}
              ${animals === null ? '' : tool('data-farm-animals', 'animals', 'Animals', animals ? 'on' : 'off', words.animalsTip)}
              ${tool('data-farm-sky', skyMode, 'Sky', skyMode, words.skyTip)}
              ${seasons ? tool('data-farm-season', seasonIcon(seasonMode === 'live' ? season : seasonMode), names.switch, seasonMode === 'live' ? 'live' : named(seasonMode), words.seasonSwitchTip) : ''}
              ${tool('class="px-motion" data-farm-motion', still ? 'pause' : 'play', 'Motion', still ? 'off' : 'on', words.motionTip)}
              <div class="px-menu-sep"></div>
              ${tool('data-farm-bell', 'bell', 'Bell', bell ? 'on' : 'off', 'A chime, and a desktop notice when the page is in the background, whenever an agent starts waiting on you (in the list view too)')}
              ${tool('data-farm-awake', 'day', 'Screen', awake ? 'stays on' : 'may sleep', 'Keep this screen on while the dashboard is open. Needs HTTPS or localhost')}
              ${tool(`class="px-info" data-farm-help aria-label="${attr(words.helpTip)}"`, 'help', 'Help', '', words.helpTip)}
              <div class="px-menu-zoom">${pxt('ZOOM', words.toolStateColor, null)}<span class="px-zoombar" title="${attr(words.zoomTip)}"><button type="button" data-farm-zoom="-1" aria-label="Zoom out">${pxt('-', words.toolColor, null)}</button><button type="button" data-farm-zoom="0" title="${attr(words.zoomAllTip)}">${pxt(`${Math.round(zoom * 100)}%`, words.toolColor, null)}</button><button type="button" data-farm-zoom="1" aria-label="Zoom in">${pxt('+', words.toolColor, null)}</button></span></div>
            </div>
          </div>`;
}


window.Agentville.panelHud = panelHud;
window.Agentville.iconImg = iconImg;
