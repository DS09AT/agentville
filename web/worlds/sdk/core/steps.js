// What an agent is doing, for every world alike: each kind of step the collector reads from a tool call has a
// glyph (shown over the agent) and a verb (its tooltip). A world changes the ones it likes in world.json's
// "steps", and may give a step a model to hold. No DOM and no three.js.

export const STEPS = {
  edit: { glyph: '✏️', verb: 'editing' },
  write: { glyph: '📄', verb: 'writing a new file' },
  read: { glyph: '📖', verb: 'reading' },
  search: { glyph: '🔍', verb: 'searching' },
  web: { glyph: '🌐', verb: 'on the web' },
  mcp: { glyph: '🔌', verb: 'using a connector' },
  skill: { glyph: '📜', verb: 'following a skill' },
  test: { glyph: '🧪', verb: 'running the tests' },
  lint: { glyph: '🧹', verb: 'tidying up' },
  build: { glyph: '🔨', verb: 'building' },
  install: { glyph: '📦', verb: 'installing' },
  commit: { glyph: '🔖', verb: 'committing' },
  push: { glyph: '⬆️', verb: 'pushing' },
  deploy: { glyph: '🚀', verb: 'deploying' },
  pull: { glyph: '⬇️', verb: 'pulling' },
  serve: { glyph: '🖥️', verb: 'keeping a server running' },
  delete: { glyph: '🗑️', verb: 'deleting' },
  agent: { glyph: '📣', verb: 'calling helpers' },
  plan: { glyph: '📋', verb: 'planning' },
  ask: { glyph: '❓', verb: 'asking you something' },
  shell: { glyph: '⌨️', verb: 'running a command' },
  other: { glyph: '🔧', verb: 'working' },
  planMode: { glyph: '📐', verb: 'drawing up plans (plan mode)' },
};
export const STEP_NAMES = Object.keys(STEPS);
// A tool call the collector gave no step for (an older one): its step, by the tool's name.
const BY_TOOL = { Edit: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit', Write: 'write', Read: 'read', Grep: 'search', Glob: 'search', WebSearch: 'web', WebFetch: 'web', Bash: 'shell' };

/** The step an agent is at now: its name, or null between steps. In plan mode, while it works: planMode. */
export function stepOf(agent) {
  if (agent.mode === 'plan' && agent.state === 'working') return 'planMode';
  if (!agent.step && !agent.tool) return null;
  return Object.hasOwn(STEPS, agent.step) ? agent.step : BY_TOOL[agent.tool] ?? 'other';
}
