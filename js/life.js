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

  // Rebase from the current eased position and move to (x, y).
  function fireTo(s, x, y) {
    const at = eased(s);
    s.px = at.x;
    s.py = at.y;
    s.x = x;
    s.y = y;
    s.onset = t;
    return s.y - s.py; // vertical direction of this shift (negative = upward)
  }

  function fire(s, ampX, ampY) {
    const ang = rand() * Math.PI * 2;
    const m = 0.4 + rand() * 0.6;
    return fireTo(s, Math.cos(ang) * ampX * m, Math.sin(ang) * ampY * m);
  }

  // ---- Speech prosody (talk > 0): implies a talking face by riding brow
  // beats, micro-nods, gaze aversion/return, and boundary blinks on one
  // shared utterance/pause clock. Correlation is the effect — independent
  // random motion does not read as speech.
  const speech = {
    phase: 'pause', until: 0.5,
    nextBeat: 0, beatT: -10, beatAmp: 0,
    nodT: -10, nodAmp: 0,
    gaze: makeSaccade(),
  };
  speech.gaze.next = Infinity;

  // Fast attack, exponential decay — the shape of a stressed-syllable gesture.
  function pulse(e) {
    if (!(e >= 0)) return 0;
    if (e < 0.08) return e / 0.08;
    return Math.exp(-(e - 0.08) / 0.16);
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

  function apply(dt, cur, disp, intensity) {
    t += dt;
    Object.assign(disp, cur);

    // Intensity (§9.3): display-stage scaling, orthogonal to preset. 0.5 is
    // the authored baseline (factor 1); 0 kills these keys, 1 doubles them.
    const inten = intensity === undefined ? 0.5 : intensity;
    const f = inten * 2;
    for (const k of ['jitter', 'irisSat', 'microsaccadeRate', 'glowIntensity', 'driftSpeed']) {
      const m = PARAM_META[k];
      disp[k] = Math.min(m.max, Math.max(m.min, cur[k] * f));
    }

    // ---- Microsaccades: always on — a staring creature is here (§6.1).
    if (disp.microsaccadeRate > 0.05) {
      const interval = 1 / disp.microsaccadeRate;
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
    const j = disp.jitter * CONFIG.jitterGaze;
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

    // ---- Speech prosody.
    disp.nodY = 0;
    if (cur.talk > 0.02) {
      const S = CONFIG.speech;
      const k = cur.talk;
      if (t >= speech.until) {
        if (speech.phase === 'utter') {
          speech.phase = 'pause';
          speech.until = t + S.pauseMin + rand() * (S.pauseMax - S.pauseMin);
          fireTo(speech.gaze, 0, 0); // boundary: return to the viewer
          if (rand() < S.boundaryBlinkP) startBlink(cur);
        } else {
          speech.phase = 'utter';
          speech.until = t + S.utterMin + rand() * (S.utterMax - S.utterMin);
          speech.nextBeat = t + 0.1;
          if (rand() < S.avertP) {
            // Formulating: glance off to a side, biased slightly upward.
            fireTo(speech.gaze, (rand() * 2 - 1) * S.avertX, -rand() * S.avertY);
          }
        }
      }
      if (speech.phase === 'utter' && t >= speech.nextBeat) {
        speech.beatT = t;
        speech.beatAmp = S.beatAmpMin + rand() * (S.beatAmpMax - S.beatAmpMin);
        if (rand() < S.nodP) {
          speech.nodT = t;
          speech.nodAmp = S.nodAmpMin + rand() * (S.nodAmpMax - S.nodAmpMin);
        }
        speech.nextBeat = t + S.beatGapMin + rand() * (S.beatGapMax - S.beatGapMin);
      }
      disp.browHeight += pulse(t - speech.beatT) * speech.beatAmp * k;
      disp.nodY = pulse(t - speech.nodT) * speech.nodAmp * k;
      const g = eased(speech.gaze);
      disp.gazeX = Math.max(-1, Math.min(1, disp.gazeX + g.x * k));
      disp.gazeY = Math.max(-1, Math.min(1, disp.gazeY + g.y * k));
      disp.headTilt += (jitterNoiseX(t * 1.1 + 200) * 2 - 1) * S.tiltSway * k;
    }

    // ---- Drift (§6.4): brow value noise + breathing, scaled by driftSpeed.
    const ds = disp.driftSpeed;
    disp.browAngle += (browNoise(t * Math.max(ds, 0.01) / CONFIG.browNoisePeriod) * 2 - 1) * CONFIG.browNoiseDeg;
    const breathe = Math.sin((t / CONFIG.breathePeriod) * Math.PI * 2);
    disp.lidUpper = Math.max(0, Math.min(1, disp.lidUpper + breathe * CONFIG.breatheLidAmp * ds));
    disp.eyeScale += breathe * CONFIG.breatheScaleAmp * ds;
  }

  return { apply, startBlink };
})();
