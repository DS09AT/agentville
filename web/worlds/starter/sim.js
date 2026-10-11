// The starter's own rule, as an example of sim.js (docs/worlds.md, "sim.js"): a ball that rolls to and fro along
// the path. What moves is moved here, in tick, and given out in share: the collector runs this file for
// everyone who watches, so they all see the ball in the same place; view.js only draws it.
// No document, no fetch and no timers here: this file must run where there is nothing but the language.
(() => {
  'use strict';
  const ball = { x: 3, dir: 1 };
  Agentville.sim({
    tick(ctx, dt) {
      ball.x += ball.dir * 3 * dt;
      if (ball.x > 41 || ball.x < 3) ball.dir = -ball.dir; // from one end of the path to the other
    },
    share: () => ({ ball: Math.round(ball.x * 8) / 8 }), // rounded: a value is sent again only when it changed
  });
})();
