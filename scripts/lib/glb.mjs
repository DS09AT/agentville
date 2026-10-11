// A small writer of .glb files (binary glTF 2.0), for the models the built-in worlds ship with: things made
// of boxes, cylinders and cones in a tree of named nodes, each part in a named material's colour, with
// animations that turn or move the nodes. Enough for a low-poly tree or a figure with the five standard clips
// (docs/worlds.md, "Figures"); a model made in Blender or anywhere else works just as well. No dependencies.

const FLOAT = 5126, UINT16 = 5123, ARRAY_BUFFER = 34962, ELEMENT_ARRAY_BUFFER = 34963;
const linear = c => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4); // a colour's share as light, not as written
/** '#rrggbb' as a material's base colour (linear, with alpha). */
const colour = hex => [...[1, 3, 5].map(i => Number(linear(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(5))), 1];

/** A box of w × h × d centred on `at`: its points, their normals, and its triangles. */
function box([w, h, d], [cx, cy, cz]) {
  const p = [], n = [], idx = [];
  const face = (normal, u, v) => {
    const base = p.length / 3;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const pt = [0, 1, 2].map(i => normal[i] * 0.5 + u[i] * a * 0.5 + v[i] * b * 0.5);
      p.push(cx + pt[0] * w, cy + pt[1] * h, cz + pt[2] * d);
      n.push(...normal);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };
  face([0, 0, 1], [1, 0, 0], [0, 1, 0]); face([0, 0, -1], [-1, 0, 0], [0, 1, 0]);
  face([1, 0, 0], [0, 0, -1], [0, 1, 0]); face([-1, 0, 0], [0, 0, 1], [0, 1, 0]);
  face([0, 1, 0], [1, 0, 0], [0, 0, -1]); face([0, -1, 0], [1, 0, 0], [0, 0, 1]);
  return { p, n, idx };
}
/** A cylinder (top 1) or cone (top 0) of w × h × d centred on `at`, twelve sides, closed at both ends. */
function round([w, h, d], [cx, cy, cz], top) {
  const p = [], n = [], idx = [], N = 12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2, base = p.length / 3;
    const at = (a, r, y) => [cx + Math.sin(a) * r * w * 0.5, cy + y * h, cz + Math.cos(a) * r * d * 0.5];
    p.push(...at(a0, 1, -0.5), ...at(a1, 1, -0.5), ...at(a1, top, 0.5), ...at(a0, top, 0.5)); // a side, flat
    const slope = top ? 0 : (w * 0.5) / h, len = Math.hypot(1, slope);
    for (let k = 0; k < 4; k++) n.push(Math.sin(am) / len, slope / len, Math.cos(am) / len);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    const cap = (y, r, ny) => { // a slice of an end
      const b = p.length / 3;
      p.push(cx, cy + y * h, cz, ...at(a0, r, y), ...at(a1, r, y));
      n.push(0, ny, 0, 0, ny, 0, 0, ny, 0);
      idx.push(...(ny > 0 ? [b, b + 1, b + 2] : [b, b + 2, b + 1]));
    };
    cap(-0.5, 1, -1);
    if (top) cap(0.5, top, 1);
  }
  return { p, n, idx };
}
const SHAPES = { box, cylinder: (size, at) => round(size, at, 1), cone: (size, at) => round(size, at, 0) };

/** A turn about the x, y or z axis by `angle` (radians), as a glTF rotation [x, y, z, w]. */
export const turn = (axis, angle) => { const q = [0, 0, 0, Math.cos(angle / 2)]; q['xyz'.indexOf(axis)] = Math.sin(angle / 2); return q.map(v => Number(v.toFixed(6))); };

/**
 * The bytes of a .glb. `materials`: { Name: '#rrggbb' }. `nodes`: [{ name, parent? (a node's name), at? ([x, y, z],
 * from its parent), parts: [{ shape: 'box' | 'cylinder' | 'cone', size: [w, h, d], at: [x, y, z], material }] }].
 * `animations`: [{ name, tracks: [{ node, path: 'rotation' | 'translation', times: [s…], values: [[…]…] }] }].
 */
export function glb({ materials, nodes, animations = [] }) {
  const chunks = [], views = [], accessors = [];
  let length = 0;
  const view = (typed, target) => {
    const bytes = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength), pad = (4 - (bytes.length % 4)) % 4;
    views.push({ buffer: 0, byteOffset: length, byteLength: bytes.length, ...(target ? { target } : {}) });
    chunks.push(bytes, Buffer.alloc(pad));
    length += bytes.length + pad;
    return views.length - 1;
  };
  const accessor = (typed, type, componentType, target, bounds = false) => {
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type], count = typed.length / size;
    const a = { bufferView: view(typed, target), componentType, count, type };
    if (bounds) { a.min = Array.from({ length: size }, (_, i) => Math.min(...Array.from({ length: count }, (_, k) => typed[k * size + i]))); a.max = Array.from({ length: size }, (_, i) => Math.max(...Array.from({ length: count }, (_, k) => typed[k * size + i]))); }
    accessors.push(a);
    return accessors.length - 1;
  };
  const names = Object.keys(materials), meshes = [];
  const index = new Map(nodes.map((n, i) => [n.name, i]));
  const outNodes = nodes.map(n => {
    const node = { name: n.name, ...(n.at ? { translation: n.at } : {}) };
    const kids = nodes.filter(k => k.parent === n.name).map(k => index.get(k.name));
    if (kids.length) node.children = kids;
    if (n.parts?.length) {
      const primitives = [];
      for (const m of new Set(n.parts.map(part => part.material))) { // one primitive for each material the node has
        const p = [], nn = [], idx = [];
        for (const part of n.parts.filter(q => q.material === m)) {
          const g = SHAPES[part.shape](part.size, part.at ?? [0, 0, 0]), base = p.length / 3;
          p.push(...g.p); nn.push(...g.n); idx.push(...g.idx.map(i => i + base));
        }
        primitives.push({ attributes: { POSITION: accessor(new Float32Array(p), 'VEC3', FLOAT, ARRAY_BUFFER, true), NORMAL: accessor(new Float32Array(nn), 'VEC3', FLOAT, ARRAY_BUFFER) }, indices: accessor(new Uint16Array(idx), 'SCALAR', UINT16, ELEMENT_ARRAY_BUFFER), material: names.indexOf(m) });
      }
      node.mesh = meshes.push({ name: n.name, primitives }) - 1;
    }
    return node;
  });
  const json = {
    asset: { version: '2.0', generator: 'agentville scripts/lib/glb.mjs' },
    scene: 0, scenes: [{ nodes: nodes.filter(n => !n.parent).map(n => index.get(n.name)) }],
    nodes: outNodes, meshes,
    materials: names.map(name => ({ name, pbrMetallicRoughness: { baseColorFactor: colour(materials[name]), metallicFactor: 0, roughnessFactor: 0.9 } })),
    ...(animations.length ? { animations: animations.map(a => {
      const samplers = [], channels = [];
      for (const t of a.tracks) {
        samplers.push({ input: accessor(new Float32Array(t.times), 'SCALAR', FLOAT, undefined, true), output: accessor(new Float32Array(t.values.flat()), t.path === 'rotation' ? 'VEC4' : 'VEC3', FLOAT), interpolation: 'LINEAR' });
        channels.push({ sampler: samplers.length - 1, target: { node: index.get(t.node), path: t.path } });
      }
      return { name: a.name, samplers, channels };
    }) } : {}),
    accessors, bufferViews: views, buffers: [{ byteLength: length }],
  };
  const text = Buffer.from(JSON.stringify(json)), jsonChunk = Buffer.concat([text, Buffer.alloc((4 - (text.length % 4)) % 4, 0x20)]), bin = Buffer.concat(chunks);
  const header = Buffer.alloc(12), head = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
  header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8);
  return Buffer.concat([header, head(jsonChunk.length, 0x4e4f534a), jsonChunk, head(bin.length, 0x004e4942), bin]);
}
