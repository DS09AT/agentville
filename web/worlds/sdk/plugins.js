// How a world of api 2 hands in its own code: sim.js calls Agentville.sim(hooks) (its rules for who stands
// where; the collector runs it too), view.js calls Agentville.view(hooks) (its own looks, in the frame only).
// Each once, each an object of hooks (docs/worlds.md, "sim.js" and "view.js"). The frame loads this before
// them, the collector before sim.js. Classic script, no dependencies.
(() => {
  'use strict';
  const A = (globalThis.Agentville = globalThis.Agentville ?? {});
  const plugins = {};
  const register = kind => hooks => {
    if (Object.hasOwn(plugins, kind)) throw new Error(`${kind}.js registered twice.`);
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) throw new Error(`Agentville.${kind}() takes an object of hooks.`);
    plugins[kind] = hooks;
  };
  A.sim = register('sim');
  A.view = register('view');
  A.plugins = plugins;
})();
