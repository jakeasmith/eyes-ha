'use strict';
// Three-layer state model (§5.1):
//   target  — the requested preset; snaps on preset change
//   current — lerps toward target each frame, per key
//   display — current + life layer; what the renderer consumes; never
//             written back into current (the life layer owns that copy)
//
// lockedKeys (§3): a one-shot (GSAP, later step) suspends smoothing on
// exactly the keys it animates; the loop below skips them.

const Engine = (() => {
  const target = { ...DEFAULTS };
  const current = { ...DEFAULTS };
  const display = { ...DEFAULTS };
  const lockedKeys = new Set();
  let activePreset = 'dormant';
  let activeZone = 'away';
  // Intensity (§9.3): global scalar, orthogonal to preset. 0.5 is the
  // authored baseline — the display-stage factor is 2 × intensity, so 0
  // kills the scaled keys, 0.5 is neutral, 1 doubles them (range-clamped).
  let intensity = 0.5;
  let intensityTarget = 0.5;

  const clampKey = (k, v) => {
    const m = PARAM_META[k];
    return Math.min(m.max, Math.max(m.min, v));
  };

  function applyPreset(name) {
    const p = PRESETS[name];
    if (!p) return;
    activePreset = name;
    for (const k of Object.keys(PARAM_META)) {
      // A preset is a complete expression: omitted keys fall back to
      // DEFAULTS, except persist keys (position, gaze, pupil dynamics).
      if (k in p) target[k] = clampKey(k, p[k]);
      else if (!PARAM_META[k].persist) target[k] = DEFAULTS[k];
      // Meta-params that govern smoothing itself take effect immediately —
      // the new preset's transition should run at the new preset's tau.
      if (PARAM_META[k].smoothing === 'snap') current[k] = target[k];
    }
  }

  function setGazeZone(name) {
    const z = ZONES[name];
    if (!z) return;
    activeZone = name;
    target.gazeX = clampKey('gazeX', z.gazeX);
    target.gazeY = clampKey('gazeY', z.gazeY);
  }

  function setIntensity(v) {
    intensityTarget = Math.min(1, Math.max(0, v));
  }

  // Frame-rate-independent exponential smoothing (§5.1); dt in seconds.
  function step(dt) {
    const dtMs = dt * 1000;
    intensity += (intensityTarget - intensity) * (1 - Math.exp(-dtMs / 250));
    for (const k of Object.keys(PARAM_META)) {
      if (lockedKeys.has(k)) continue;
      const meta = PARAM_META[k];
      if (meta.smoothing === 'snap') {
        current[k] = target[k];
        continue;
      }
      // Asymmetric pupil dynamics (§5.2): fast attack when dilating, slow
      // release when constricting.
      let tauMs = current.tau;
      if (meta.smoothing === 'pupil') {
        tauMs = target[k] > current[k] ? current.pupilAttackMs : current.pupilReleaseMs;
      }
      const a = 1 - Math.exp(-dtMs / tauMs);
      if (meta.circular) {
        // Shorter-arc interpolation for hues (§5.3).
        const d = ((target[k] - current[k] + 540) % 360) - 180;
        current[k] = (current[k] + d * a + 360) % 360;
      } else {
        current[k] = clampKey(k, current[k] + (target[k] - current[k]) * a);
      }
    }
  }

  return {
    target, current, display, lockedKeys,
    applyPreset, step, setGazeZone, setIntensity,
    get activePreset() { return activePreset; },
    get activeZone() { return activeZone; },
    get intensity() { return intensity; },
    get intensityTarget() { return intensityTarget; },
  };
})();
