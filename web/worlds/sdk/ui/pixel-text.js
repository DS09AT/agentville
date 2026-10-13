// Shared raster lettering for every world.
'use strict';
const uiEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// A hand-drawn 5×9 font (rows 0–6 above the line, 7–8 below): each glyph is its width, then
// nine rows as base-32 bit patterns. Text in it is an image; the words stay in the page too.
const FONT = {'A': '5ehhvhhh00', 'B': '5uhhuhhu00', 'C': '5ehggghe00', 'D': '5uhhhhhu00', 'E': '5vgguggv00', 'F': '5vgguggg00', 'G': '5ehgnhhf00', 'H': '5hhhvhhh00', 'I': '3722222700', 'J': '57222iic00', 'K': '5hikokih00', 'L': '5ggggggv00', 'M': '5hrllhhh00', 'N': '5hpljhhh00', 'O': '5ehhhhhe00', 'P': '5uhhuggg00', 'Q': '5ehhhlid00', 'R': '5uhhukih00', 'S': '5ehge1he00', 'T': '5v44444400', 'U': '5hhhhhhe00', 'V': '5hhhhha400', 'W': '5hhhllrh00', 'X': '5hha4ahh00', 'Y': '5hha444400', 'Z': '5v1248gv00', 'a': '500e1fhf00', 'b': '5gguhhhu00', 'c': '4007888700', 'd': '511fhhhf00', 'e': '500ehvge00', 'f': '3347444400', 'g': '500fhhhf1e', 'h': '5gguhhhh00', 'i': '1101111100', 'j': '3101111152', 'k': '4889aca900', 'l': '2222222100', 'm': '500qllll00', 'n': '500uhhhh00', 'o': '500ehhhe00', 'p': '500uhhhugg', 'q': '500fhhhf11', 'r': '400bc88800', 's': '500fge1u00', 't': '444e444300', 'u': '500hhhhf00', 'v': '500hhha400', 'w': '500hhlla00', 'x': '500ha4ah00', 'y': '500hhhhf1e', 'z': '500v248v00', '0': '5ehjlphe00', '1': '3262222700', '2': '5eh1248v00', '3': '5v2421he00', '4': '526aiv2200', '5': '5vgu11he00', '6': '568guhhe00', '7': '5v12488800', '8': '5ehhehhe00', '9': '5ehhf12c00', ' ': '3000000000', '!': '1111110100', '"': '3550000000', '#': '5aavavaa00', '$': '54fke5u400', '%': '5pp248jj00', '&': '5cik8lid00', '\'': '1110000000', '(': '2122222100', ')': '2211111200', '*': '504lel4000', '+': '5044v44000', ',': '2000001120', '-': '4000f00000', '.': '1000000100', '/': '5122488g00', ':': '1001001000', ';': '2001001120', '<': '4124842100', '=': '400f0f0000', '>': '4842124800', '?': '5eh1240400', '@': '5ehnlnge00', '[': '2322222300', '\\': '5g88422100', ']': '2311111300', '^': '54ah000000', '_': '5000000v00', '`': '2210000000', '{': '4344844300', '|': '1111111100', '}': '4c22122c00', '~': '5008l20000', '♥': '50avve4000', '♡': '50alha4000', '✓': '5012ic8000', '✗': '50ha4ah000', '◌': '50ah0ha000', '⏸': '50rrrrr000', '↑': '54el444400', '↓': '54444le400', '…': '5000000l00', '⚠': '54aalhlv00', '·': '1000100000', '—': '5000v00000', '–': '4000f00000', '’': '2120000000', '‘': '2210000000', '“': '3550000000', '”': '3550000000'};
/** A glyph: { w, rows } with each row a bit pattern (leftmost pixel = highest bit), or null. */
const glyphOf = ch => { const g = FONT[ch]; return g ? { w: Number(g[0]), rows: [...g.slice(1)].map(c => parseInt(c, 32)) } : null; };
/** A text's width in font pixels (a pixel between letters), or null when a character has no glyph. */
function textWidth(text) {
  let w = 0, n = 0;
  for (const ch of text) { const g = glyphOf(ch); if (!g) return null; w += g.w; n++; }
  return n ? w + n - 1 : 0;
}
const textImages = new Map();
/** A text drawn in the pixel font with a one-pixel shadow, as { url, w, h } (font pixels), or null. */
function textImage(text, color, shadow) {
  const key = `${text}\n${color}\n${shadow}`;
  if (textImages.has(key)) return textImages.get(key);
  const w = textWidth(text);
  if (w === null || !text || typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w + 1;
  c.height = 10;
  const g = c.getContext('2d');
  for (const [dx, col] of [...(shadow ? [[1, shadow]] : []), [0, color]]) {
    g.fillStyle = col;
    let x = 0;
    for (const ch of text) {
      const gl = glyphOf(ch);
      gl.rows.forEach((bits, y) => { for (let i = 0; i < gl.w; i++) if (bits & (1 << (gl.w - 1 - i))) g.fillRect(x + i + dx, y + dx, 1, 1); });
      x += gl.w + 1;
    }
  }
  const img = { url: c.toDataURL(), w: w + 1, h: 10 };
  if (textImages.size > 600) textImages.clear();
  textImages.set(key, img);
  return img;
}
/** Pixels per font pixel on screen: 1.5 on a Retina screen (3 device pixels), 2 on a plain one, so it stays sharp. */
const fontPx = () => { const dpr = window.devicePixelRatio || 1; return Math.max(1, Math.round(1.5 * dpr)) / dpr; };
/** A text in the pixel font as an image only (hidden from screen readers), or the plain text if it has a letter the font lacks. */
const SMALL_TEXT = 2 / 3; // the smaller size a text may be drawn at: whole device pixels again, so it stays crisp
function pxImg(text, color = '#f4ecd8', shadow = '#1b1420', size = 1) {
  const t = String(text ?? '');
  const img = textImage(t, color, shadow);
  if (!img) return `<span aria-hidden="true">${uiEsc(t)}</span>`;
  const s = fontPx() * size;
  return `<i class="pxt" aria-hidden="true" style="width:${(img.w * s).toFixed(1)}px;height:${(img.h * s).toFixed(1)}px;background-image:url(${img.url})"></i>`;
}
/** HTML for a text in the pixel font (its words stay for screen readers, copying and search), or plain text if it has a letter the font lacks. */
function pxt(text, color = '#f4ecd8', shadow = '#1b1420', size = 1) {
  const t = String(text ?? '');
  return textImage(t, color, shadow) ? `${pxImg(t, color, shadow, size)}<span class="px-sr">${uiEsc(t)}</span>` : uiEsc(t);
}


window.Agentville.pixelText = { pxt, pxImg, textImage, textWidth, glyphOf };
