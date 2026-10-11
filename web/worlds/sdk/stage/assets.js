// A world's models and pictures. A frame may fetch nothing (its policy: connect-src 'none'), so each file is
// asked of the page as bytes (docs/worlds.md, "Messages": request, asset) and read here from memory: a .glb
// by three.js's GLTFLoader, a picture as a texture. Each file is asked once and kept. A copy of a model has
// nodes of its own (so two figures don't share a pose) but shares the model's geometry, materials and
// pictures: those are freed once, here, when the world is taken down.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const PICTURE = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg' };

/**
 * `bytes(path)`: a promise of the file's ArrayBuffer (the page's answer), rejecting with why not. Gives
 * { model(path), texture(path), dispose() }.
 */
export function makeAssets({ bytes }) {
  const models = new Map(), textures = new Map();
  // A model's own pictures (inside the .glb) are read by GLTFLoader with fetch(), which the frame's policy
  // forbids even for bytes it already has. With a TextureLoader in its place they load as <img>, which it allows.
  const loader = new GLTFLoader().register(parser => { parser.textureLoader = new THREE.TextureLoader(parser.options.manager); return { name: 'AGENTVILLE_pictures_without_fetch' }; });
  return {
    /** The model as it was read: { scene, animations }. Shared by all who ask: look, don't change. Compressed models (Draco, Meshopt, KTX2) are not read. */
    template(path) {
      if (!models.has(path)) models.set(path, bytes(path).then(buffer => loader.parseAsync(buffer, '')));
      return models.get(path);
    },
    /** A copy of the model: { scene (nodes of its own, to place and to move), animations (its clips, shared) }. */
    async model(path) {
      const gltf = await this.template(path);
      return { scene: cloneSkinned(gltf.scene), animations: gltf.animations };
    },
    /** The picture as a texture, shared by all who ask for it. */
    texture(path) {
      if (!textures.has(path)) {
        textures.set(path, bytes(path).then(async buffer => {
          const bitmap = await createImageBitmap(new Blob([buffer], { type: PICTURE[path.split('.').pop().toLowerCase()] ?? 'image/png' }), { imageOrientation: 'flipY' });
          const texture = new THREE.Texture(bitmap);
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.needsUpdate = true;
          return texture;
        }));
      }
      return textures.get(path);
    },
    dispose() {
      for (const t of textures.values()) void t.then(texture => { texture.image?.close?.(); texture.dispose(); }, () => {});
      for (const m of models.values()) void m.then(gltf => disposeTree(gltf.scene), () => {});
      models.clear();
      textures.clear();
    },
  };
}

/** Frees what an object and everything under it holds on the graphics card: three.js frees nothing by itself. */
export function disposeTree(root) {
  root.traverse(o => {
    o.geometry?.dispose();
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
      m.dispose();
    }
  });
}
