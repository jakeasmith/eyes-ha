'use strict';
// Dev harness (§3, §14): left-hand-first keyboard control plus a Tweakpane
// panel and stats.js FPS meter behind backtick. Dev-only: hidden by default,
// never on the live display, and the page renders fine if the CDN scripts
// fail to load.
//
// One BINDINGS table drives both the key handler and the ? overlay, so the
// help can't drift from the real map. Everything night-critical sits under
// the left hand; m and ? are rare enough to live on the right.

const Dev = (() => {
  let pane = null;
  let stats = null;
  let visible = false;
  const devState = { intensity: 0.5, zone: 'away' };

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

  const refresh = () => { if (pane) pane.refresh(); };

  function preset(name) {
    Engine.applyPreset(name);
    refresh();
  }

  function cycleZone() {
    const order = Object.keys(ZONES);
    const next = order[(order.indexOf(Engine.activeZone) + 1) % order.length];
    Engine.setGazeZone(next);
    devState.zone = next;
    refresh();
  }

  function bumpIntensity(d) {
    devState.intensity = Math.min(1, Math.max(0, Engine.intensityTarget + d));
    Engine.setIntensity(devState.intensity);
    refresh();
  }

  function toggleHelp() {
    document.body.classList.toggle('help');
  }

  // [key, label, action] — gentle doubles as the §13 override (cancels all
  // one-shots), so it needs no separate preset key.
  const BINDINGS = [
    ['1', 'dormant', () => preset('dormant')],
    ['2', 'stirring', () => preset('stirring')],
    ['3', 'watching', () => preset('watching')],
    ['4', 'curious', () => preset('curious')],
    ['5', 'narrowed', () => preset('narrowed')],
    ['q', 'rage', () => preset('rage')],
    ['w', 'speaking', () => preset('speaking')],
    ['g', 'gentle (cancels all)', () => { Oneshots.gentle(); refresh(); }],
    ['s', 'sleep', () => { Oneshots.sleep(); refresh(); }],
    ['f', 'lunge', () => Oneshots.lunge()],
    ['shift', 'lunge while held', null],
    ['v', 'vanish', () => Oneshots.vanish()],
    ['d', 'drop / rise', () => Oneshots.drop()],
    ['e', 'next gaze zone', cycleZone],
    ['a', 'intensity +', () => bumpIntensity(0.05)],
    ['z', 'intensity −', () => bumpIntensity(-0.05)],
    ['`', 'tuning panel', () => toggle()],
    ['m', 'mirror', () => document.body.classList.toggle('mirror')],
    ['?', 'this help', toggleHelp],
  ];
  const ACTIONS = new Map(BINDINGS.filter(([, , fn]) => fn).map(([k, , fn]) => [k, fn]));

  function buildPane() {
    pane = new Tweakpane.Pane({ title: 'eyes' });
    pane.element.parentElement.style.zIndex = 10;

    for (const [title, keys] of Object.entries(GROUPS)) {
      const f = pane.addFolder({ title, expanded: title === 'Motion' });
      for (const k of keys) {
        const m = PARAM_META[k];
        f.addInput(Engine.target, k, { min: m.min, max: m.max });
      }
      if (title === 'Gaze') {
        const opts = {};
        for (const z of Object.keys(ZONES)) opts[z] = z;
        f.addInput(devState, 'zone', { options: opts })
          .on('change', (ev) => Engine.setGazeZone(ev.value));
      }
    }

    pane.addInput(devState, 'intensity', { min: 0, max: 1 })
      .on('change', (ev) => Engine.setIntensity(ev.value));

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
    el.textContent = BINDINGS.map(([k, label]) => `${k}  ${label}`).join('\n');
    document.body.appendChild(el);
  }

  function onKey(e) {
    if (e.key === 'Shift') {
      if (!e.repeat) Oneshots.lungeStart();
      return;
    }
    if (e.key === '/' && e.shiftKey) { toggleHelp(); return; } // '?' variant
    const fn = ACTIONS.get(e.key.toLowerCase());
    if (fn) fn();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') Oneshots.lungeEnd();
  }

  function frame() {
    if (stats && visible) stats.update();
  }

  function init() {
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    // A missed keyup (focus lost mid-hold) must not leave a lunge stuck.
    window.addEventListener('blur', () => Oneshots.lungeEnd());
    if (CONFIG.mirror) document.body.classList.add('mirror');
    buildHelp();
  }

  return { init, frame };
})();
