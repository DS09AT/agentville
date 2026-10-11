// Guests from the network, beyond the one switch (collector/access.mjs, tls.mjs, and the server's side of both):
// which addresses may come, the password they must give, and https with the collector's own certificate.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'; // this file's own requests go to a certificate no authority signed: that is the point of it
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@colyseus/sdk';
import { GUEST_COOKIE, checkPassword, cookieOf, hashPassword, makeAdmits, makeAttempts, makePasses, parseEntry } from '../access.mjs';
import { createTrackerServer } from '../server.mjs';
import { makeCertificate, ownCertificate } from '../tls.mjs';
import { makeWorlds } from '../worlds.mjs';

const WEB = fileURLToPath(new URL('../../web/', import.meta.url));
const OWN = Object.values(networkInterfaces()).flat().find(i => i.family === 'IPv4' && !i.internal)?.address; // this machine, as a guest sees it
const TOKEN = 't'.repeat(64);
const CERT = await makeCertificate({ dns: ['localhost'], ips: ['127.0.0.1', ...(OWN ? [OWN] : [])] });

test('which addresses may come as guests: any private one unless you name some, never a public one unnamed, never a blocked one', () => {
  const any = makeAdmits();
  for (const a of ['192.168.178.40', '10.1.2.3', '172.16.0.9', '172.31.255.1', '169.254.3.3', '100.100.20.5', '::ffff:192.168.1.5']) assert.equal(any(a), true, a);
  for (const a of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '203.0.113.9', '2001:db8::1', '', undefined]) assert.equal(any(a), false, String(a));
  const some = makeAdmits({ allow: ['192.168.178.40', '10.0.0.0/24', '203.0.113.9'], block: ['10.0.0.66', '192.168.178.0/30'] });
  assert.deepEqual(['192.168.178.40', '10.0.0.7', '203.0.113.9', '10.0.0.66', '10.0.1.7', '192.168.178.41', '192.168.178.2'].map(some), [true, true, true, false, false, false, false]);
  assert.equal(makeAdmits({ allow: ['192.168.178.0/24'], block: ['192.168.178.2'] })('192.168.178.2'), false, 'blocked wins');
  assert.deepEqual(parseEntry(' 192.168.1.0/24 '), { address: '192.168.1.0', bits: 24 });
  for (const bad of ['192.168.1', '300.1.1.1', '192.168.1.0/33', 'fe80::1', 'localhost', '', '1.2.3.4/', '1.2.3.4; rm']) assert.equal(parseEntry(bad), null, bad);
  // a slip in config.json never opens the door: a blocked entry that is no address keeps everyone out, an allowed one admits no one
  for (const a of ['192.168.178.40', '10.1.2.3']) {
    assert.equal(makeAdmits({ block: ['10.0.0.66', 'not an address'] })(a), false, a);
    assert.equal(makeAdmits({ allow: ['nonsense'] })(a), false, a);
  }
  assert.equal(makeAdmits({ allow: ['nonsense', '10.1.2.3'] })('10.1.2.3'), true, 'the entries that are addresses still count');
  assert.equal(makeAdmits({ allow: ['nonsense', '10.1.2.3'] })('192.168.178.40'), false);
});

test("the guests' password is kept as a hash; a pass holds through a restart and is void once the password changes", () => {
  const kept = hashPassword('correct horse');
  assert.match(kept.hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hashPassword('correct horse').hash, kept.hash, 'a salt of its own each time');
  assert.equal(checkPassword('correct horse', kept), true);
  for (const wrong of ['correct horsE', '', null, 'x'.repeat(2000)]) assert.equal(checkPassword(wrong, kept), false);
  assert.equal(checkPassword('correct horse', null), false);
  const now = 1_800_000_000_000, passes = makePasses({ secret: TOKEN, kept });
  const pass = passes.issue(now);
  assert.equal(pass.maxAge, 365 * 86_400);
  assert.equal(passes.valid(pass.value, now + 1000), true);
  assert.equal(makePasses({ secret: TOKEN, kept }).valid(pass.value, now + 1000), true, 'the same after the collector starts again: nothing is kept in memory');
  assert.equal(passes.valid(pass.value, now + 366 * 86_400_000), false, 'a year on, it is asked again');
  assert.equal(makePasses({ secret: TOKEN, kept: hashPassword('another') }).valid(pass.value, now), false, 'a new password voids every pass');
  assert.equal(makePasses({ secret: 'u'.repeat(64), kept }).valid(pass.value, now), false, "another collector's pass is none here");
  const [until, signature] = pass.value.split('.');
  for (const forged of [`${Number(until) + 1}.${signature}`, `${until}.${'0'.repeat(64)}`, until, '', null, 'a.b', `${until}.${signature}x`]) assert.equal(passes.valid(forged, now), false, String(forged));
  assert.equal(cookieOf(`a=1; ${GUEST_COOKIE}=${pass.value}; b=2`, GUEST_COOKIE), pass.value);
  assert.equal(cookieOf(undefined, GUEST_COOKIE), null);
  const tries = makeAttempts({ max: 3, windowMs: 1000 });
  for (let i = 0; i < 3; i++) { assert.equal(tries.allowed('10.0.0.1', i), true); tries.failed('10.0.0.1', i); }
  assert.equal(tries.allowed('10.0.0.1', 500), false, 'a few wrong ones, then none for a while');
  assert.equal(tries.allowed('10.0.0.2', 500), true, 'counted by address');
  assert.equal(tries.allowed('10.0.0.1', 1500), true);
});

test('the certificate: made for this computer’s names and addresses, for 99 years, once (a device that accepted it is never asked again)', async () => {
  const x = new X509Certificate(CERT.cert);
  assert.ok(new Date(x.validTo).getFullYear() - new Date().getFullYear() >= 98, x.validTo);
  assert.match(x.subjectAltName, /DNS:localhost/);
  assert.match(x.subjectAltName, /IP Address:127\.0\.0\.1/);
  assert.equal(x.ca, false);
  assert.deepEqual(x.keyUsage, ['1.3.6.1.5.5.7.3.1'], 'for a server, and nothing else');
  const dir = join(mkdtempSync(join(tmpdir(), 'tracker-tls-')), 'tls'), logged = [];
  const first = await ownCertificate(dir, { names: { dns: ['localhost'], ips: ['127.0.0.1'] }, log: m => logged.push(m) });
  const again = await ownCertificate(dir, { names: { dns: ['other'], ips: ['10.0.0.1'] }, log: m => logged.push(m) });
  assert.equal(again.cert, first.cert, 'kept, whatever the addresses are now');
  assert.equal(again.key, readFileSync(join(dir, 'key.pem'), 'utf8'));
  assert.equal(logged.length, 1);
  if (process.platform !== 'win32') assert.equal(statSync(join(dir, 'key.pem')).mode & 0o777, 0o600, 'its key is yours alone');
});

const servers = [];
after(async () => { for (const s of servers) await s.close(); });
async function dashboard({ tls = CERT, lan = true, password = null, admits = () => true } = {}) {
  const kept = password ? hashPassword(password) : null, access = { admits, passes: kept ? makePasses({ secret: TOKEN, kept }) : null, checkPassword: given => checkPassword(given, kept) };
  const srv = createTrackerServer({ port: 0, token: TOKEN, webFile: `${WEB}index.html`, lan, tls, worlds: makeWorlds({ builtinDir: `${WEB}worlds` }), getAccess: () => access, getSnapshot: () => ({ agents: [], collisions: [], sources: {} }), getFeed: () => [], actions: {} });
  const port = await srv.listen();
  servers.push(srv);
  return { srv, port, access };
}
/** One request, by http or https, to an address of this machine: { status, headers, body }. Nothing is followed or kept. */
const ask = (scheme, host, port, path, { method = 'GET', headers = {}, body = null } = {}) => new Promise((resolve, reject) => {
  const req = (scheme === 'https' ? httpsRequest : httpRequest)({ host, port, path, method, rejectUnauthorized: false, agent: false, headers: { host: `${host}:${port}`, ...headers } }, res => {
    let text = '';
    res.on('data', d => { text += d; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
  });
  req.on('error', reject);
  req.end(body);
});

test('https and http on the one port: whoever comes by http is sent on to https, this computer too', async t => {
  const d = await dashboard();
  const plainHere = await ask('http', '127.0.0.1', d.port, '/?x=1');
  assert.equal(plainHere.status, 308);
  assert.equal(plainHere.headers.location, `https://127.0.0.1:${d.port}/?x=1`);
  const mine = await ask('https', '127.0.0.1', d.port, '/');
  assert.equal(mine.status, 200);
  assert.match(mine.body, new RegExp(TOKEN), 'this computer, as ever, with its token');
  if (!OWN) return t.skip('this machine has no network address to visit from');
  const plain = await ask('http', OWN, d.port, '/api/state?x=1');
  assert.equal(plain.status, 308);
  assert.equal(plain.headers.location, `https://${OWN}:${d.port}/api/state?x=1`);
  const secure = await ask('https', OWN, d.port, '/');
  assert.equal(secure.status, 200);
  assert.doesNotMatch(secure.body, new RegExp(TOKEN), 'a guest, as on http: the page without the token');
  assert.equal((await ask('https', OWN, d.port, '/api/config', { headers: { 'x-tracker-token': TOKEN } })).status, 403, 'and no more than a guest gets');
  assert.equal((await ask('https', OWN, d.port, '/matchmake/joinOrCreate/world', { method: 'POST', headers: { 'content-type': 'application/json', origin: `https://${OWN}:${d.port}` }, body: JSON.stringify({ world: 'farm' }) })).status, 200, "the page's own https origin is one of the dashboard's");
  // without https switched on, the port speaks http only, and nothing is redirected
  const off = await dashboard({ tls: null });
  assert.equal((await ask('http', OWN, off.port, '/api/state')).status, 200);
  await assert.rejects(ask('https', OWN, off.port, '/api/state'));
});

test('a world is watched over wss as over ws: the same room', async () => {
  const d = await dashboard({ lan: false });
  const room = await new Client(`https://127.0.0.1:${d.port}`).joinOrCreate('world', { world: 'farm', token: TOKEN });
  try {
    let state = null;
    room.onStateChange(s => { state = s; });
    for (let i = 0; i < 80 && !(state?.t > 0); i++) await new Promise(r => setTimeout(r, 50));
    assert.ok(state?.t > 0, 'its states arrive');
  } finally { await room.leave(); }
});

test('with a password set, a guest is shown the form and nothing else until it gives it; this computer is never asked', async t => {
  if (!OWN) return t.skip('this machine has no network address to visit from');
  const d = await dashboard({ password: 'open sesame' });
  assert.equal((await ask('https', '127.0.0.1', d.port, '/api/state')).status, 200, 'this computer itself: no password');
  const form = await ask('https', OWN, d.port, '/');
  assert.equal(form.status, 401);
  assert.match(form.body, /<form method="post" action="\/login">/);
  assert.doesNotMatch(form.body, /<script|TOKEN|tracker|agentville|watch|dashboard|farm|world/i, 'a form that says nothing of what is behind it: no name, no hint');
  assert.match(form.body, /<title>Sign in<\/title>/);
  assert.match(form.headers['content-security-policy'], /default-src 'none'/);
  for (const path of ['/api/state', '/api/events', '/api/worlds', '/app.js', '/scene.js', '/live.js', '/colyseus.js', '/worlds/test', '/world/farm/', '/world/sdk/engine.js', '/base.css', '/brand.js', '/nothing-here', `/f/${'0'.repeat(32)}/world/farm/`]) {
    const got = await ask('https', OWN, d.port, path);
    assert.equal(got.status, 401, path);
    assert.doesNotMatch(got.body, /agentville|tracker|world|farm/i, `${path}: the same form, whatever was asked for`);
  }
  assert.equal((await ask('https', OWN, d.port, '/api/state', { method: 'POST' })).body, 'unauthorized');
  assert.equal((await ask('https', OWN, d.port, '/matchmake/joinOrCreate/world', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ world: 'farm' }) })).status, 401, 'no seat in a world either');
  const post = password => ask('https', OWN, d.port, '/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(password)}` });
  const wrong = await post('open says me');
  assert.equal(wrong.status, 401);
  assert.match(wrong.body, /Wrong password/);
  assert.equal(wrong.headers['set-cookie'], undefined);
  const right = await post('open sesame');
  assert.equal(right.status, 303);
  const cookie = right.headers['set-cookie'][0];
  assert.match(cookie, /^session=\d+\.[0-9a-f]{64}; Path=\/; Max-Age=31536000; HttpOnly; SameSite=Strict; Secure$/, 'a pass the page cannot read, sent only to this dashboard, and only over https, under a name that says nothing');
  assert.equal(GUEST_COOKIE, 'session');
  const pass = { cookie: cookie.split(';')[0] };
  assert.equal((await ask('https', OWN, d.port, '/api/state', { headers: pass })).status, 200);
  const page = await ask('https', OWN, d.port, '/', { headers: pass });
  assert.equal(page.status, 200);
  assert.doesNotMatch(page.body, new RegExp(TOKEN), 'in, and still a guest');
  assert.equal((await ask('https', OWN, d.port, '/api/config', { headers: { ...pass, 'x-tracker-token': TOKEN } })).status, 403);
  // A world's frame is sealed and sends no cookie with what it loads: the page is told a pass for its frames' addresses, which opens their files and nothing else.
  const { frames } = JSON.parse((await ask('https', OWN, d.port, '/api/worlds', { headers: pass })).body);
  assert.match(frames, /^\/f\/[0-9a-f]{32}$/);
  const frame = await ask('https', OWN, d.port, `${frames}/world/farm/`);
  assert.equal(frame.status, 200, 'with no cookie at all');
  assert.ok(frame.body.includes(`src="${frames}/world/sdk/engine.js"`) && frame.body.includes(`href="${frames}/base.css"`) && frame.body.includes(`src="${frames}/world/farm/world.js"`), 'and what it loads carries the pass in turn');
  for (const path of ['/world/sdk/engine.js', '/base.css', '/brand.js', '/world/farm/world.js']) assert.equal((await ask('https', OWN, d.port, `${frames}${path}`)).status, 200, path);
  for (const path of ['/api/state', '/app.js', '/', '/colyseus.js']) assert.equal((await ask('https', OWN, d.port, `${frames}${path}`)).status, 401, `${path}: a frame's files only`);
  // the password is changed: the pass is void at once
  const kept = hashPassword('another one');
  d.access.passes = makePasses({ secret: TOKEN, kept });
  d.access.checkPassword = given => checkPassword(given, kept);
  assert.equal((await ask('https', OWN, d.port, '/api/state', { headers: pass })).status, 401);
  // a few wrong tries, then none for a minute, the right one included. Forms sent side by side, each held back
  // until all of them are in, are counted one by one all the same.
  const held = Array.from({ length: 12 }, () => {
    const req = httpsRequest({ host: OWN, port: d.port, path: '/login', method: 'POST', rejectUnauthorized: false, agent: false, headers: { host: `${OWN}:${d.port}`, 'content-type': 'application/x-www-form-urlencoded', 'content-length': 'password=guess'.length } });
    const status = new Promise((resolve, reject) => req.on('response', res => { res.resume(); resolve(res.statusCode); }).on('error', reject));
    req.flushHeaders();
    return { req, status };
  });
  await new Promise(r => setTimeout(r, 400)); // every one of them has been let in, none has sent its form yet
  for (const { req } of held) req.end('password=guess');
  const statuses = await Promise.all(held.map(h => h.status));
  assert.deepEqual([statuses.filter(c => c === 401).length, statuses.filter(c => c === 429).length], [4, 8], 'with the one before, five were tried; the rest were turned away');
  const late = await post('another one');
  assert.equal(late.status, 429);
  assert.match(late.body, /Too many attempts/);
});

test('an address that may not come is let go before a byte is sent; one that no longer may, the moment that is so', async t => {
  if (!OWN) return t.skip('this machine has no network address to visit from');
  let open = true;
  const d = await dashboard({ tls: null, admits: () => open });
  const stream = await new Promise((resolve, reject) => httpRequest({ host: OWN, port: d.port, path: '/api/events', agent: false, headers: { host: `${OWN}:${d.port}` } }, resolve).on('error', reject).end());
  assert.equal(stream.statusCode, 200);
  let ended = false;
  stream.on('close', () => { ended = true; }).on('error', () => { ended = true; }).resume();
  open = false;
  d.srv.recheck();
  for (let i = 0; i < 40 && !ended; i++) await new Promise(r => setTimeout(r, 25));
  assert.equal(ended, true, 'its open stream is closed');
  await assert.rejects(ask('http', OWN, d.port, '/api/state'), 'and it gets no answer at all');
  assert.equal((await ask('http', '127.0.0.1', d.port, '/api/state')).status, 200, 'this computer itself is never shut out');
});

test("when the guests' password changes, every guest's open stream is closed; this computer's stays", async t => {
  if (!OWN) return t.skip('this machine has no network address to visit from');
  const d = await dashboard({ tls: null });
  const open = host => new Promise((resolve, reject) => httpRequest({ host, port: d.port, path: '/api/events', agent: false, headers: { host: `${host}:${d.port}` } }, resolve).on('error', reject).end());
  const guest = await open(OWN), own = await open('127.0.0.1');
  assert.deepEqual([guest.statusCode, own.statusCode], [200, 200]);
  const ended = { guest: false, own: false };
  guest.on('close', () => { ended.guest = true; }).on('error', () => { ended.guest = true; }).resume();
  own.on('close', () => { ended.own = true; }).on('error', () => { ended.own = true; }).resume();
  d.srv.recheck();
  await new Promise(r => setTimeout(r, 100));
  assert.deepEqual(ended, { guest: false, own: false }, 'a change that is not the password lets a guest that may still come stay');
  d.srv.recheck({ guestsOut: true });
  for (let i = 0; i < 40 && !ended.guest; i++) await new Promise(r => setTimeout(r, 25));
  assert.deepEqual(ended, { guest: true, own: false });
  own.destroy();
});
