// The ⚙ Settings window: everything config.json holds, shown and saved here, so the file is never edited by
// hand. The collector says what the settings are (collector/settings.mjs: their kinds, limits and words) and
// checks what is saved; this page only draws them. It is this computer's alone: a guest has no token, is
// not shown the button, and the collector refuses them the settings either way.
let settingsData = null; // { fields, platform, dataDir, addresses, canRestart }
let settingsErrors = {}, settingsNote = null; // by key; { text, bad }
let settingsRead = 0, settingsSaving = false; // the newest reading asked for; a save under way

/** What a field shows: what was typed and not saved (a save that was refused), else what is in force. */
const stNow = f => (Object.hasOwn(f, 'typed') ? f.typed : f.value);
const stShown = f => { const v = stNow(f); return v === null || v === undefined ? '' : f.scale ? v / f.scale : v; };
const stId = key => `st-${key.replace(/\W/g, '-')}`;

/** Opens the window and reads the settings. `keep`: read again behind what shows (after a save), without emptying it first. */
async function openSettings({ keep = false } = {}) {
  if (!keep) { settingsErrors = {}; settingsNote = null; settingsData = null; }
  if (!$('settings').open) $('settings').showModal();
  if (!keep) renderSettings();
  const mine = ++settingsRead;
  let got;
  try {
    const r = await fetch('/api/config', { headers: { 'x-tracker-token': TOKEN } });
    got = r.ok ? await r.json() : { error: `HTTP ${r.status}.` };
  } catch (err) {
    got = { error: String(err) };
  }
  if (mine !== settingsRead || settingsSaving) return; // read again since, or a save is on its way: that one's answer is the newer
  settingsData = got;
  renderSettings();
}

function stControl(f) {
  const id = stId(f.key), tip = f.help ? ` aria-describedby="${id}-help"` : '';
  if (f.kind === 'bool') return `<label class="st-switch"><input type="checkbox" id="${id}" data-st="${esc(f.key)}"${stNow(f) ? ' checked' : ''}${tip}> <span>${stNow(f) ? 'On' : 'Off'}</span></label>`;
  if (f.kind === 'int' || f.kind === 'number') {
    const scale = f.scale ?? 1;
    return `<span class="st-num"><input type="number" id="${id}" data-st="${esc(f.key)}" value="${esc(stShown(f))}" min="${f.min / scale}" max="${f.max / scale}" step="${f.kind === 'int' && scale === 1 ? 1 : 'any'}"${tip}>${f.unit ? ` <span class="muted">${esc(f.unit)}</span>` : ''}</span>`;
  }
  if (f.kind === 'choice') return `<select id="${id}" data-st="${esc(f.key)}"${tip}>${f.choices.map(c => `<option value="${esc(c)}"${c === (stNow(f) ?? 'auto') ? ' selected' : ''}>${c === 'auto' ? `Automatic${f.choices[1] ? ` (${esc(f.choices[1])})` : ''}` : esc(c)}</option>`).join('')}</select>`;
  if (f.kind === 'text') return `<input type="text" id="${id}" data-st="${esc(f.key)}" value="${esc(stShown(f))}" placeholder="${f.key === 'claudeBin' ? 'automatic' : f.key === 'worldsDir' ? '~/.agentville/worlds' : ''}" spellcheck="false" autocomplete="off"${tip}>`;
  if (f.kind === 'list') return `<input type="text" id="${id}" data-st="${esc(f.key)}" value="${esc((stNow(f) ?? []).join(', '))}" placeholder="192.168.1.20, 192.168.1.0/24" spellcheck="false" autocomplete="off"${tip}>`;
  // A password is never sent to the page: it shows only whether one is set. Typing sets a new one; the box removes it.
  if (f.kind === 'secret') return `<input type="password" id="${id}" data-st="${esc(f.key)}" placeholder="${f.value ? 'Set. Enter a new one to change it' : 'Not set'}" autocomplete="new-password"${tip}>${f.value ? `<label class="st-switch"><input type="checkbox" id="${id}-clear"> <span>Remove</span></label>` : ''}`;
  if (f.kind === 'map') {
    const rows = Object.entries(stNow(f) ?? {});
    const row = (k, v) => `<div class="st-pair"><input type="text" data-st-k value="${esc(k)}" placeholder="folder" spellcheck="false" autocomplete="off" aria-label="Folder"><input type="text" data-st-v value="${esc(v)}" placeholder="${esc(f.valueLabel)}" spellcheck="false" autocomplete="off" aria-label="${esc(f.valueLabel)}"><button type="button" class="act mini" data-st-del aria-label="Remove">×</button></div>`;
    return `<div class="st-map" id="${id}" data-st="${esc(f.key)}" data-st-map>${rows.map(([k, v]) => row(k, v)).join('')}<button type="button" class="act mini" data-st-add data-label="${esc(f.valueLabel)}">＋ Add</button></div>`;
  }
  return '';
}

function renderSettings() {
  const body = $('settings-body'), d = settingsData;
  $('settings-note').innerHTML = settingsNote ? `<span class="${settingsNote.bad ? 'bad' : 'good'}">${esc(settingsNote.text)}</span>` : '';
  if (!d) { body.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (d.error) { body.innerHTML = `<div class="empty">Could not load settings. ${esc(d.error)}</div>`; return; }
  const groups = [];
  for (const f of d.fields) (groups.find(g => g.name === f.group) ?? groups[groups.push({ name: f.group, fields: [] }) - 1]).fields.push(f);
  const shared = d.fields.find(f => f.key === 'lan')?.value;
  body.innerHTML = `${d.configError ? `<div class="st-warn">config.json is unreadable (${esc(d.configError)}). Defaults apply until you save.</div>` : ''}${groups.map(g => `<section class="st-group"><h4>${esc(g.name)}</h4>${g.fields.map(f => `
      <div class="st-row${settingsErrors[f.key] ? ' bad' : ''}">
        <div class="st-label"><label for="${stId(f.key)}">${esc(f.label)}${f.restart ? ' <span class="faint" data-tip="Restarts the collector">↻</span>' : ''}</label>${f.help ? `<div class="st-help muted" id="${stId(f.key)}-help">${esc(f.help)}</div>` : ''}</div>
        <div class="st-ctl">${settingsErrors[f.key] ? `<div class="st-err">${esc(settingsErrors[f.key])}</div>` : ''}${stControl(f)}</div>
      </div>`).join('')}${g.name === 'Network' ? `<div class="st-row"><span class="st-label">${shared ? 'Addresses' : 'Address'}</span><div class="st-ctl">${d.addresses.map(a => `<div><a href="${esc(a)}">${esc(a)}</a></div>`).join('')}</div></div>` : ''}</section>`).join('')}`;
  stSyncNotify();
}

/** With system notifications off altogether, the switches for each kind are shown as they are, and can't be changed until it is on. */
function stSyncNotify() {
  const all = document.getElementById(stId('notifications'));
  if (!all) return;
  for (const f of settingsData?.fields ?? []) {
    if (!f.key.startsWith('notify.')) continue;
    const el = document.getElementById(stId(f.key));
    if (el) { el.disabled = !all.checked; el.closest?.('.st-row')?.classList.toggle('off', !all.checked); }
  }
}

/** What the window shows now, as the collector takes it: { key: value }, only what differs from what it sent. */
function settingsChanged() {
  const out = {};
  for (const f of settingsData.fields) {
    const el = document.getElementById(stId(f.key));
    if (!el) continue;
    let value;
    if (f.kind === 'bool') value = el.checked;
    else if (f.kind === 'int' || f.kind === 'number') { value = el.value.trim() === '' ? NaN : Number(el.value) * (f.scale ?? 1); if (f.kind === 'int') value = Math.round(value); }
    else if (f.kind === 'choice') value = el.value;
    else if (f.kind === 'text') value = el.value.trim() || null;
    else if (f.kind === 'list') value = el.value.split(/[\s,;]+/).filter(Boolean);
    else if (f.kind === 'secret') { // only when something is asked for: a new password, or its removal
      if (document.getElementById(`${stId(f.key)}-clear`)?.checked) out[f.key] = null; else if (el.value) out[f.key] = el.value;
      continue;
    }
    else if (f.kind === 'map') { value = {}; for (const pair of el.querySelectorAll('.st-pair')) { const k = pair.querySelector('[data-st-k]').value.trim(), v = pair.querySelector('[data-st-v]').value.trim(); if (k || v) value[k] = v; } }
    const was = f.kind === 'choice' ? f.value ?? 'auto' : f.kind === 'map' ? f.value ?? {} : f.kind === 'list' ? f.value ?? [] : f.value ?? null;
    if (JSON.stringify(value) !== JSON.stringify(was) && !(Number.isNaN(value) && was === null)) out[f.key] = Number.isNaN(value) ? null : value;
  }
  return out;
}

async function saveSettings() {
  if (!settingsData?.fields) return;
  const values = settingsChanged();
  if (!Object.keys(values).length) { settingsNote = { text: 'No changes.' }; renderSettings(); return; }
  $('settings-save').disabled = settingsSaving = true;
  const r = await post('/api/actions/config', { values });
  $('settings-save').disabled = settingsSaving = false;
  if (!r.ok) {
    settingsErrors = r.errors ?? {};
    settingsNote = { text: r.error ?? 'Not saved. Check the marked fields.', bad: true };
    for (const f of settingsData.fields) if (Object.hasOwn(values, f.key) && f.kind !== 'secret') f.typed = values[f.key]; // what was typed stays in the window (never a password)
    renderSettings();
    return;
  }
  settingsErrors = {};
  if (r.restart) { // the collector starts again: this page goes to where it is now (another port, perhaps)
    const next = new URL(r.addresses?.[0] ?? location.origin);
    next.hostname = location.hostname; // as this page was opened (localhost or 127.0.0.1)
    settingsNote = { text: `Saved. Restarting, this page reloads at ${next.origin}.` };
    renderSettings();
    setTimeout(() => { location.href = next.origin; }, 2500);
    return;
  }
  // What was saved is what is in force, at once: a change made straight after is measured against it.
  for (const f of settingsData.fields) { delete f.typed; if (Object.hasOwn(values, f.key)) f.value = f.kind === 'secret' ? values[f.key] !== null : values[f.key]; }
  settingsNote = { text: 'Saved.' };
  renderSettings();
  await openSettings({ keep: true }); // and as the collector has it now
}

document.addEventListener('click', e => {
  const b = e.target.closest?.('button');
  if (!b) return;
  if (b.id === 'settings-open') return void openSettings();
  if (b.dataset.settingsClose !== undefined) return $('settings').close();
  if (b.id === 'settings-save') return void saveSettings();
  if (b.dataset.stDel !== undefined) return b.closest('.st-pair').remove();
  if (b.dataset.stAdd !== undefined) {
    b.insertAdjacentHTML('beforebegin', `<div class="st-pair"><input type="text" data-st-k placeholder="folder" spellcheck="false" autocomplete="off" aria-label="Folder"><input type="text" data-st-v placeholder="${esc(b.dataset.label)}" spellcheck="false" autocomplete="off" aria-label="${esc(b.dataset.label)}"><button type="button" class="act mini" data-st-del aria-label="Remove">×</button></div>`);
    b.previousElementSibling.querySelector('input').focus();
  }
});
document.addEventListener('change', e => {
  const box = e.target.closest?.('.st-switch input');
  if (box && !box.id.endsWith('-clear')) box.nextElementSibling.textContent = box.checked ? 'On' : 'Off';
  if (box?.id === stId('notifications')) stSyncNotify();
});
// A guest has no token, so no settings: the button is this computer's alone.
if (!TOKEN) $('settings-open').hidden = true;
