// A small client for headless Chrome's DevTools protocol, for the scripts that look at the dashboard
// in a real browser: it starts Chrome, attaches to its one page, and runs code in that page or in one
// of its frames, including a sandboxed world's frame that Chrome runs in a process of its own.
// No dependencies.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Windows: Chrome in its installer locations, else Edge, which is Chromium and takes the same flags.
const WINDOWS_BROWSERS = ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].flatMap(v => (process.env[v] ? [join(process.env[v], 'Google', 'Chrome', 'Application', 'chrome.exe')] : []))
  .concat(['ProgramFiles(x86)', 'ProgramFiles'].flatMap(v => (process.env[v] ? [join(process.env[v], 'Microsoft', 'Edge', 'Application', 'msedge.exe')] : [])));
export const CHROME = process.env.CHROME ?? [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  ...(process.platform === 'win32' ? WINDOWS_BROWSERS : []),
].find(p => existsSync(p));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Starts headless Chrome on about:blank and attaches to its page. `prepare(send, sessionId)` runs for the
 * page, and again for each frame Chrome gives a process of its own, before any of that frame's scripts
 * run (a fixed clock, reduced motion…).
 */
export async function openChrome({ prepare = async () => {} } = {}) {
  if (!CHROME) throw new Error('Chrome not found: set CHROME to its path.');
  const profile = mkdtempSync(join(tmpdir(), 'agentville-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let port;
  for (let i = 0; i < 80 && !port; i++) {
    try { port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch { await sleep(250); }
  }
  if (!port) { chrome.kill(); throw new Error('Chrome did not start.'); }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let id = 0, page = null;
  const pending = new Map(), errors = [];
  const frames = new Map(); // sessionId → { targetId, url }: frames in a process of their own
  const contexts = new Map(); // frameId → its main world's context id, for frames in the page's process
  // A call to a frame that is detached or navigating is never answered: it settles as an error after `ms` (CALL_MS
  // unless the caller gives less) so a wait loop keeps checking its own deadline instead of hanging the whole run.
  // A caller that asks over and over gives a short `ms`: one lost call then costs it a moment, not its whole wait.
  const CALL_MS = 15_000;
  const raw = (method, params = {}, sessionId, ms = CALL_MS) => new Promise(r => {
    const n = ++id;
    const timer = setTimeout(() => { pending.delete(n); r({ error: { message: `${method}: no answer in ${ms} ms` } }); }, ms);
    const done = m => { clearTimeout(timer); r(m); };
    done.sessionId = sessionId;
    pending.set(n, done);
    ws.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const send = (method, params = {}, sessionId = page) => raw(method, params, sessionId);
  async function adopt(sessionId) { // the page or a frame: set it up, then let its scripts run
    await raw('Runtime.enable', {}, sessionId);
    await raw('Page.enable', {}, sessionId);
    await prepare(send, sessionId);
    await raw('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, sessionId);
    await raw('Runtime.runIfWaitingForDebugger', {}, sessionId);
  }
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    const p = m.params ?? {};
    if (m.method === 'Runtime.exceptionThrown') errors.push(p.exceptionDetails?.exception?.description ?? p.exceptionDetails?.text);
    if (m.method === 'Runtime.executionContextCreated' && p.context?.auxData?.isDefault) contexts.set(p.context.auxData.frameId, p.context.id);
    if (m.method === 'Target.attachedToTarget' && p.targetInfo?.type === 'iframe') {
      frames.set(p.sessionId, { targetId: p.targetInfo.targetId, url: p.targetInfo.url });
      void adopt(p.sessionId);
    }
    if (m.method === 'Target.targetInfoChanged') for (const f of frames.values()) if (f.targetId === p.targetInfo?.targetId) f.url = p.targetInfo.url;
    if (m.method === 'Target.detachedFromTarget') {
      frames.delete(p.sessionId);
      for (const [n, done] of pending) if (done.sessionId === p.sessionId) { pending.delete(n); done({ error: { message: 'its frame is gone' } }); } // what was asked of it gets no answer now
    }
  });
  const targets = (await raw('Target.getTargets')).result.targetInfos;
  page = (await raw('Target.attachToTarget', { targetId: targets.find(t => t.type === 'page').targetId, flatten: true })).result.sessionId;
  await adopt(page);
  // A headless page has the keyboard only some of the time (document.hasFocus() is false until something gives
  // it), and a key sent to a page without it can be lost, the more often the slower the machine. With this the
  // page counts as the focused one throughout, as a page someone looks at does.
  await raw('Emulation.setFocusEmulationEnabled', { enabled: true }, page);
  async function evaluate(expression, sessionId, contextId, ms) {
    const r = await raw('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...(contextId ? { contextId } : {}) }, sessionId, ms);
    if (r.error) throw new Error(r.error.message);
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
    return r.result?.result?.value;
  }
  /** Runs `expression` in the first frame whose address contains `part`; undefined while there is none. `ms`: how long to wait for the answer (CALL_MS). */
  async function inFrame(part, expression, ms) {
    for (const [s, f] of frames) if (f.url.includes(part)) return evaluate(expression, s, undefined, ms);
    const all = [], walk = t => { all.push(t.frame); (t.childFrames ?? []).forEach(walk); };
    const tree = await raw('Page.getFrameTree', {}, page, ms);
    if (tree.error) throw new Error(tree.error.message);
    walk(tree.result.frameTree);
    const frame = all.find(f => f.url.includes(part)), contextId = frame && contexts.get(frame.id);
    return contextId ? evaluate(expression, page, contextId, ms) : undefined;
  }
  return {
    send, errors, inFrame,
    js: (expression, ms) => evaluate(expression, page, undefined, ms),
    /** Whether the frame whose address contains `part` runs in a process of its own. */
    ownProcess: part => [...frames.values()].some(f => f.url.includes(part)),
    close: async () => {
      ws.close();
      chrome.kill();
      await sleep(300);
      // Chrome may still be writing its profile as it goes: tried again a few times, and a folder left behind in
      // the temp folder is no reason for a run that passed to fail.
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch { /* left for the system to clear */ }
    },
  };
}
