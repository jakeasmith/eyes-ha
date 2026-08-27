'use strict';
// The life layer (§6) — the actual payload; rendering exists to make this
// legible (§1). Applied to `display` every frame on top of `current`.
// Owns its own seeded PRNG stream so tuning iris generation never reshuffles
// the drift, and vice versa.
//
// Writes two extra non-schema keys the renderer consumes:
//   display.blinkL / display.blinkR — per-eye lid multipliers (1 = open),
//   offset in time so the two eyes never blink in perfect sync (§6.2).

const Life = (() => {
  const rand = mulberry32(SEED ^ 0x11FE);
  const browNoise = makeNoise1D(SEED ^ 0xB404);
  const jitterNoiseX = makeNoise1D(SEED ^ 0x71A1);
  const jitterNoiseY = makeNoise1D(SEED ^ 0x71A2);

  let t = 0;

  // A saccade rebases from its currently-eased position when a new one fires,
  // moves fast (~60ms onset), then holds (§6.1).
  const makeSaccade = () => ({ x: 0, y: 0, px: 0, py: 0, onset: -1, next: 0.5 + rand() });
  const micro = makeSaccade();
  const scan = makeSaccade();

  const blink = {
    next: 1.5,
    pendingAt: Infinity, // §6.3: blink initiated after a downward saccade onset
    t0L: -10, t0R: -10,  // per-eye start times
    hold: 0,
  };

  const eased = (s) => {
    if (s.onset < 0) return { x: 0, y: 0 };
    const k = Math.min(1, (t - s.onset) / CONFIG.microOnsetSec);
    const e = 1 - (1 - k) * (1 - k); // fast onset, ease-out into the hold
    return { x: s.px + (s.x - s.px) * e, y: s.py + (s.y - s.py) * e };
  };

  function fire(s, ampX, ampY) {
    const at = eased(s);
    s.px = at.x;
    s.py = at.y;
    const ang = rand() * Math.PI * 2;
    const m = 0.4 + rand() * 0.6;
    s.x = Math.cos(ang) * ampX * m;
    s.y = Math.sin(ang) * ampY * m;
    s.onset = t;
    return s.y - s.py; // vertical direction of this shift (negative = upward)
  }

  function startBlink(cur) {
    if (blinkEnvelope(blink.t0L, blink.hold) < 1 || blinkEnvelope(blink.t0R, blink.hold) < 1) {
      return; // already mid-blink; blinks are not queued
    }
    blink.t0L = t;
    blink.t0R = t + CONFIG.blinkAsyncMin + rand() * (CONFIG.blinkAsyncMax - CONFIG.blinkAsyncMin);
    // Roughly 1 in 8 blinks holds closed 400–900ms (§6.2).
    blink.hold = rand() < 1 / 8
      ? CONFIG.blinkLongHoldMin + rand() * (CONFIG.blinkLongHoldMax - CONFIG.blinkLongHoldMin)
      : CONFIG.blinkHoldSec;
    // Reschedule the next spontaneous blink from now.
    if (cur.blinkRate > 0.05) {
      blink.next = t + (60 / cur.blinkRate) * (0.6 + rand() * 0.8);
    }
  }

  // 1 = open, 0 = closed. Close fast (~80ms), open slower (~150ms) (§6.2).
  function blinkEnvelope(t0, hold) {
    const e = t - t0;
    if (e < 0 || t0 < 0) return 1;
    if (e < CONFIG.blinkCloseSec) return 1 - e / CONFIG.blinkCloseSec;
    if (e < CONFIG.blinkCloseSec + hold) return 0;
    const o = e - CONFIG.blinkCloseSec - hold;
    return o < CONFIG.blinkOpenSec ? o / CONFIG.blinkOpenSec : 1;
  }

  // §6.3 blink–saccade coupling: blinks lead (or join) upward saccades and
  // may trail downward ones — never the reverse.
  function coupleBlink(dy, cur) {
    if (dy < -0.05 && rand() < CONFIG.blinkUpCoupleP) startBlink(cur);
    else if (dy > 0.05 && rand() < CONFIG.blinkDownCoupleP) {
      blink.pendingAt = Math.min(blink.pendingAt, t + CONFIG.blinkDownDelaySec);
    }
  }

  // Pull a schedule in when its rate rises so a preset change reacts promptly.
  const capNext = (next, interval) => Math.min(next, t + interval * 2);

  function apply(dt, cur, disp) {
    t += dt;
    Object.assign(disp, cur);

    // ---- Microsaccades: always on — a staring creature is here (§6.1).
    if (cur.microsaccadeRate > 0.05) {
      const interval = 1 / cur.microsaccadeRate;
      micro.next = capNext(micro.next, interval);
      if (t >= micro.next) {
        const dy = fire(micro, CONFIG.microAmp, CONFIG.microAmp * 0.6);
        micro.next = t + interval * (0.5 + rand());
        coupleBlink(dy, cur);
      }
    }

    // ---- Scanning saccades: only while actively searching (scanRate > 0).
    if (cur.scanRate > 0.05) {
      const interval = 1 / cur.scanRate;
      scan.next = capNext(scan.next, interval);
      if (t >= scan.next) {
        const dy = fire(scan, CONFIG.scanAmp, CONFIG.scanAmp * 0.5);
        scan.next = t + interval * (0.6 + rand() * 0.8);
        coupleBlink(dy, cur);
      }
    } else if (scan.x !== 0 || scan.y !== 0) {
      // Search ended: glide the scan offset home rather than jumping.
      const at = eased(scan);
      scan.px = at.x; scan.py = at.y;
      scan.x = 0; scan.y = 0;
      scan.onset = t;
    }

    const m = eased(micro);
    const s = eased(scan);

    // ---- Jitter: high-frequency tremble, scaled by the jitter param.
    const j = cur.jitter * CONFIG.jitterGaze;
    const jx = (jitterNoiseX(t * 9) * 2 - 1) * j;
    const jy = (jitterNoiseY(t * 9) * 2 - 1) * j;

    disp.gazeX = Math.max(-1, Math.min(1, cur.gazeX + m.x + s.x + jx));
    disp.gazeY = Math.max(-1, Math.min(1, cur.gazeY + m.y + s.y + jy));

    // ---- Spontaneous blinks.
    if (cur.blinkRate > 0.05) {
      const interval = 60 / cur.blinkRate;
      blink.next = capNext(blink.next, interval);
      if (t >= blink.next) startBlink(cur);
    }
    if (t >= blink.pendingAt) {
      blink.pendingAt = Infinity;
      startBlink(cur);
    }
    disp.blinkL = blinkEnvelope(blink.t0L, blink.hold);
    disp.blinkR = blinkEnvelope(blink.t0R, blink.hold);

    // ---- Drift (§6.4): brow value noise + breathing, scaled by driftSpeed.
    const ds = cur.driftSpeed;
    disp.browAngle += (browNoise(t * Math.max(ds, 0.01) / CONFIG.browNoisePeriod) * 2 - 1) * CONFIG.browNoiseDeg;
    const breathe = Math.sin((t / CONFIG.breathePeriod) * Math.PI * 2);
    disp.lidUpper = Math.max(0, Math.min(1, disp.lidUpper + breathe * CONFIG.breatheLidAmp * ds));
    disp.eyeScale += breathe * CONFIG.breatheScaleAmp * ds;
  }

  return { apply, startBlink };
})();
