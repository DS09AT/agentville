import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dropSessionEnv } from '../lib/session-env.mjs';

test("what marks one session as the parent of what it starts is not handed on; the rest of the environment is", () => {
  const env = { CLAUDECODE: '1', CLAUDE_CODE_CHILD_SESSION: '1', CLAUDE_CODE_SESSION_ID: 'abc', CLAUDE_CODE_MESSAGING_TOKEN: 'x', CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_PLUGIN_DIRS: '/m', PATH: '/bin', ANTHROPIC_API_KEY: 'k' };
  assert.deepEqual(dropSessionEnv(env).sort(), ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_SESSION_ID']);
  assert.deepEqual(env, { CLAUDE_CONFIG_DIR: '/c', CLAUDE_CODE_PLUGIN_DIRS: '/m', PATH: '/bin', ANTHROPIC_API_KEY: 'k' });
  assert.deepEqual(dropSessionEnv(env), [], 'nothing left to drop');
});
