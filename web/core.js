// The dashboard's shared state and helpers: escaping, times, sizes, agent colours, the
// collapsible groups and the ticking timers.
const GROUPS = [['waiting', 'Waiting on you'], ['working', 'Working'], ['yourTurn', 'Your turn'], ['idle', 'Idle'], ['stale', 'Stale · 24h+ quiet']];
const STATE_CHIP = { waiting: '❓ Waiting on you', working: '▶ Working', yourTurn: '↩ Your turn', stale: '◌ Stale', idle: '◌ Idle' };
let snap = null;
const drafts = new Map(); // toolUseId → { picks: Map<question index, Set<label>>, other: Map<question index, text> }
const msgDrafts = new Map(); // agent id → half-typed chat message
const asideDrafts = new Map(); // agent id → half-typed side question
const msgStatus = new Map(); // agent id → { text, bad, at }: the last send's result, shown under the box
const fullFeeds = new Map(); // agent id → { items, at }: the whole history, while Show all is on
const msgFiles = new Map(); // agent id → files waiting to go with the next message: [{ file, url, name, size }] (url: a picture's thumbnail)
let pickerFor = null; // the agent the file picker is choosing files for
const IMAGE_TYPES = /^image\/(png|jpeg|gif|webp)$/; // pictures the message box shows as thumbnails
const MAX_FILES = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
let selected = null; // the agent in the centre: the one you clicked, else the first one at work, then kept
const openChildren = new Map();
const tabs = new Map(); // agent id → { files: [absolute paths], active: a path, or '' for the agent itself }
let shownKey = ''; // which agent and tab the centre body holds, so an open file isn't redrawn on every snapshot
let viewerLoading = Promise.resolve();
// Collapsible groups (left column and explorer). Idle and stale start closed; what you close or
// open is remembered. Saving the closed ones means a group added later starts open.
const closedGroups = loadClosed();
const isOpen = key => !closedGroups.has(key);
function loadClosed() {
  try {
    const saved = JSON.parse(localStorage.getItem('tracker-closed-groups'));
    if (Array.isArray(saved)) return new Set(saved);
  } catch { /* nothing saved yet, or storage blocked */ }
  return new Set(['idle', 'stale']);
}
function toggleGroup(key) {
  if (closedGroups.has(key)) closedGroups.delete(key);
  else closedGroups.add(key);
  try { localStorage.setItem('tracker-closed-groups', JSON.stringify([...closedGroups])); } catch { /* lasts this page only */ }
  render();
  if (key.startsWith('ex-')) renderTree();
}
const groupHead = (key, title, count, extra = '') => {
  const open = isOpen(key);
  return `<div class="grp-row"><button class="grp" type="button" data-group="${key}" aria-expanded="${open}"><span class="tw">${open ? '▾' : '▸'}</span>${title}${count === '' ? '' : `<span class="grp-n">${count}</span>`}</button>${extra}</div>`;
};

const $ = id => document.getElementById(id);

/** How to find again the element the keyboard is on, once it has been written anew: by its id, else by its tag and data attributes among its like under the nearest element with an id. Null when it can't be told apart. */
function focusMark(el) {
  if (!el?.isConnected || el === document.body) return null;
  let caret = null;
  try { if (el.matches('input, textarea') && el.selectionStart != null) caret = [el.selectionStart, el.selectionEnd, el.selectionDirection, el.scrollTop]; } catch { /* a field with no selection */ }
  if (el.id) return { find: () => document.getElementById(el.id), caret };
  const home = el.parentElement?.closest('[id]');
  const like = el.tagName.toLowerCase() + [...el.attributes].filter(a => a.name.startsWith('data-') && a.name !== 'data-tip').map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join('');
  if (!home || like === el.tagName.toLowerCase()) return null;
  const nth = [...home.querySelectorAll(like)].indexOf(el);
  return { find: () => document.getElementById(home.id)?.querySelectorAll(like)[nth] ?? null, caret };
}
/**
 * Runs `draw`, which writes parts of the page anew, and leaves the keyboard where it was. Writing an element anew
 * takes the keyboard from it, and the page is written anew every few seconds: without this, a button you had
 * tabbed to, or a box you were typing in when something else finished, would lose it. A draw that moves the
 * keyboard itself, or takes it away on purpose before it starts, has its way.
 */
function keepFocus(draw) {
  const was = document.activeElement, mark = focusMark(was);
  draw();
  if (!mark || was.isConnected || (document.activeElement && document.activeElement !== document.body)) return;
  const el = mark.find();
  if (!el || el.disabled) return;
  el.focus({ preventScroll: true });
  if (mark.caret) { try { el.setSelectionRange(mark.caret[0], mark.caret[1], mark.caret[2]); el.scrollTop = mark.caret[3]; } catch { /* its text is shorter now */ } }
}
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clock = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hhmm = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const ago = ms => (!ms ? '' : Date.now() - ms < 86_400_000 ? clock(ms) : new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }));
const gb = mb => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`);
// What the page calls the computer the collector runs on and its file manager: by the system the snapshot names
// (machine.platform; a snapshot from before it had one is a Mac's).
const hostPlatform = () => snap?.machine?.platform ?? 'darwin';
const hostName = () => (hostPlatform() === 'darwin' ? 'this Mac' : 'this computer');
const filesApp = () => ({ darwin: 'Finder', win32: 'Explorer' }[hostPlatform()] ?? 'the file manager');
// A path with your home folder as ~, wherever this system keeps homes (/Users/you, /home/you, C:\Users\you).
const short = p => String(p ?? '').replace(/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~');
const shellQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;
// The line that resumes a session, in the host's own shell syntax.
const psQuote = s => `'${String(s).replace(/['\u2018\u2019\u201a\u201b]/g, '$&$&')}'`;
const resumeLine = a => (hostPlatform() === 'win32' ? `Set-Location -LiteralPath ${psQuote(a.cwd)}; claude --resume ${a.id}` : `cd ${shellQuote(a.cwd)} && claude --resume ${a.id}`);

function elapsed(from) {
  const s = Math.max(0, Math.floor((Date.now() - from) / 1000));
  const m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
}

// Colour follows the agent, never its rank or screen order: each agent's preferred slot comes
// from a hash of its id, new agents are placed in id order, and an agent keeps its slot while it
// is on screen (freed when it goes away). So a reload shows the same colours. Past eight, grey.
const agentSlots = new Map();
const preferredSlot = id => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (h % 8) + 1;
};
function syncSlots(agents) {
  const live = new Set(agents.map(a => a.id));
  for (const id of [...agentSlots.keys()]) if (!live.has(id)) agentSlots.delete(id);
  const fresh = agents.map(a => a.id).filter(id => !agentSlots.has(id)).sort();
  for (const id of fresh) {
    const used = new Set(agentSlots.values());
    let slot = 'other';
    for (let k = 0; k < 8; k++) {
      const candidate = ((preferredSlot(id) - 1 + k) % 8) + 1;
      if (!used.has(candidate)) { slot = candidate; break; }
    }
    agentSlots.set(id, slot);
  }
}
const colorOf = id => (agentSlots.get(id) === 'other' || !agentSlots.has(id) ? 'var(--s-other)' : `var(--s${agentSlots.get(id)})`);

/** A length of time, as Claude Code's working line says it: 12s, 5m 31s, 1h 4m. */
function took(ms) {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : m ? `${m}m ${s % 60}s` : `${s}s`;
}
/** How long since, in the same words. */
function lasted(from) {
  return took(Date.now() - from);
}

function updateTimers() {
  for (const el of document.querySelectorAll('[data-since]')) el.textContent = elapsed(Number(el.dataset.since));
  for (const el of document.querySelectorAll('[data-lasted]')) el.textContent = lasted(Number(el.dataset.lasted));
  for (const el of document.querySelectorAll('[data-until]')) el.textContent = `${Math.max(0, Math.ceil((Number(el.dataset.until) - Date.now()) / 1000))}s`;
  if (snap) {
    const age = Math.max(0, Math.round((Date.now() - snap.generatedAt) / 1000));
    $('meta').textContent = $('meta').title = `tracker ${snap.collector.cpu}% CPU · ${snap.collector.rssMb} MB · updated ${age}s ago`; // the title shows it whole when the header cuts it
  }
}
