// The tennis club's own looks (docs/worlds.md, "view.js"): a ball over every court someone works on, rallied
// from one side of the net to the other. Where it is follows from the world's clock alone (ctx.time), which
// every browser has the same, so everyone sees the same rally and nothing has to be sent.
(() => {
  'use strict';
  const balls = new Map(); // a court's bed → its ball
  let shape = null, felt = null;
  Agentville.view({
    setup(ctx) {
      shape = new ctx.THREE.SphereGeometry(0.11, 12, 8);
      felt = new ctx.THREE.MeshLambertMaterial({ color: '#d7f23a' });
    },
    frame(ctx) {
      const busy = new Map();
      for (const a of ctx.scene?.agents ?? []) { const court = a.state === 'working' && a.repo ? ctx.plotOf(a.repo) : null; if (court) busy.set(court.bed, court); }
      for (const [bed, ball] of balls) if (!busy.has(bed)) { ball.removeFromParent(); balls.delete(bed); }
      for (const [bed, court] of busy) {
        if (!balls.has(bed)) { const ball = new ctx.THREE.Mesh(shape, felt); ball.castShadow = true; ctx.root.add(ball); balls.set(bed, ball); }
        const t = ctx.time * 0.9 + bed * 0.37, side = Math.sin(t * Math.PI); // each court's rally a little out of step with the next
        balls.get(bed).position.set(court.x + side * 1.6, 0.35 + Math.abs(Math.cos(t * Math.PI)) * 0.9, court.z + Math.sin(t * 1.7) * 0.5);
      }
    },
    dispose() { shape.dispose(); felt.dispose(); },
  });
})();
