// The camera over a world: one of four views (world.json, "camera"). iso, tilt and top look down without
// perspective, so near and far are the same size (top is a flat, two-dimensional world); orbit is a
// perspective camera you can turn. At 100% the whole ground is in the frame; zoom, dragging and Follow
// move the view inside the frame, never the frame.
import * as THREE from 'three';

export const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4];
const HEADROOM = 3.5; // metres above the ground that stay in view at 100%: a figure, its name, a tree
const RAD = Math.PI / 180;

/** `size()`: the frame's [width, height] in CSS pixels. */
export function makeCamera({ world, size }) {
  const { w, d } = world.ground, flat = world.camera.view !== 'orbit';
  const camera = flat ? new THREE.OrthographicCamera(-1, 1, 1, -1, -2000, 2000) : new THREE.PerspectiveCamera(40, 1, 0.5, 4000);
  const home = new THREE.Vector3(w / 2, 0, d / 2), target = home.clone(), aim = home.clone(); // aim: where the view is going; target: where it is
  let yaw = world.camera.yaw * RAD, pitch = world.camera.pitch * RAD, zoom = 1, shown = 1, followed = null, moved = true;
  const safe = { left: 0, top: 0 }; // the CSS pixels a panel lies over, from the frame's left and from its top
  const back = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(), corner = new THREE.Vector3();

  /**
   * How much there is to fit: the ground's corners, and the headroom above them. Without perspective, half the
   * height the frame must show (metres) for a frame `aspect` wide, of which only `freeW` of the width and `freeH`
   * of the height are free. With perspective, how far back the camera must stand: what is nearer is larger, so
   * the corner nearest the viewer decides.
   */
  function room(aspect, freeW, freeH) {
    const tan = Math.tan(((camera.fov ?? 0) * RAD) / 2);
    let need = 0;
    for (const x of [0, w]) for (const z of [0, d]) for (const y of [0, HEADROOM]) {
      corner.set(x - home.x, y, z - home.z);
      const u = Math.abs(corner.dot(right)), v = Math.abs(corner.dot(up));
      need = Math.max(need, flat ? Math.max(v / freeH, u / (aspect * freeW)) : corner.dot(back) + Math.max(v / (tan * freeH), u / (tan * aspect * freeW)));
    }
    return need;
  }
  function place() {
    const [fw, fh] = size(), aspect = fw / Math.max(1, fh);
    back.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)); // from the target back to the camera
    right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    up.crossVectors(back, right);
    // At 100% the ground keeps clear of the panel over the frame's top left: it sits beside the panel or below
    // it, whichever leaves it bigger.
    const keep = Math.max(0, Math.min(1, (1.25 - shown) / 0.25)); // all of the panel's room at 100%, none from 125% on: zooming in does not jump
    const freeW = Math.max(0.3, 1 - (keep * safe.left) / Math.max(1, fw)), freeH = Math.max(0.3, 1 - (keep * safe.top) / Math.max(1, fh));
    const beside = room(aspect, freeW, 1), below = room(aspect, 1, freeH), isBelow = below < beside;
    const fit = (Math.min(beside, below) * 1.04) / shown;
    const dist = flat ? 600 : fit, half = flat ? fit : fit * Math.tan((camera.fov * RAD) / 2); // half: half the height of what is in view, at the target
    if (flat) { camera.left = -half * aspect; camera.right = half * aspect; camera.top = half; camera.bottom = -half; } else camera.aspect = aspect;
    camera.position.copy(target).addScaledVector(back, dist);
    if (isBelow) camera.position.addScaledVector(up, (1 - freeH) * half); else camera.position.addScaledVector(right, -(1 - freeW) * half * aspect); // half the panel's size, the other way
    camera.up.set(0, 1, 0);
    if (pitch > 89 * RAD) camera.up.set(-Math.sin(yaw), 0, -Math.cos(yaw)); // straight down: "up" on screen is away from the viewer
    camera.lookAt(camera.position.x - back.x, camera.position.y - back.y, camera.position.z - back.z);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }
  /** How many metres one CSS pixel is, at the target's depth. */
  function metresPerPixel() {
    const [, fh] = size();
    return flat ? (camera.top - camera.bottom) / Math.max(1, fh) : (2 * camera.position.distanceTo(target) * Math.tan((camera.fov * RAD) / 2)) / Math.max(1, fh);
  }
  place();
  return {
    camera, flat,
    get zoom() { return zoom; },
    /** Whether the view is not where it settles yet: it is drawn every frame until it is. */
    get moving() { return moved; },
    /** Eases the view to where it is going; dt 0 puts it there at once. */
    update(dt) {
      if (followed) aim.set(followed.x, 0, followed.z);
      const k = dt ? 1 - Math.exp(-dt * 9) : 1;
      const before = shown + target.x * 7 + target.z * 13;
      shown += (zoom - shown) * k;
      target.lerp(aim, k);
      if (Math.abs(zoom - shown) < 0.001) shown = zoom;
      if (target.distanceTo(aim) < 0.005) target.copy(aim);
      const changed = moved || before !== shown + target.x * 7 + target.z * 13;
      if (changed) place();
      moved = shown !== zoom || !target.equals(aim);
      return changed;
    },
    resize() { moved = true; },
    /** The panel over the frame's top left: how far it reaches from the left and from the top (CSS pixels; 0, 0 for none). */
    setSafe(left, top) { if (left !== safe.left || top !== safe.top) { safe.left = left; safe.top = top; moved = true; } },
    /** Zoom: a step in or out of ZOOMS (step ±1), or back to the whole world (0, which also lets go of where you dragged to). */
    zoomBy(step) {
      if (step === 0) { zoom = 1; aim.copy(home); followed = null; } else zoom = ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.reduce((best, z, i) => (Math.abs(z - zoom) < Math.abs(ZOOMS[best] - zoom) ? i : best), 0) + step))];
      moved = true;
    },
    setZoom(z) { zoom = Math.max(ZOOMS[0], Math.min(ZOOMS.at(-1), z)); moved = true; },
    /** Dragging: the view moves with the pointer, by so many CSS pixels. */
    panBy(dx, dy) {
      const m = metresPerPixel(), slope = Math.max(0.2, Math.sin(pitch));
      aim.addScaledVector(right, -dx * m);
      aim.x += (Math.sin(yaw) * dy * m) / slope * -1;
      aim.z += (Math.cos(yaw) * dy * m) / slope * -1;
      aim.x = Math.max(-w * 0.25, Math.min(w * 1.25, aim.x));
      aim.z = Math.max(-d * 0.25, Math.min(d * 1.25, aim.z));
      target.copy(aim);
      followed = null;
      moved = true;
    },
    /** Turning (the orbit view only): by so many CSS pixels. */
    turnBy(dx, dy) {
      if (flat) return;
      yaw -= dx * 0.006;
      pitch = Math.max(12 * RAD, Math.min(85 * RAD, pitch + dy * 0.005));
      moved = true;
    },
    /** Keeps `body` ({ x, z }, read each frame) in the middle of the view; null lets go. */
    follow(body) { followed = body; if (body && zoom < 2) zoom = 2; moved = true; },
    get following() { return Boolean(followed); },
  };
}
