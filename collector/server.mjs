import { createServer } from 'node:http';
import { createServer as createSecureServer } from 'node:https';
import { createServer as createNetServer } from 'node:net';
import { createReadStream, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { hostname, networkInterfaces } from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { frameCsp } from './worlds.mjs';
import { GUEST_COOKIE, cookieOf, makeAttempts } from './access.mjs';

const BODY_LIMIT = 64 * 1024;
const MESSAGE_LIMIT = 90 * 1024 * 1024; // up to six 10 MB attached files, base64-encoded

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const GUEST_PATH = /^\/($|[a-z]+\.(js|css)$|world\/|api\/(state|events|worlds)$)/;
// A seat in a world's room (live.mjs): the one thing a guest may POST. It moves the world's figures, never an agent.
const MATCHMAKE = /^\/matchmake\/(joinOrCreate|reconnect)\/([\w-]{1,40})$/;
const MATCHMAKE_LIMIT = 4096;
// What a world's frame loads: its page, the SDK, the world's own files, and the two files of the dashboard's it shares.
// A frame is sealed (an origin of its own) and its scripts are fetched without credentials, so no cookie comes with
// these. Where guests give a password, their addresses carry a pass in the path instead (/f/<pass>/world/…), which
// the page is told once it is in (access.mjs, makePasses).
const FRAME_FILES = /^\/(world\/|base\.css$|brand\.js$)/;
const FRAME_PASS = /^\/f\/([0-9a-f]{32})(\/.*)$/;

/** The page a guest gets where a password is asked: a form that names nothing (no product, no hint of what is behind it), with no script. */
const loginPage = note => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Sign in</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#14181d;color:#e6e8ea;font:15px/1.5 system-ui,sans-serif}form{display:grid;gap:10px;width:min(320px,86vw)}
input,button{font:inherit;padding:9px 11px;border-radius:8px;border:1px solid #3a424b;background:#1d232a;color:inherit}button{background:#3b82f6;border-color:#3b82f6;color:#fff;cursor:pointer}p{margin:0;color:#f0a0a0}</style></head>
<body><form method="post" action="/login">${note ? `<p>${note}</p>` : ''}<label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" autofocus required><button>Sign in</button></form></body></html>`;
const LOGIN_HEADERS = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" };

/** The Colyseus browser SDK the page loads to watch a world live (/colyseus.js): the installed package's own build, read once. */
let sdk;
function sdkFile() {
  if (sdk !== undefined) return sdk;
  try {
    const code = readFileSync(join(dirname(createRequire(import.meta.url).resolve('@colyseus/sdk/package.json')), 'dist', 'colyseus.js'));
    sdk = { code, etag: `"${createHash('sha1').update(code).digest('hex').slice(0, 16)}"` };
  } catch { sdk = null; }
  return sdk;
}
const GUEST_AGENT = ['id', 'kind', 'cliId', 'name', 'startedAt', 'cwd', 'model', 'modelLabel', 'fast', 'contextTokens', 'compactions', 'lastCompactAt', 'wakeAt', 'state', 'stateReason', 'stateSince', 'mode', 'effort', 'turn', 'usage', 'lastActivityAt', 'mcp', 'touching', 'proc', 'activity', 'timeline', 'work', 'account'];
// A step as a guest gets it: the tool and the kind of step, never its words. A connector call keeps its server's name (the tool's own name has it already).
const stepOnly = now => (now ? { tool: now.tool, step: now.step, startedAt: now.startedAt, ...(String(now.tool ?? '').startsWith('mcp__') && now.service ? { service: now.service } : {}) } : undefined);
/**
 * Of a feed, what a guest's world is drawn from, never a word of it: the newest tool step (the tool and the kind of step: what an
 * agent between two steps holds), and that a message went between two agents (when, and to or from whom: the pigeon that carries it).
 */
const lastStep = feed => {
  const t = (feed ?? []).find(f => f?.kind === 'tool');
  const mail = (feed ?? []).filter(f => f?.kind === 'peer' && !f.helper).slice(0, 8).map(f => ({ at: f.at, kind: 'peer', dir: f.dir, other: f.other }));
  return [...(t ? [{ at: t.at, kind: 'tool', tool: t.tool, step: t.step }] : []), ...mail];
};

/**
 * The snapshot for a visitor from the network: who works where, in what state and with what tool,
 * but nothing an agent or you said. Only the listed fields go out, so a new one stays in by default.
 */
export function guestSnapshot(snapshot) {
  return {
    ...snapshot,
    accounts: (snapshot.accounts ?? []).map(a => ({ key: a.key, name: a.name, plan: a.plan })), // their names and limits (the silos' tags): never an email, an organisation or what they cost
    chatter: null, // the helper's lines for the animals: written from what is going on here
    sources: snapshot.sources && Object.fromEntries(Object.entries(snapshot.sources).map(([k, v]) => [k, v?.ok === false ? { ...v, error: 'failing' } : v])), // which source fails, not its error's words (they carry paths and commands)
    helper: snapshot.helper && { ...snapshot.helper, lastError: null },
    agents: snapshot.agents.map(a => ({
      ...Object.fromEntries(GUEST_AGENT.filter(k => a[k] !== undefined).map(k => [k, a[k]])),
      touching: a.touching?.filter(t => t.repo).map(t => ({ ...t, path: t.repo })), // the repo it touched, never which file
      now: stepOnly(a.now),
      tasks: a.tasks ? { done: a.tasks.done, total: a.tasks.total, items: [] } : undefined,
      feed: lastStep(a.feed),
      children: (a.children ?? []).map(c => ({ id: c.id, kind: c.kind, agentType: c.agentType, label: '', state: c.state, startedAt: c.startedAt, background: c.background, now: stepOnly(c.now), steps: c.steps, lastAt: c.lastAt, endedAt: c.endedAt })),
      docs: [],
    })),
  };
}

function send(res, status, type, body) {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
const sendJson = (res, status, value) => send(res, status, 'application/json', JSON.stringify(value));

function readBody(req, limit = BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(Object.assign(new Error('body too large'), { status: 413 })); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      try { resolve(text ? JSON.parse(text) : {}); } catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

// A file's bytes through a link (pictures, players, PDFs, a page's preview): the real type, never sniffed
// into something else; a sandbox around anything opened as a page (a page's own scripts may run, in an
// origin of their own, never the dashboard's); ranges, so players can seek. The PDF viewer won't run in
// a sandbox, and a PDF's scripts run in the viewer's own, so PDFs alone go without.
function sendRaw(req, res, { real, type, size }) {
  // Kept in this browser only, and only for as long as the link lasts (each link is new): a thumbnail drawn again is not fetched again.
  const headers = { 'content-type': type, 'x-content-type-options': 'nosniff', 'cache-control': 'private, max-age=600', 'accept-ranges': 'bytes' };
  if (!type.startsWith('application/pdf')) headers['content-security-policy'] = type.startsWith('text/html') ? 'sandbox allow-scripts' : 'sandbox';
  // A sandboxed page's module scripts and fonts load only with CORS; nothing else gets it, so its
  // scripts can't fetch() the files beside it and read them.
  if (req.headers.origin === 'null' && ['script', 'font'].includes(req.headers['sec-fetch-dest'])) headers['access-control-allow-origin'] = 'null';
  const range = String(req.headers.range ?? '').match(/^bytes=(\d*)-(\d*)$/);
  let start = 0, end = size - 1;
  if (range && (range[1] || range[2])) {
    if (range[1]) { start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1; }
    else { start = Math.max(0, size - Number(range[2])); }
    if (start >= size || start > end) {
      res.writeHead(416, { ...headers, 'content-range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
  } else res.writeHead(200, { ...headers, 'content-length': size });
  if (req.method === 'HEAD' || size === 0) return res.end();
  createReadStream(real, { start, end }).on('error', () => res.destroy()).pipe(res);
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

export function createTrackerServer({ port, token, webFile, getSnapshot, getFeed, getConversation, getPrompts, getNotes, getHeld = () => null, getSubagent, claudePlugins, claudeMcp, claudeRules, fileTicket, rawFile, officeView, listDirs, shellOutput, namedFiles, getTranscriptHtml, getDoc, listFiles, readFile, repoTouched, actions, pastSessions, worlds, getSettings = () => null, log = () => {}, lan = false, tls = null, getAccess = () => ({ admits: () => true, passes: null, checkPassword: () => false }) }) {
  // tls ({ key, cert }): https is served too, on the same port (see the listener, below). getAccess(): which addresses may come
  // as guests, and the guests' password if one is set (access.mjs), asked afresh each time, so a setting is in force at once.
  const clients = new Set();
  let server, front;
  const actualPort = () => front.address()?.port ?? port;

  // lan (the "Let others on your network watch" setting) opens the dashboard to the local network: it binds
  // every interface and also answers to this computer's own names and addresses. Any other Host is still
  // refused (DNS rebinding). A visitor from the network is a guest: it gets the page without the token, a
  // snapshot without what was said, and nothing else. Only this computer itself reads conversations and
  // files, acts, or sees and changes the settings.
  const ownNames = () => {
    if (!lan) return ['localhost', '127.0.0.1'];
    const name = hostname().toLowerCase();
    const addresses = Object.values(networkInterfaces()).flat().filter(i => i.family === 'IPv4' && !i.internal).map(i => i.address);
    return ['localhost', '127.0.0.1', name, `${name.split('.')[0]}.local`, ...addresses];
  };
  const isAllowedHost = host => ownNames().some(name => host === `${name}:${actualPort()}`);
  const isAllowedOrigin = origin => ownNames().some(name => origin === `http://${name}:${actualPort()}` || (tls && origin === `https://${name}:${actualPort()}`));

  const isGuest = req => lan && !LOOPBACK.has(req.socket.remoteAddress);
  /** A guest with nothing more to show: there is no password, or its pass (a cookie) is good. */
  const guestIn = req => { const { passes } = getAccess(); return !passes || passes.valid(cookieOf(req.headers.cookie, GUEST_COOKIE)); };
  /** Plain http while https is served: sent on to https, from this computer too. */
  const mustBeSecure = req => Boolean(tls) && !req.socket.encrypted;
  const attempts = makeAttempts();
  /** A guest's password, given in the form: a pass and the dashboard, or the form again. */
  async function login(req, res) {
    const address = req.socket.remoteAddress, { passes, checkPassword } = getAccess();
    if (!passes) { res.writeHead(303, { location: '/' }); return res.end(); }
    let text = '';
    try { for await (const chunk of req) { text += chunk; if (text.length > 4096) break; } } catch { /* a form cut short: no password */ }
    // Counted only now, with nothing awaited from here to the count below: forms sent side by side, each held back until all were let in, would else all be tried.
    if (!attempts.allowed(address)) { res.writeHead(429, LOGIN_HEADERS); return res.end(loginPage('Too many attempts. Try again in a minute.')); }
    const given = new URLSearchParams(text.slice(0, 4096)).get('password') ?? '';
    if (!checkPassword(given)) {
      attempts.failed(address);
      res.writeHead(401, LOGIN_HEADERS);
      return res.end(loginPage('Wrong password.'));
    }
    const pass = passes.issue();
    res.writeHead(303, { location: '/', 'cache-control': 'no-store', 'set-cookie': `${GUEST_COOKIE}=${pass.value}; Path=/; Max-Age=${pass.maxAge}; HttpOnly; SameSite=Strict${req.socket.encrypted ? '; Secure' : ''}` });
    return res.end();
  }
  const frame = snapshot => `event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;

  function openStream(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.guest = isGuest(req);
    res.write(frame(res.guest ? guestSnapshot(getSnapshot()) : getSnapshot()));
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  const answer = async (req, res) => {
    try {
      if (!isAllowedHost(req.headers.host ?? '')) return send(res, 403, 'text/plain', 'forbidden host');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${actualPort()}`);
      let path = url.pathname, framePass = null;
      const guest = isGuest(req);
      if (mustBeSecure(req)) { res.writeHead(308, { location: `https://${req.headers.host}${req.url ?? '/'}`, 'cache-control': 'no-store' }); return res.end(); }
      if (guest && req.method === 'POST' && path === '/login') return await login(req, res);
      const framed = guest && req.method === 'GET' ? FRAME_PASS.exec(path) : null;
      if (framed && FRAME_FILES.test(framed[2]) && getAccess().passes?.validFrame(framed[1])) { framePass = framed[1]; path = framed[2]; } // a frame's file, by the pass in its address
      if (guest && !framePass && !guestIn(req)) { // a password is asked, and this guest has not given it: the form, and nothing else
        res.writeHead(401, LOGIN_HEADERS);
        return res.end(req.method === 'GET' ? loginPage('') : 'unauthorized');
      }
      if (guest && !(req.method === 'GET' && GUEST_PATH.test(path)) && !(req.method === 'POST' && MATCHMAKE.test(path))) return send(res, 403, 'text/plain', 'forbidden');
      let m;
      // The dashboard holds the token: it is never shown inside a frame, not even a world's own.
      if (path === '/' || path.startsWith('/api/')) {
        res.setHeader('content-security-policy', "frame-ancestors 'none'");
        res.setHeader('x-frame-options', 'DENY');
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && (m = path.match(/^\/raw\/([\w-]+)\/(.+)$/))) {
        // A link's bytes: the random id is all it takes (an <img> or a player can't send the token).
        let rel;
        try { rel = m[2].split('/').map(decodeURIComponent).join('/'); } catch { return send(res, 404, 'text/plain', 'not found'); }
        const found = await rawFile(m[1], rel);
        return found.real ? sendRaw(req, res, found) : send(res, found.status ?? 404, 'text/plain; charset=utf-8', found.error ?? 'not found');
      }

      if (req.method === 'GET') {
        if (path === '/') return send(res, 200, 'text/html; charset=utf-8', readFileSync(webFile, 'utf8').replace('__TRACKER_TOKEN__', guest ? '' : token));
        if (path === '/colyseus.js') { // the library the page watches a world live with: checked against what the browser has, so an update is picked up at once
          const file = sdkFile();
          if (!file) return send(res, 404, 'text/plain', 'not found');
          const headers = { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-cache', etag: file.etag, 'x-content-type-options': 'nosniff' };
          if (req.headers['if-none-match'] === file.etag) { res.writeHead(304, headers); return res.end(); }
          res.writeHead(200, headers);
          return res.end(file.code);
        }
        if ((m = path.match(/^\/([a-z]+)\.js$/))) { // the page's scripts, from web/ by plain name only
          let code;
          try { code = readFileSync(join(dirname(webFile), `${m[1]}.js`), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          return send(res, 200, 'text/javascript; charset=utf-8', code);
        }
        if ((m = path.match(/^\/([a-z]+)\.css$/))) { // the page's and the worlds' shared styles, from web/ by plain name only
          let css;
          try { css = readFileSync(join(dirname(webFile), `${m[1]}.css`), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          return send(res, 200, 'text/css; charset=utf-8', css);
        }
        if ((m = path.match(/^\/world\/((?:u\/)?[a-z0-9-]+)\/$/))) { // a world's frame: sandboxed, its own CSP
          let html = worlds?.frame(m[1]);
          if (!html) return send(res, 404, 'text/plain', 'not found');
          if (framePass) html = html.replaceAll('href="/', `href="/f/${framePass}/`).replaceAll('src="/', `src="/f/${framePass}/`); // what it loads carries the pass too
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': frameCsp(html), 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
          return res.end(html);
        }
        if ((m = path.match(/^\/world\/((?:u\/)?[a-z0-9-]+)\/(.+)$/))) { // one of a world's files, from inside its folder only
          let rel;
          try { rel = m[2].split('/').map(decodeURIComponent).join('/'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          if (rel.includes('\0')) return send(res, 404, 'text/plain', 'not found');
          const found = worlds ? worlds.file(m[1], rel) : { status: 404 };
          if (!found.real) return send(res, 404, 'text/plain', 'not found');
          const headers = { 'content-type': found.type, 'content-length': found.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': 'sandbox' };
          // The frame's origin is opaque: fonts load only with CORS, and scripts are loaded with it so their errors are reported in full.
          // Nothing else gets it, so a world can't read files with fetch().
          // A browser without Sec-Fetch-Dest (Safari before 16.4) sends none: then a script or font is known by its name.
          const dest = req.headers['sec-fetch-dest'];
          if (req.headers.origin === 'null' && (['script', 'font'].includes(dest) || (dest === undefined && /\.(js|woff2?|ttf|otf)$/i.test(rel)))) headers['access-control-allow-origin'] = 'null';
          res.writeHead(200, headers);
          return createReadStream(found.real).on('error', () => res.destroy()).pipe(res);
        }
        if (path === '/worlds/test') { // a world's test page: no token and no real data (web/worlds/test/)
          let html;
          try { html = readFileSync(join(dirname(webFile), 'worlds', 'test', 'index.html'), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          // connect-src: it fetches a world's own files (a world asks the page for its models as bytes) and nothing else: no list of
          // worlds, made-up answers. So /api/state, which needs no token, is out of its reach by policy. (The host is one of this server's own names: checked above.)
          const worldFiles = `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}/world/`;
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': `default-src 'self'; connect-src ${worldFiles}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`, 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
          return res.end(html);
        }
        if ((m = path.match(/^\/worlds\/test\/([a-z]+)\.js$/))) { // its scripts, by plain name only
          let code;
          try { code = readFileSync(join(dirname(webFile), 'worlds', 'test', `${m[1]}.js`), 'utf8'); } catch { return send(res, 404, 'text/plain', 'not found'); }
          return send(res, 200, 'text/javascript; charset=utf-8', code);
        }
        if (path === '/api/state') return sendJson(res, 200, guest ? guestSnapshot(getSnapshot()) : getSnapshot());
        if (path === '/api/events') return openStream(req, res);
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/feed$/))) {
          const feed = getFeed(m[1], clampInt(url.searchParams.get('limit'), 1, 200, 200));
          return feed ? sendJson(res, 200, feed) : sendJson(res, 404, { error: 'unknown agent' });
        }
        // A session's whole conversation, or a subagent's prompt, steps and result: token only, like files.
        // The id comes encoded from the page (a subagent's is session:call), so it is decoded, then checked.
        if ((m = path.match(/^\/api\/agent\/([^/]+)\/(conversation|subagent|prompts|notes|held)$/))) {
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          let id = '';
          try { id = decodeURIComponent(m[1]); } catch { /* not an id */ }
          if (!/^(?:codex:)?[\w-]+(?::[\w-]+)?$/.test(id)) return sendJson(res, 404, { error: 'unknown agent' }); // session, session:call, codex:thread, codex:thread:subagent
          if (m[2] === 'subagent') {
            const sub = id.includes(':') ? getSubagent(id) : null;
            return sub ? sendJson(res, 200, sub) : sendJson(res, 404, { error: 'That subagent is not known.' });
          }
          if (m[2] === 'held') { // what you sent it while it worked, waiting for its turn to end
            const got = id.includes(':') ? null : getHeld(id);
            return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'That session is not on the dashboard.' });
          }
          if (m[2] === 'notes') { // your notes on it, for later
            const got = id.includes(':') ? null : getNotes(id);
            return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'That session is not on the dashboard.' });
          }
          if (m[2] === 'prompts') { // your own messages to it, newest first, for ↑ in its message box
            const got = id.includes(':') ? null : await getPrompts(id);
            return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'That session has no transcript to read.' });
          }
          const convo = await getConversation(id, clampInt(url.searchParams.get('from'), 0, 1_000_000, 0));
          return convo ? sendJson(res, 200, convo) : sendJson(res, 404, { error: 'That session has no transcript to read.' });
        }
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/(doc|file|files|ticket|office)$/))) {
          // Folder listings and file contents: the page sends its token, which other sites can't
          // do without a CORS preflight.
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          if (m[2] === 'files') {
            const listing = await listFiles(m[1]);
            return listing.error ? sendJson(res, listing.status ?? 404, { error: listing.error }) : sendJson(res, 200, listing);
          }
          const file = url.searchParams.get('path') ?? '';
          if (m[2] === 'ticket' || m[2] === 'office') { // a link to a file's bytes, or a document read into tables or a page
            const got = m[2] === 'ticket' ? await fileTicket(m[1], file, { folder: url.searchParams.get('folder') === '1' }) : await officeView(m[1], file);
            return got.error ? sendJson(res, got.status ?? 404, { error: got.error }) : sendJson(res, 200, got);
          }
          const found = m[2] === 'doc' ? getDoc(m[1], file) : await readFile(m[1], file);
          return found.doc ? sendJson(res, 200, found.doc) : sendJson(res, found.status ?? 404, { error: found.error });
        }
        if (path === '/api/claude/plugins' || path === '/api/claude/mcp' || path === '/api/claude/rules') { // your Claude Code setup: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          if (path === '/api/claude/plugins') return sendJson(res, 200, await claudePlugins());
          if (path === '/api/claude/mcp') return sendJson(res, 200, await claudeMcp({ fresh: url.searchParams.get('fresh') === '1' }));
          return sendJson(res, 200, claudeRules());
        }
        if (path === '/api/config') { // the settings, for the Settings window: token only (a guest never gets here at all)
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const got = getSettings();
          return got ? sendJson(res, 200, got) : sendJson(res, 404, { error: 'not found' });
        }
        if (path === '/api/sessions') { // past sessions' titles and messages: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          return sendJson(res, 200, await pastSessions({ all: url.searchParams.get('days') === 'all' }));
        }
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/named$/))) { // files named in its replies, checked: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const got = await namedFiles(m[1], url.searchParams.getAll('path'));
          return got.error ? sendJson(res, got.status ?? 404, { error: got.error }) : sendJson(res, 200, got);
        }
        if ((m = path.match(/^\/api\/agent\/([\w:-]+)\/shell-output$/))) { // the end of a background command's output: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const got = await shellOutput(m[1], clampInt(url.searchParams.get('pid'), 1, 99_999_999, 0));
          return got.error ? sendJson(res, got.status ?? 404, { error: got.error }) : sendJson(res, 200, got);
        }
        if (path === '/api/dirs') { // folders to start a session in, as you type one: token only, like files
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          return sendJson(res, 200, await listDirs(url.searchParams.get('path') ?? '~/'));
        }
        if (path === '/api/worlds') { // the worlds to choose from: yours with the token; a guest gets their names to pick one (each is a room of its own to watch), never where your folder is or what is wrong with one
          const online = live?.online() ?? {}, listed = (worlds?.list() ?? []).map(w => ({ ...w, online: online[w.key] ?? 0 })); // with how many look at each just now (as its chip says)
          if (guest) { // frames: what a frame's address starts with, where guests give a password (the pass a frame's files are asked by)
            const { passes } = getAccess();
            return sendJson(res, 200, { worlds: listed.map(w => ({ ...w, error: w.error ? 'It has something wrong with it.' : null })), folder: null, ...(passes ? { frames: `/f/${passes.frame}` } : {}) });
          }
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          return sendJson(res, 200, { worlds: listed, folder: worlds?.userDir ?? null });
        }
        if (path === '/api/repo/touched') {
          if (req.headers['x-tracker-token'] !== token) return sendJson(res, 403, { error: 'forbidden' });
          const touched = await repoTouched(url.searchParams.get('path') ?? '');
          return touched.error ? sendJson(res, touched.status ?? 404, { error: touched.error }) : sendJson(res, 200, touched);
        }
        if ((m = path.match(/^\/agent\/([\w:-]+)\/transcript$/))) {
          const html = await getTranscriptHtml(m[1]);
          return html ? send(res, 200, 'text/html; charset=utf-8', html) : send(res, 404, 'text/plain', 'unknown agent');
        }
      }

      if (req.method === 'POST' && (m = path.match(MATCHMAKE))) { // a seat in a world's room: from one of this dashboard's own pages (a tool sends no origin), a guest's too
        if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) return sendJson(res, 403, { error: 'forbidden' });
        if (!seatAllowed(req.socket.remoteAddress)) return sendJson(res, 429, { code: 429, error: 'too many at once' }); // a page asks once, and again every few seconds when it has none
        let body;
        try { body = await readBody(req, MATCHMAKE_LIMIT); } catch (err) { if (err.status === 413) return sendJson(res, 413, { error: 'too large' }); throw err; }
        const rooms = await liveRooms();
        if (!rooms) return sendJson(res, 503, { code: 503, error: 'live worlds are not installed' }); // the page's world then moves itself
        const seat = await rooms.matchmake(m[1], m[2], body);
        return sendJson(res, seat.status, seat.body);
      }

      const isBodyAction = ['/api/actions/rm', '/api/actions/answer', '/api/actions/permit', '/api/actions/always', '/api/actions/plugin', '/api/actions/reload', '/api/actions/mcp', '/api/actions/rule', '/api/actions/message', '/api/actions/start', '/api/actions/fork', '/api/actions/restore', '/api/actions/note', '/api/actions/held', '/api/actions/helper', '/api/actions/name', '/api/actions/animals', '/api/actions/end', '/api/actions/restart', '/api/actions/setting', '/api/actions/config', '/api/actions/aside', '/api/actions/reveal', '/api/actions/reveal-worlds', '/api/actions/mkdir', '/api/actions/choose-folder', '/api/actions/stop-shell'].includes(path);
      if (req.method === 'POST' && (isBodyAction || /^\/api\/actions\/open\/[\w-]+$/.test(path))) {
        if (req.headers['x-tracker-token'] !== token || !isAllowedOrigin(req.headers.origin ?? '')) {
          return sendJson(res, 403, { error: 'forbidden' });
        }
        let body;
        try {
          body = await readBody(req, path === '/api/actions/message' ? MESSAGE_LIMIT : BODY_LIMIT);
        } catch (err) {
          if (err.status === 413) return sendJson(res, 413, { error: 'That is too large to send.' });
          throw err;
        }
        if (path === '/api/actions/rm') return sendJson(res, 200, await actions.rm(Array.isArray(body.ids) ? body.ids : []));
        if (path === '/api/actions/answer') return sendJson(res, 200, await actions.answer(body));
        if (path === '/api/actions/permit') return sendJson(res, 200, await actions.permit(body));
        if (path === '/api/actions/always') return sendJson(res, 200, await actions.always(body));
        if (path === '/api/actions/plugin') return sendJson(res, 200, await actions.plugin(body));
        if (path === '/api/actions/reload') return sendJson(res, 200, await actions.reload(body));
        if (path === '/api/actions/mcp') return sendJson(res, 200, await actions.mcp(body));
        if (path === '/api/actions/rule') return sendJson(res, 200, await actions.rule(body));
        if (path === '/api/actions/message') return sendJson(res, 200, await actions.message(body));
        if (path === '/api/actions/start') return sendJson(res, 200, await actions.start(body));
        if (path === '/api/actions/fork') return sendJson(res, 200, await actions.fork(body));
        if (path === '/api/actions/restore') return sendJson(res, 200, await actions.restore(body));
        if (path === '/api/actions/note') return sendJson(res, 200, await actions.note(body));
        if (path === '/api/actions/held') return sendJson(res, 200, await actions.held(body));
        if (path === '/api/actions/helper') return sendJson(res, 200, await actions.helper(body));
        if (path === '/api/actions/name') return sendJson(res, 200, await actions.name(body));
        if (path === '/api/actions/animals') return sendJson(res, 200, await actions.animals(body));
        if (path === '/api/actions/setting') return sendJson(res, 200, await actions.setting(body));
        if (path === '/api/actions/config') return sendJson(res, 200, await actions.config(body));
        if (path === '/api/actions/aside') return sendJson(res, 200, await actions.aside(body));
        if (path === '/api/actions/reveal') return sendJson(res, 200, await actions.reveal(body));
        if (path === '/api/actions/reveal-worlds') return sendJson(res, 200, await actions.revealWorlds());
        if (path === '/api/actions/mkdir') return sendJson(res, 200, await actions.mkdir(body));
        if (path === '/api/actions/stop-shell') return sendJson(res, 200, await actions.stopShell(body));
        if (path === '/api/actions/choose-folder') return sendJson(res, 200, await actions.chooseFolder(body)); // waits while you pick
        if (path === '/api/actions/end') return sendJson(res, 200, await actions.end(body));
        if (path === '/api/actions/restart') return sendJson(res, 200, await actions.restart(body));
        return sendJson(res, 200, await actions.open(path.split('/').pop()));
      }

      return send(res, 404, 'text/plain', 'not found');
    } catch (err) {
      log(`http error: ${err?.stack ?? err}`);
      if (!res.headersSent) send(res, 500, 'text/plain', 'internal error');
      else res.end();
    }
  };
  // One port for both: the listener looks at a connection's first byte (a TLS handshake starts with 22) and hands it to
  // the http or the https server, neither of which listens itself. With https on, whoever comes by http is sent on to
  // https at the same address. A guest's address is checked here, before a byte is read or sent; one that says nothing
  // for ten seconds is let go.
  server = createServer(answer);
  const secure = tls ? createSecureServer({ key: tls.key, cert: tls.cert }, answer) : null;
  secure?.on('upgrade', (req, socket, head) => server.emit('upgrade', req, socket, head)); // a world's WebSocket, over wss
  secure?.on('tlsClientError', () => {}); // a browser that turns the certificate down just leaves
  const sockets = new Set();
  const admitted = socket => LOOPBACK.has(socket.remoteAddress) || (lan && getAccess().admits(socket.remoteAddress));
  function route(socket) {
    const first = socket.read(1);
    if (first === null) { socket.once('readable', () => route(socket)); return; }
    socket.setTimeout(0);
    socket.unshift(first);
    (first[0] === 22 && secure ? secure : server).emit('connection', socket);
  }
  front = createNetServer(socket => {
    if (!admitted(socket)) { socket.destroy(); return; }
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    if (!secure) { server.emit('connection', socket); return; }
    socket.setTimeout(10_000, () => socket.destroy());
    route(socket);
  });
  // Closing it lets go of whoever is still connected (a page's event stream, a browser's idle connection), as an http server's close does of its idle ones.
  const closeFront = front.close.bind(front);
  front.close = done => { const closing = closeFront(done); for (const socket of sockets) socket.destroy(); return closing; };

  // Seats asked for, by address: a few in any ten seconds (a seat not taken holds its place for a quarter of a minute).
  const seatsAsked = new Map();
  const SEATS = 12, SEATS_MS = 10_000;
  function seatAllowed(address) {
    const now = Date.now(), recent = (seatsAsked.get(address) ?? []).filter(at => now - at < SEATS_MS);
    if (recent.length >= SEATS) { seatsAsked.set(address, recent); return false; }
    recent.push(now);
    seatsAsked.set(address, recent);
    if (seatsAsked.size > 500) for (const [k, v] of seatsAsked) if (!v.some(at => now - at < SEATS_MS)) seatsAsked.delete(k);
    return true;
  }
  // The built-in worlds, moved here for everyone who watches (live.mjs). Nothing of it is loaded until a page asks for a
  // seat; where its packages are not installed (no `npm install` yet), the dashboard runs as ever and each page moves its own world.
  let live = null, liveLoading = null;
  const liveRooms = () => (liveLoading ??= import('./live.mjs').then(m => (live = m.createLive({
    httpServer: server, token, lan, webDir: dirname(webFile), log,
    getGuestJson: () => JSON.stringify(guestSnapshot(getSnapshot())),
    getChatter: () => getSnapshot()?.chatter ?? null,
    source: key => worlds?.source(key) ?? null, // what a world is moved with: its files, really inside its folder
    allowed: req => isAllowedHost(req.headers.host ?? '') && (!req.headers.origin || isAllowedOrigin(req.headers.origin)) && !mustBeSecure(req) && (!isGuest(req) || guestIn(req)),
  })), err => { log(`live worlds are off: ${err?.message ?? err} (its packages are missing: install Agentville again)`); return null; }));

  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(': ping\n\n');
  }, 15_000);
  heartbeat.unref();

  return {
    server: front,
    listen: () => new Promise((resolve, reject) => {
      front.once('error', reject);
      front.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => resolve(front.address().port));
    }),
    /**
     * Who may come changed: whoever is connected and may no longer be, is let go. With `guestsOut` (the guests'
     * password changed) every guest is: an open stream or world would outlive the pass it came in with.
     */
    recheck({ guestsOut = false } = {}) { for (const socket of sockets) if (!admitted(socket) || (guestsOut && !LOOPBACK.has(socket.remoteAddress))) socket.destroy(); },
    broadcast(snapshot) {
      let full, redacted, json;
      const guestJson = () => (json ??= JSON.stringify(guestSnapshot(snapshot))); // made once: for the guests' pages and for the worlds moved here
      for (const c of clients) c.write(c.guest ? (redacted ??= `event: snapshot\ndata: ${guestJson()}\n\n`) : (full ??= frame(snapshot)));
      if (live?.watching()) live.publish(guestJson, snapshot.chatter ?? null);
    },
    /** A world's files changed (or '*': the SDK, or the list): the page reloads it, or its list. */
    broadcastWorlds(change) {
      const data = `event: worlds\ndata: ${JSON.stringify(change)}\n\n`;
      for (const c of clients) c.write(data);
      live?.reload(change?.key ?? '*'); // its room starts afresh with the new files, as its pages do
    },
    close: async () => {
      clearInterval(heartbeat);
      await live?.stop();
      for (const c of clients) c.end();
      clients.clear();
      await new Promise(resolve => { front.close(() => resolve()); });
      server.close(() => {}); // neither listened, but each has timers of its own (and what is attached to it: a world's transport) that end with its close
      secure?.close(() => {});
    },
  };
}
