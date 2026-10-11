// Who may open the dashboard from the network (the "Let others on your network watch" setting), beyond that
// switch: which addresses, and whether they must give a password first. All of it is the collector's own: a
// guest is checked before it is sent anything, and never gets more for passing than a guest gets.
import { BlockList, isIPv4 } from 'node:net';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Addresses that are not the internet's: private networks, link-local, and the range VPNs like Tailscale use.
const PRIVATE = [['10.0.0.0', 8], ['172.16.0.0', 12], ['192.168.0.0', 16], ['169.254.0.0', 16], ['100.64.0.0', 10]];

/** An entry of a list: an IPv4 address ("192.168.1.20") or a range ("192.168.1.0/24"). Null for anything else. */
export function parseEntry(text) {
  const m = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(String(text ?? '').trim());
  if (!m || !isIPv4(m[1])) return null;
  const bits = m[2] === undefined ? null : Number(m[2]);
  return bits !== null && bits > 32 ? null : { address: m[1], bits };
}
function listOf(entries) {
  const list = new BlockList();
  for (const e of entries.map(parseEntry).filter(Boolean)) { if (e.bits === null) list.addAddress(e.address); else list.addSubnet(e.address, e.bits); }
  return list;
}
const v4 = address => String(address ?? '').replace(/^::ffff:/, '');

/**
 * Which addresses may come as guests. `allow` empty: any private address, never a public one. `allow` given: those
 * addresses and ranges only (a public one too, if you name it; an entry that is no address admits no one). `block`:
 * refused whatever else says.
 * Gives address => true | false. This computer itself is not asked here.
 */
export function makeAdmits({ allow = [], block = [] } = {}) {
  // A blocked entry that is no address (a slip in config.json; the Settings window refuses one) can't be kept out: nobody comes until it is put right.
  if (block.some(e => !parseEntry(e))) return () => false;
  const allowed = allow.length ? listOf(allow) : listOf(PRIVATE.map(([a, b]) => `${a}/${b}`)), blocked = listOf(block);
  return address => { const a = v4(address); return isIPv4(a) && !blocked.check(a) && allowed.check(a); };
}

/** A password as it is kept: never itself, but what scrypt makes of it with a salt of its own. */
export function hashPassword(password) {
  const salt = randomBytes(16);
  return { salt: salt.toString('hex'), hash: scryptSync(String(password), salt, 32).toString('hex') };
}
export function checkPassword(password, kept) {
  if (typeof kept?.salt !== 'string' || typeof kept?.hash !== 'string' || typeof password !== 'string' || password.length > 1000) return false;
  const want = Buffer.from(kept.hash, 'hex'), got = scryptSync(password, Buffer.from(kept.salt, 'hex'), 32);
  return want.length === got.length && timingSafeEqual(want, got);
}

export const GUEST_COOKIE = 'session'; // a name that says nothing of what is behind it
const PASS_DAYS = 365;
/**
 * A guest's pass, once it gave the password: "until.signature", signed with a key made of the collector's token
 * and the password as kept. So it needs no list (it holds through a restart: a kiosk is not asked again), and
 * every pass is void the moment the password is changed or removed.
 */
export function makePasses({ secret, kept }) {
  const key = createHmac('sha256', String(secret)).update(`guest:${kept.salt}:${kept.hash}`).digest();
  const sign = until => createHmac('sha256', key).update(String(until)).digest('hex');
  // What a world's frame loads can carry no cookie (a frame is sealed, its scripts fetched without credentials):
  // those addresses carry this instead, in their path. It opens a frame's files and nothing else.
  const frame = createHmac('sha256', key).update('frame').digest('hex').slice(0, 32);
  return {
    frame,
    validFrame: value => typeof value === 'string' && value.length === frame.length && timingSafeEqual(Buffer.from(value), Buffer.from(frame)),
    issue: (now = Date.now()) => { const until = now + PASS_DAYS * 86_400_000; return { value: `${until}.${sign(until)}`, maxAge: PASS_DAYS * 86_400 }; },
    valid(value, now = Date.now()) {
      const [until, signature] = String(value ?? '').split('.');
      if (!/^\d{1,16}$/.test(until ?? '') || !/^[0-9a-f]{64}$/.test(signature ?? '') || Number(until) < now) return false;
      return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(sign(until), 'hex'));
    },
  };
}
/** A cookie's value from a request's Cookie header. */
export const cookieOf = (header, name) => String(header ?? '').split(';').map(p => p.trim().split('=')).find(([k]) => k === name)?.slice(1).join('=') ?? null;

/** Tries to log in, counted by address: a few in a minute, then none until the minute is over. */
export function makeAttempts({ max = 5, windowMs = 60_000 } = {}) {
  const tried = new Map();
  return {
    allowed(address, now = Date.now()) {
      const recent = (tried.get(address) ?? []).filter(at => now - at < windowMs);
      tried.set(address, recent);
      if (tried.size > 500) for (const [k, v] of tried) if (!v.some(at => now - at < windowMs)) tried.delete(k);
      return recent.length < max;
    },
    failed(address, now = Date.now()) { tried.set(address, [...(tried.get(address) ?? []), now]); },
  };
}
