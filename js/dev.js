'use strict';
// Dev harness (§3, §14 subset for steps 1–3): number keys switch presets,
// backtick toggles a Tweakpane panel bound to the live parameters plus a
// stats.js FPS meter. Dev-only: hidden by default, never on the live display,
// and the page renders fine if the CDN scripts fail to load.

const Dev = (() => {
  let pane = null;
  let stats = null;
  let visible = false;

  const GROUPS = {
    Lids: ['lidUpper', 'lidLower', 'lidAsym'],
    Eye: ['pupilSize', 'irisSize', 'eyeScale', 'separation'],
    Layout: ['posX', 'posY'],
    Gaze: ['gazeX', 'gazeY', 'headTilt'],
    Brows: ['browAngle', 'browHeight', 'browArch', 'browVisible'],
    Color: ['irisHue', 'irisSat', 'irisLight', 'scleraBrightness', 'scleraHue',
            'scleraSat', 'catchlightIntensity', 'glowRadius', 'glowIntensity'],
    Motion: ['jitter', 'microsaccadeRate', 'scanRate', 'blinkRate', 'driftSpeed', 'talk',
             'tau', 'pupilAttackMs', 'pupilReleaseMs'],
  };

  function buildPane() {
    pane = new Tweakpane.Pane({ title: 'eyes' });
    pane.element.parentElement.style.zIndex = 10;

    for (const [title, keys] of Object.entries(GROUPS)) {
      const f = pane.addFolder({ title, expanded: title === 'Motion' });
      for (const k of keys) {
        const m = PARAM_META[k];
        f.addInput(Engine.target, k, { min: m.min, max: m.max });
      }
    }

    const fi = pane.addFolder({ title: 'Iris generation', expanded: false });
    for (const k of ['striationCount', 'striationAlpha', 'collaretteU', 'collaretteJag',
                     'foldCount', 'cryptCount', 'ruffWidth', 'limbalBase']) {
      fi.addInput(CONFIG.iris, k);
    }
    fi.addButton({ title: 'Regenerate iris' }).on('click', () => Iris.generate());

    pane.addButton({ title: 'Copy values to clipboard' }).on('click', () => {
      const out = {};
      for (const k of Object.keys(PARAM_META)) {
        out[k] = Math.round(Engine.target[k] * 1000) / 1000;
      }
      navigator.clipboard.writeText(JSON.stringify(out, null, 2));
    });
  }

  function toggle() {
    visible = !visible;
    if (visible && !pane && typeof Tweakpane !== 'undefined') buildPane();
    if (visible && !stats && typeof Stats !== 'undefined') {
      stats = new Stats();
      stats.dom.style.left = 'auto';
      stats.dom.style.right = '0';
      document.body.appendChild(stats.dom);
    }
    if (pane) pane.element.parentElement.style.display = visible ? '' : 'none';
    if (stats) stats.dom.style.display = visible ? '' : 'none';
    document.body.classList.toggle('dev-cursor', visible);
  }

  function buildHelp() {
    const el = document.createElement('div');
    el.id = 'help';
    const rows = PRESET_KEYS.map((name, i) => [String(i + 1), name]);
    rows.push(['`', 'tuning panel'], ['m', 'mirror'], ['?', 'this help']);
    el.textContent = rows.map(([k, label]) => `${k}  ${label}`).join('\n');
    document.body.appendChild(el);
  }

  function onKey(e) {
    if (e.key === '`') { toggle(); return; }
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      document.body.classList.toggle('help');
      return;
    }
    if (e.key === 'm' || e.key === 'M') {
      document.body.classList.toggle('mirror');
      return;
    }
    const idx = parseInt(e.key, 10) - 1;
    if (idx >= 0 && idx < PRESET_KEYS.length) {
      Engine.applyPreset(PRESET_KEYS[idx]);
      if (pane) pane.refresh();
    }
  }

  function frame() {
    if (stats && visible) stats.update();
  }

  function init() {
    window.addEventListener('keydown', onKey);
    if (CONFIG.mirror) document.body.classList.add('mirror');
    buildHelp();
  }

  return { init, frame };
})();
