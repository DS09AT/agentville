// What stands in a world, from its world.json: plain shapes, models and prefabs ("scenery", and each plot's
// own), built as three.js objects. Shapes of one kind and colour are drawn as one instanced mesh, however
// many there are, so a forest costs one draw call. Lengths are metres; the manifest's [x, z] is the ground.
import * as THREE from 'three';

const DEPLOY = { ok: '#2fa57a', failed: '#e04a3a', running: '#f0b429' }, DEPLOY_OTHER = '#9aa4ad';
const PLANE_LIFT = 0.02; // a flat shape lies this far over what it lies on, so the two don't flicker

/** What a plot's thing that shows the repo's state looks like now: { hidden } or { color?, k? } (k: how much of it, 0 to 1). `plot`: { deploy, context, collision, busy }. */
export function shown(shows, plot) {
  if (shows === 'deploy') return plot.deploy ? { color: DEPLOY[plot.deploy] ?? DEPLOY_OTHER } : { hidden: true };
  if (shows === 'context') return { k: Math.max(0.02, Math.min(1, plot.context ?? 0)) };
  if (shows === 'collision') return plot.collision ? {} : { hidden: true };
  if (shows === 'busy') return plot.busy ? {} : { hidden: true };
  return {};
}

/**
 * Every single thing `items` stand for, prefabs taken apart: { kind: 'shape' | 'model', x, y, z, turn, … }, in
 * the world's own measure, around `origin`. `plot`: the state of the repo whose plot they stand on, for the
 * ones that show it. No three.js in it, so it is tested as plain data.
 */
export function flatten(items, prefabs, origin = [0, 0], plot = null) {
  const out = [];
  for (const it of items) {
    const look = it.shows && plot ? shown(it.shows, plot) : {};
    if (look.hidden) continue;
    const meta = it.opens ? { opens: it.opens, tip: it.tip } : it.tip ? { tip: it.tip } : null;
    for (const [ax, az] of it.at) {
      const x = origin[0] + ax, z = origin[1] + az;
      const leaf = (p, px, py, pz, turn, scale) => {
        if (p.kind === 'model') { out.push({ kind: 'model', model: p.model, x: px, y: py, z: pz, turn, scale: scale * p.scale, meta }); return; }
        const size = p.size.map(v => v * scale);
        let lx = 0;
        if (look.k !== undefined) { // so much of it: a shape grows from the ground, a flat one from its left edge
          if (p.shape === 'plane') { lx = -(size[0] * (1 - look.k)) / 2; size[0] *= look.k; } else size[1] *= look.k;
        }
        out.push({ kind: 'shape', shape: p.shape, size, color: look.color ?? p.color, opacity: p.opacity, glow: p.glow || it.glow, x: px + Math.cos(turn) * lx, y: py, z: pz - Math.sin(turn) * lx, turn, meta });
      };
      if (it.kind !== 'use') { leaf(it, x, it.y, z, it.turn, 1); continue; }
      const cos = Math.cos(it.turn), sin = Math.sin(it.turn);
      for (const part of prefabs[it.use]) {
        for (const [px, pz] of part.at) leaf(part, x + (px * cos + pz * sin) * it.scale, it.y + part.y * it.scale, z + (-px * sin + pz * cos) * it.scale, it.turn + part.turn, it.scale);
      }
    }
  }
  return out;
}

export function makeScenery({ world, assets, changed = () => {}, onError = () => {} }) {
  const flat = new THREE.PlaneGeometry(1, 1);
  flat.rotateX(-Math.PI / 2);
  const geometries = { box: new THREE.BoxGeometry(1, 1, 1), cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 20), cone: new THREE.ConeGeometry(0.5, 1, 20), sphere: new THREE.SphereGeometry(0.5, 20, 14), plane: flat };
  const materials = new Map();
  let night = 0;
  function material(color, opacity, glow) {
    const key = `${color}|${opacity}|${glow}`;
    if (!materials.has(key)) {
      const m = new THREE.MeshLambertMaterial({ color, transparent: opacity < 1, opacity });
      if (glow) { m.emissive = new THREE.Color(color); m.emissiveIntensity = night; m.userData.glow = true; }
      materials.set(key, m);
    }
    return materials.get(key);
  }
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

  /**
   * `items` (as readManifest gives them), built around `origin`: a Group. What of it can be clicked or has a tip
   * is found again with metaOf(). The models in it come in as they load.
   */
  function build(items, origin = [0, 0], plot = null) {
    const group = new THREE.Group(), byLook = new Map(), byModel = new Map();
    let gone = false;
    group.userData.release = () => { gone = true; };
    for (const leaf of flatten(items, world.prefabs, origin, plot)) {
      const [map, key] = leaf.kind === 'model' ? [byModel, leaf.model] : [byLook, `${leaf.shape}|${leaf.color}|${leaf.opacity}|${leaf.glow}`];
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(leaf);
    }
    // A model that stands in many places is drawn once for all of them: each of its meshes as one instanced mesh.
    for (const [path, leaves] of byModel) {
      assets.template(path).then(({ scene }) => {
        if (gone) return;
        scene.updateMatrixWorld(true);
        scene.traverse(part => {
          if (!part.isMesh) return;
          const mesh = new THREE.InstancedMesh(part.geometry, part.material, leaves.length);
          leaves.forEach((l, i) => {
            position.set(l.x, l.y, l.z);
            rotation.setFromAxisAngle(UP, l.turn);
            scale.setScalar(l.scale);
            mesh.setMatrixAt(i, matrix.compose(position, rotation, scale).multiply(part.matrixWorld));
          });
          mesh.instanceMatrix.needsUpdate = true;
          mesh.castShadow = mesh.receiveShadow = true;
          mesh.userData.metas = leaves.map(l => l.meta);
          group.add(mesh);
        });
        changed();
      }, err => onError(`${path}: ${err?.message ?? err}`));
    }
    for (const leaves of byLook.values()) {
      const { shape, color, opacity, glow } = leaves[0];
      const mesh = new THREE.InstancedMesh(geometries[shape], material(color, opacity, glow), leaves.length);
      leaves.forEach((l, i) => {
        const [w, h, d] = l.size, isFlat = shape === 'plane';
        position.set(l.x, isFlat ? l.y + PLANE_LIFT : l.y + h / 2, l.z);
        rotation.setFromAxisAngle(UP, l.turn);
        scale.set(w, isFlat ? 1 : h, d);
        mesh.setMatrixAt(i, matrix.compose(position, rotation, scale));
      });
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = shape !== 'plane' && opacity === 1;
      mesh.receiveShadow = true;
      mesh.userData.metas = leaves.map(l => l.meta);
      group.add(mesh);
    }
    return group;
  }
  return {
    build,
    /** What a ray hit, if it can be clicked or has a tip: { opens?, tip? }; else null. */
    metaOf: hit => hit.object.userData.metas?.[hit.instanceId] ?? null,
    /** Frees a group build() made (the geometry and materials in it are shared, the shapes' and the models', and stay). */
    release(group) {
      group.userData.release?.();
      group.removeFromParent();
      for (const o of group.children) o.dispose();
    },
    /** How dark it is, 0 by day to 1 at night: what glows, glows by it. */
    setNight(k) { night = k; for (const m of materials.values()) if (m.userData.glow) m.emissiveIntensity = k; },
    dispose() {
      for (const g of Object.values(geometries)) g.dispose();
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
}
