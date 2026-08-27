'use strict';
// Boot + frame loop. requestAnimationFrame, delta-time based, dt clamped to
// ~50ms (§5.3) so a background-tab hiccup can't launch a saccade to Mars.

(() => {
  const canvas = document.getElementById('stage');

  Renderer.init(canvas);
  Iris.generate();
  Engine.applyPreset('dormant');
  Dev.init();

  window.addEventListener('resize', () => Renderer.resize());

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;

    Engine.step(dt);
    Life.apply(dt, Engine.current, Engine.display, Engine.intensity);
    Renderer.render(Engine.display, Oneshots.blackout);
    Dev.frame();

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
