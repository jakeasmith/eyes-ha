'use strict';
// Projection calibration (§4.4). The projector never sits square to the
// window, so the content rect is corner-pinned onto the glass: a projective
// transform (CSS matrix3d) maps the content's four corners onto four pins, and
// everything outside the pinned quad stays page black — no spill on the wall.
//
// Two calibrated values, saved in this browser's localStorage so they survive
// reloads on the display machine:
//   corners — TL, TR, BR, BL as fractions of the viewport (survive resolution
//             and fullscreen changes)
//   aspect  — content width / height. Perspective hides the window's true
//             proportions, so it is set by eye: nudge until the calibration
//             grid's cells look square on the glass.
// Uncalibrated, the content fills the viewport with no transform at all.

const Projection = (() => {
  const STORE_KEY = 'eyes.projection';
  const GRID_ROWS = 6;

  let warp = null;
  let grid = null;
  let pins = [];
  let hint = null;
  let cal = null;
  let active = false;
  let selected = 0;
  let size = { w: 0, h: 0 };

  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY));
      if (v && Array.isArray(v.corners) && v.corners.length === 4 && v.aspect > 0) return v;
    } catch (e) { /* unavailable or corrupt: run uncalibrated */ }
    return null;
  }

  function save() {
    try {
      if (cal) localStorage.setItem(STORE_KEY, JSON.stringify(cal));
      else localStorage.removeItem(STORE_KEY);
    } catch (e) { /* calibration still applies for this session */ }
  }

  function fullFrame() {
    return {
      corners: [[0, 0], [1, 0], [1, 1], [0, 1]],
      aspect: window.innerWidth / window.innerHeight,
    };
  }

  // Projective map of the unit square onto quad q (Heckbert's square-to-quad),
  // pre-scaled so it takes content pixels (0..w, 0..h). Returned as a CSS
  // matrix3d, column-major.
  function homography(w, h, q) {
    const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
    const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1;
    const g = det ? (dx3 * dy2 - dx2 * dy3) / det : 0;
    const k = det ? (dx1 * dy3 - dx3 * dy1) / det : 0;
    const a = x1 - x0 + g * x1, b = x3 - x0 + k * x3;
    const d = y1 - y0 + g * y1, e = y3 - y0 + k * y3;
    const m = [a / w, d / w, 0, g / w,
               b / h, e / h, 0, k / h,
               0, 0, 1, 0,
               x0, y0, 0, 1];
    return `matrix3d(${m.join(',')})`;
  }

  function quadPx() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return cal.corners.map(([fx, fy]) => [fx * vw, fy * vh]);
  }

  // Corner pins move only the transform; the content size (and so the
  // renderer's geometry) changes only with the aspect or the viewport.
  function applyTransform() {
    if (!cal) {
      warp.style.transform = '';
    } else {
      warp.style.transform = homography(size.w, size.h, quadPx());
    }
    if (active) placePins();
  }

  function layout() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    if (cal) {
      // Largest rect of the calibrated aspect that fits the viewport: render
      // resolution tracks the display, the warp does the rest.
      const w = Math.min(vw, vh * cal.aspect);
      size = { w, h: w / cal.aspect };
    } else {
      size = { w: vw, h: vh };
    }
    warp.style.width = `${size.w}px`;
    warp.style.height = `${size.h}px`;
    grid.style.backgroundSize = `${size.h / GRID_ROWS}px ${size.h / GRID_ROWS}px`;
    applyTransform();
  }

  // Layout plus renderer geometry; for anything that changes content size.
  function relayout() {
    layout();
    Renderer.resize();
  }

  // ---------------------------------------------------------- calibrate mode

  function placePins() {
    quadPx().forEach(([x, y], i) => {
      pins[i].style.left = `${x}px`;
      pins[i].style.top = `${y}px`;
      pins[i].classList.toggle('selected', i === selected);
    });
    hint.textContent =
      'drag the corners onto the window frame\n' +
      'tab  next corner   arrows  nudge (shift ×10)\n' +
      `[ ]  aspect ${cal.aspect.toFixed(3)} until the cells look square (shift: fine)\n` +
      'r  reset   p / esc  done';
  }

  function moveCorner(i, x, y) {
    cal.corners[i] = [x / window.innerWidth, y / window.innerHeight];
    applyTransform();
    save();
  }

  function setAspect(a) {
    cal.aspect = Math.min(8, Math.max(0.125, a));
    relayout();
    save();
  }

  function buildPins() {
    for (let i = 0; i < 4; i++) {
      const el = document.createElement('div');
      el.className = 'pin';
      el.addEventListener('pointerdown', (e) => {
        selected = i;
        el.setPointerCapture(e.pointerId);
        placePins();
      });
      el.addEventListener('pointermove', (e) => {
        if (el.hasPointerCapture(e.pointerId)) moveCorner(i, e.clientX, e.clientY);
      });
      document.body.appendChild(el);
      pins.push(el);
    }
    hint = document.createElement('div');
    hint.id = 'calibrate-hint';
    document.body.appendChild(hint);
  }

  function toggle() {
    active = !active;
    if (active) {
      if (!pins.length) buildPins();
      if (!cal) {
        cal = fullFrame();
        relayout();
      }
      placePins();
    }
    document.body.classList.toggle('calibrate', active);
  }

  // Owns the keyboard while calibrating, so preset keys can't fire mid-pin.
  function onKey(e) {
    const step = e.shiftKey ? 10 : 1;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0],
                    ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge) {
      const [x, y] = quadPx()[selected];
      moveCorner(selected, x + nudge[0], y + nudge[1]);
    } else if (e.key === 'Tab') {
      selected = (selected + (e.shiftKey ? 3 : 1)) % 4;
      placePins();
    } else if (e.key === '[' || e.key === '{') {
      setAspect(cal.aspect / (e.shiftKey ? 1.002 : 1.02));
    } else if (e.key === ']' || e.key === '}') {
      setAspect(cal.aspect * (e.shiftKey ? 1.002 : 1.02));
    } else if (e.key === 'r') {
      cal = fullFrame();
      relayout();
      save();
    } else if (e.key === 'p' || e.key === 'Escape') {
      toggle();
    } else {
      return;
    }
    e.preventDefault();
  }

  // Sizes the content before Renderer.init reads it.
  function init() {
    warp = document.getElementById('warp');
    grid = document.getElementById('grid');
    cal = load();
    layout();
  }

  return {
    init, relayout, toggle, onKey,
    get active() { return active; },
  };
})();
