// Small things the SDK's modules share: numbers, text, and random numbers from a seed. No DOM and no three.js
// in it, so the collector runs it too.

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const lerp = (a, b, k) => a + (b - a) * k;
export const dist = (ax, az, bx, bz) => Math.hypot(bx - ax, bz - az);

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** A name shortened in the middle, so both ends stay readable: inventory_management → inventor…agement. */
export function cutMid(s, n) {
  const t = String(s ?? '');
  if (t.length <= n) return t;
  const head = Math.ceil((n - 1) / 2);
  return `${t.slice(0, head)}…${t.slice(t.length - (n - 1 - head))}`;
}
export const clip = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
/** How long ago, in a word: now, 5m, 2h, 3d. */
export function ago(ms, now = Date.now()) {
  const m = Math.max(0, (now - ms) / 60_000);
  return m < 1 ? 'now' : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
}

/** A number from a text: the same text, the same number, in every browser and on the collector. */
export function hashOf(text) {
  let h = 2166136261;
  const s = String(text);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
}
/** Random numbers from a seed (mulberry32): the same run of them wherever it is asked. */
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
