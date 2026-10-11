// The figures: one for each agent. Every world's figures move the same five ways, by name: idle, walk, work,
// wait and sleep (docs/worlds.md, "Figures"). Without a model of its own a world gets the kit's person, built
// here from a few boxes and moved by the clock; with one ("figure.model", a .glb), the model's clips of those
// names are played. Each has its agent's colour, and its subagents as small orbs beside it.
import * as THREE from 'three';

export const MOVES = ['idle', 'walk', 'work', 'wait', 'sleep'];
const SKIN = '#e0a878', DARK = '#3a3a40', STALE = '#9aa4ad';

/** The move an agent is shown in: walking wherever it goes; else by its state. */
export function moveOf(agent, walking) {
  if (walking) return 'walk';
  if (agent.nap || agent.state === 'idle' || agent.state === 'stale') return 'sleep';
  return agent.state === 'waiting' ? 'wait' : agent.state === 'working' ? 'work' : 'idle';
}

// The kit's person, as joint angles (radians) for a move at time t: { hips (height, as a share of the leg), lean, legL, legR, armL, armR, head, bob }.
const POSES = {
  idle: t => ({ hips: 1, lean: 0, legL: 0, legR: 0, armL: 0.05 * Math.sin(t * 1.3), armR: -0.05 * Math.sin(t * 1.3), head: 0, bob: 0.008 * Math.sin(t * 2) }),
  walk: t => ({ hips: 1, lean: 0.06, legL: 0.6 * Math.sin(t * 8), legR: -0.6 * Math.sin(t * 8), armL: -0.5 * Math.sin(t * 8), armR: 0.5 * Math.sin(t * 8), head: 0, bob: 0.025 * Math.abs(Math.sin(t * 8)) }),
  work: t => ({ hips: 1, lean: 0.12, legL: 0, legR: 0, armL: -1.15 + 0.3 * Math.sin(t * 6), armR: -1.15 - 0.3 * Math.sin(t * 6), head: 0.2, bob: 0 }),
  wait: t => ({ hips: 1, lean: 0, legL: 0, legR: 0, armL: 0, armR: -2.7 + 0.35 * Math.sin(t * 7), head: -0.1, bob: 0.03 * Math.abs(Math.sin(t * 3.5)) }),
  sleep: t => ({ hips: 0.24, lean: -0.3, legL: -1.5, legR: -1.5, armL: -0.2, armR: -0.2, head: 0.5, bob: 0.006 * Math.sin(t * 1.2) }),
};

export function makeFigures({ world, assets, changed = () => {}, onError = () => {} }) {
  const H = world.figure.height, leg = H * 0.38, torso = H * 0.36, head = H * 0.15; // sturdy, with a large head: it reads at a distance
  const box = new THREE.BoxGeometry(1, 1, 1), ball = new THREE.SphereGeometry(1, 16, 12), orb = new THREE.SphereGeometry(H * 0.09, 12, 8);
  const materials = new Map();
  const material = color => { if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color })); return materials.get(color); };
  // A limb hangs from its joint: the joint is a group at the hip or shoulder, the box below it. (It casts no shadow
  // of its own: the chest's and the head's are the figure's, at half the cost.)
  function limb(parent, x, y, w, h, color) {
    const joint = new THREE.Group(), part = new THREE.Mesh(box, material(color));
    joint.position.set(x, y, 0);
    part.scale.set(w, h, w);
    part.position.y = -h / 2;
    joint.add(part);
    parent.add(joint);
    return { joint, part };
  }

  /** The kit's person. */
  function person(agent) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const chest = new THREE.Mesh(box, material(agent.color));
    chest.scale.set(H * 0.36, torso, H * 0.22);
    chest.position.y = torso / 2;
    chest.castShadow = true;
    const neck = new THREE.Group(), face = new THREE.Mesh(ball, material(SKIN)), visor = new THREE.Mesh(box, material(DARK));
    neck.position.y = torso;
    face.scale.setScalar(head);
    face.position.y = head * 0.95;
    face.castShadow = true;
    visor.scale.set(head * 1.3, head * 0.3, head * 0.5); // a dark band over the eyes: which way it looks
    visor.position.set(0, head * 1.1, head * 0.8);
    neck.add(face, visor);
    body.add(chest, neck);
    const legs = [limb(root, -H * 0.095, leg, H * 0.14, leg, DARK), limb(root, H * 0.095, leg, H * 0.14, leg, DARK)];
    const arms = [limb(body, -H * 0.24, torso * 0.95, H * 0.11, torso * 0.9, agent.color), limb(body, H * 0.24, torso * 0.95, H * 0.11, torso * 0.9, agent.color)];
    const hand = new THREE.Group(); // what it holds for its step hangs here
    hand.position.y = -torso * 0.9;
    arms[1].joint.add(hand);
    const pose = { ...POSES.idle(0) };
    let stale = false;
    return {
      object: root, hand, height: H,
      /** `move`: one of MOVES; `t`: the world's clock (s); `k`: how far to ease towards the move's pose this frame (1: at once). */
      animate(move, t, k) {
        const want = POSES[move](stale ? 0 : t);
        for (const j of Object.keys(pose)) pose[j] += (want[j] - pose[j]) * k;
        body.position.y = leg * pose.hips + H * pose.bob;
        body.rotation.x = pose.lean;
        legs[0].joint.position.y = legs[1].joint.position.y = leg * pose.hips;
        legs[0].joint.rotation.x = pose.legL;
        legs[1].joint.rotation.x = pose.legR;
        arms[0].joint.rotation.x = pose.armL;
        arms[1].joint.rotation.x = pose.armR;
        neck.rotation.x = pose.head;
      },
      /** Greyed, and still: an agent gone stale. */
      setStale(on) {
        if (on === stale) return;
        stale = on;
        chest.material = arms[0].part.material = arms[1].part.material = material(on ? STALE : agent.color);
      },
      dispose() { root.removeFromParent(); },
    };
  }

  /** A world's own figure, from its model: scaled to the figure's height, its clips played by the names in "figure.clips". */
  function modelled(agent, { scene, animations }) {
    const root = new THREE.Group();
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3());
    if (size.y > 0) scene.scale.multiplyScalar(H / size.y);
    root.add(scene);
    const own = []; // materials made for this agent alone
    scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (world.figure.tint && o.material?.name === world.figure.tint) { o.material = o.material.clone(); o.material.color.set(agent.color); o.userData.tint = o.material.color.clone(); own.push(o.material); }
    });
    const mixer = new THREE.AnimationMixer(scene), actions = {};
    for (const move of MOVES) { const clip = animations.find(c => c.name === world.figure.clips[move]); if (clip) actions[move] = mixer.clipAction(clip); }
    // What it holds hangs from the node the manifest names ("figure.hand"), at its own size whatever the model's
    // scale; a model that names none holds it before its middle.
    const hand = new THREE.Group(), grip = world.figure.hand ? scene.getObjectByName(world.figure.hand) : null;
    if (grip) {
      root.updateMatrixWorld(true);
      const scale = grip.getWorldScale(new THREE.Vector3());
      hand.scale.set(1 / scale.x, 1 / scale.y, 1 / scale.z);
      grip.add(hand);
    } else {
      hand.position.set(0, H * 0.5, H * 0.2);
      root.add(hand);
    }
    let playing = null, last = null, stale = false;
    return {
      object: root, hand, height: H,
      animate(move, t, k) {
        const next = actions[move] ?? actions.idle ?? null;
        if (next !== playing) {
          if (playing) playing.fadeOut(k >= 1 ? 0 : 0.25);
          if (next) next.reset().fadeIn(k >= 1 ? 0 : 0.25).play();
          playing = next;
        }
        mixer.update(stale || last === null ? 0 : Math.max(0, t - last));
        last = t;
      },
      setStale(on) {
        if (on === stale) return;
        stale = on;
        scene.traverse(o => { if (o.userData.tint) o.material.color.set(on ? STALE : o.userData.tint); });
      },
      dispose() { mixer.stopAllAction(); mixer.uncacheRoot(scene); root.removeFromParent(); for (const m of own) m.dispose(); }, // (the model's geometry is shared with its other copies: assets.js frees it)
    };
  }

  return {
    /**
     * A figure for an agent: { object, height, hand, animate(move, t, k), setStale(on), setKids(n, t), dispose() }.
     * A world with a model of its own gets the kit's person until the model has loaded, and if it can't be.
     */
    create(agent) {
      const group = new THREE.Group(), kids = [];
      let inner = person(agent), gone = false;
      group.add(inner.object);
      if (world.figure.model) {
        assets.model(world.figure.model).then(gltf => {
          if (gone) return;
          const next = modelled(agent, gltf);
          for (const held of [...inner.hand.children]) next.hand.add(held); // what it holds goes over to the new figure's hand
          inner.dispose();
          inner = next;
          group.add(inner.object);
          changed();
        }, err => onError(`${world.figure.model}: ${err?.message ?? err}`));
      }
      return {
        object: group, height: H,
        get hand() { return inner.hand; },
        animate: (move, t, k) => inner.animate(move, t, k),
        setStale: on => inner.setStale(on),
        /** Its running subagents, as so many small orbs circling beside it. */
        setKids(n, t) {
          while (kids.length < n) { const m = new THREE.Mesh(orb, material('#ffffff')); m.castShadow = true; kids.push(m); group.add(m); }
          while (kids.length > n) kids.pop().removeFromParent();
          kids.forEach((m, i) => { const a = t * 1.2 + (i / Math.max(1, kids.length)) * Math.PI * 2; m.position.set(Math.sin(a) * H * 0.42, H * 0.3 + Math.sin(t * 3 + i) * H * 0.04, Math.cos(a) * H * 0.42); });
        },
        dispose() { gone = true; inner.dispose(); group.removeFromParent(); },
      };
    },
    dispose() {
      box.dispose(); ball.dispose(); orb.dispose();
      for (const m of materials.values()) m.dispose();
      materials.clear();
    },
  };
}
