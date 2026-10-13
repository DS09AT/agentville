// The starter's own looks, as an example of view.js (docs/worlds.md, "view.js"): it draws the ball that
// sim.js rolls along the path. Everything comes through ctx: three.js itself (ctx.THREE), the world's root
// to add to (ctx.root), and what sim.js shares (ctx.shared). Decide nothing here: only show what is so.
(() => {
  'use strict';
  // Raster scenery can use "sprite" in world.json; this template keeps its 3D sphere and figures.
  let ball = null;
  Agentville.view({
    setup(ctx) {
      const { THREE } = ctx;
      ball = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 14), new THREE.MeshLambertMaterial({ color: '#e04a3a' }));
      ball.castShadow = true;
      ball.position.set(3, 0.45, 9.6); // on the path
      ctx.root.add(ball);
    },
    frame(ctx) {
      const x = ctx.shared.ball;
      if (!Number.isFinite(x)) return;
      ball.rotation.z -= (x - ball.position.x) / 0.45; // it rolls as far as it moves
      ball.position.x = x;
    },
    dispose() { ball.geometry.dispose(); ball.material.dispose(); },
  });
})();
