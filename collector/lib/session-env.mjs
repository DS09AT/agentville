// Variables that mark a process as a child of one session; a collector started inside a session must not pass them on.
const OF_A_SESSION = [
  'CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_BRIDGE_SESSION_ID', 'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SSE_PORT', 'CLAUDE_CODE_SHELL_LAUNCHER_SCRIPT',
];

export function dropSessionEnv(env = process.env) {
  const dropped = OF_A_SESSION.filter(name => Object.hasOwn(env, name));
  for (const name of dropped) delete env[name];
  return dropped;
}
