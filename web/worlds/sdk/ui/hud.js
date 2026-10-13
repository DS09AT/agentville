// Shared controls, with the SDK scene and actions adapted to the Farm's UI.
export function hudHtml(s) {
  const source = s.scene ?? { agents: [], chrome: {}, accounts: [] };
  const plan = p => p ? { windows: (p.windows ?? []).map(w => ({ ...w, percentUsed: w.pct })) } : null;
  let html = globalThis.Agentville.panelHud({
    ...s, seasons: false,
    scene: { ...source, farmers: source.agents, plan: plan(source.plan), accounts: (source.accounts ?? []).map(a => ({ ...a, plan: plan(a.plan) })) },
  }, s.nouns);
  html = html.replace(/data-farm-(nav|state|zoom)="([^"]*)"/g, (_, action, value) => `data-do="${action}:${value}"`)
    .replace(/data-farm-(panel|need|menu|follow|resting|bubbles|sky|motion|bell|awake|help)\b/g, (_, action) => `data-do="${action}"`);
  return s.own ? html.replace('class="px-stats', 'class="px-stats own') : html;
}
