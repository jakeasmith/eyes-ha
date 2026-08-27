'use strict';
// All tunable constants in one place (SPEC §17). Everything in CONFIG and the
// §10.1 preset numbers are informed guesses meant to be tuned by eye.

// Seed for ALL randomness — iris structure and life-layer drift are
// reproducible between reloads so tuning is possible (SPEC §7.1).
const SEED = 0xE7E51;

// ---- Gaze zones (§9.1): discrete named targets; geometry-dependent ----
const ZONES = {
  sidewalk: { gazeX: -0.6, gazeY: 0.35 },
  walkway:  { gazeX: -0.2, gazeY: 0.6 },
  porch:    { gazeX: 0.1,  gazeY: 0.85 },
  door:     { gazeX: 0.5,  gazeY: 0.9 },
  away:     { gazeX: 0.0,  gazeY: -0.3 },
};

const CONFIG = {
  mirror: false, // §4.2 MIRROR flag; 'm' toggles at runtime

  // ---- Layout (§4.1: everything derived from the viewport) ----
  eyeWidthFrac: 0.26,  // one eye's width as a fraction of the smaller viewport dimension
  eyeAspect: 0.60,     // eye height / eye width at fully open lids
  gapFrac: 0.45,       // gap between eyes = gapFrac * eyeW * separation
  marginFrac: 0.03,    // envelope margin, fraction of the smaller dimension
  anchorY: 1 / 3,      // resting vertical anchor: pair center sits here at posY = 0

  // ---- Gaze geometry ----
  gazeTravelX: 0.17,   // max horizontal iris offset, fraction of eye width
  gazeTravelUp: 0.20,  // max upward iris offset, fraction of eye height
  gazeDownBoost: 2.0,  // downward travel = up travel × this (§8: down range ~2× up)

  // ---- Lid–gaze coupling (§9.2): lids follow the pupil on down-gaze ----
  coupling: {
    lidUpperDrop: 0.35,  // lidUpper reduced by up to this × max(0, gazeY)
    lidLowerRaise: 0.15, // lidLower raised by up to this × max(0, gazeY)
    irisSquash: 0.12,    // vertical iris squash at full down-gaze
    browDrop: 0.2,       // browHeight drop at full down-gaze
  },

  // ---- Life layer (§6) ----
  // Saccade amplitudes are in gaze units (gazeX/gazeY space). One gaze unit
  // moves the iris gazeTravelX × eyeW, so 0.20 units ≈ 3.4% of eye width —
  // inside §6.1's ≤4% bound for microsaccades.
  microAmp: 0.20,
  microOnsetSec: 0.06,     // saccade onset ~60ms then hold
  scanAmp: 0.9,            // scanning saccades are large (§6.1)
  blinkCloseSec: 0.08,     // §6.2: close fast
  blinkOpenSec: 0.15,      // open slower
  blinkHoldSec: 0.05,      // fully closed
  blinkLongHoldMin: 0.4,   // 1-in-8 blinks hold 400–900ms
  blinkLongHoldMax: 0.9,
  blinkAsyncMin: 0.015,    // right eye offset 15–60ms, never perfect sync
  blinkAsyncMax: 0.060,
  blinkUpCoupleP: 0.5,     // §6.3: P(blink at start of upward saccade)
  blinkDownCoupleP: 0.25,  // P(blink shortly AFTER a downward saccade onset)
  blinkDownDelaySec: 0.09,
  browNoiseDeg: 2,         // §6.4: value noise on browAngle, ±2°
  browNoisePeriod: 6,      // seconds
  breathePeriod: 5,        // §6.4 breathing sinusoid
  breatheLidAmp: 0.03,
  breatheScaleAmp: 0.01,
  jitterGaze: 0.05,        // gaze tremble amplitude at jitter=1, in gaze units

  // ---- Speech implication (talk > 0) ----
  // A talking face is implied by CORRELATED prosody: brow beats, micro-nods,
  // gaze aversion/return, and boundary blinks all riding one utterance/pause
  // clock. Amplitudes scale with the talk param.
  speech: {
    utterMin: 1.2, utterMax: 3.6,   // seconds of "speaking"
    pauseMin: 0.4, pauseMax: 1.5,   // seconds between utterances
    beatGapMin: 0.25, beatGapMax: 0.7,
    beatAmpMin: 0.12, beatAmpMax: 0.32,  // browHeight pulse
    nodP: 0.45,                     // P(a beat also nods)
    nodAmpMin: 0.02, nodAmpMax: 0.05,    // fraction of eye height
    avertP: 0.6,                    // P(gaze aversion at utterance start)
    avertX: 0.3, avertY: 0.18,      // gaze units; Y biased upward (formulating)
    boundaryBlinkP: 0.5,
    tiltSway: 1.3,                  // degrees of slow head-tilt sway
  },

  // ---- One-shots (§10.2, §10.3) and behavior rules (§13) ----
  oneshot: {
    lungeAttack: 0.12,    // the one place a hard motion is correct
    lungeHold: 0.4,
    lungeRetreat: 0.6,
    lungeEyeScale: 2.3,
    lungeJitter: 0.9,
    vanishHoldMin: 2.5,   // fully black
    vanishHoldMax: 5,
    vanishJumpMin: 0.3,   // posY jump within the envelope
    vanishJumpMax: 0.8,
    reopenSec: 0.25,
    dropLowFrac: 2 / 3,   // drop lands with the pair center at this viewport fraction
    dropFall: 0.4,        // accelerating fall
    dropSettle: 0.2,      // small post-landing absorb
    dropSettleAmt: 0.05,  // posY recoil after landing
    riseSec: 1.1,         // slow deliberate glide back to the anchor
    noticeStirSec: 2.8,   // §12.1 Notice: stirring scan before settling to watching
  },
  presetTimeoutSec: 90,   // narrowed/rage auto-return to watching (§13.1)

  // ---- Per-eye asymmetry ----
  lidAsymBrowFactor: 2.0,  // lidAsym also raises the right brow (curious: "one brow raised")

  // ---- Iris generation (§7.1) — regenerating reruns the seeded recipe ----
  iris: {
    texSize: 512,          // offscreen raster resolution
    striationCount: 56,    // pupillary-zone radial striations (spec: 40–70)
    striationAlpha: 0.72,
    collaretteU: 0.33,     // boundary at ⅓ of pupil→limbus span
    collaretteJag: 0.05,   // radial irregularity of the collarette ring
    collaretteVerts: 48,
    foldCount: 115,         // ciliary-zone circumferential arc segments
    cryptCount: 14,        // dark elongated pits (spec: 8–20)
    ruffWidth: 0.045,      // pupillary ruff, fraction of pupil→limbus span
    limbalBase: 0.10,      // §7.3 LIMBAL_BASE, fraction of iris radius
  },

  // ---- Rendering ----
  catchlightOffset: 0.38,  // catchlight offset from iris center, fraction of iris radius
  catchlightSize: 0.15,    // catchlight radius, fraction of iris radius
  lidShadowAlpha: 0.38,    // §7.2 cue 3: upper lid darkens the top of the eyeball
  lidShadowDepth: 0.35,    // shadow reach, fraction of eye height
  glowBaseFrac: 0.75,      // glow radius = eyeW * (base + glowRadius * spanFrac)
  glowSpanFrac: 1.3,
};

// ---- Parameter schema (§8) ----
// Flat: one row per key. min/max clamp; smoothing selects the engine path:
//   'tau'   — shared exponential smoothing (§5.1)
//   'pupil' — asymmetric attack/release (§5.2)
//   'snap'  — takes effect immediately (meta-params that govern smoothing itself)
// circular: interpolate along the shorter arc (§5.3).
// persist: survives preset changes when the preset omits the key (positional
// state owned by gaze zones / Vanish, and the pupil dynamics constants).
// Non-persistent keys a preset omits reset to DEFAULTS — a preset is a
// complete expression, not a diff against whatever came before.
const PARAM_META = {
  lidUpper:            { min: 0,    max: 1,    smoothing: 'tau' },
  lidLower:            { min: 0,    max: 1,    smoothing: 'tau' },
  lidAsym:             { min: 0,    max: 0.3,  smoothing: 'tau' },
  pupilSize:           { min: 0.12, max: 0.65, smoothing: 'pupil' },
  irisSize:            { min: 0.3,  max: 0.6,  smoothing: 'tau' },
  eyeScale:            { min: 0.7,  max: 2.5,  smoothing: 'tau' },
  separation:          { min: 0.8,  max: 1.4,  smoothing: 'tau', persist: true },
  posX:                { min: -1,   max: 1,    smoothing: 'tau', persist: true },
  posY:                { min: -1,   max: 1,    smoothing: 'tau', persist: true },
  gazeX:               { min: -1,   max: 1,    smoothing: 'tau', persist: true },
  gazeY:               { min: -1,   max: 1,    smoothing: 'tau', persist: true },
  headTilt:            { min: -15,  max: 15,   smoothing: 'tau' },
  browAngle:           { min: -30,  max: 30,   smoothing: 'tau' },
  browHeight:          { min: -1,   max: 1,    smoothing: 'tau' },
  browArch:            { min: 0,    max: 1,    smoothing: 'tau' },
  browVisible:         { min: 0,    max: 1,    smoothing: 'tau' },
  irisHue:             { min: 0,    max: 360,  smoothing: 'tau', circular: true },
  irisSat:             { min: 0,    max: 1,    smoothing: 'tau' },
  irisLight:           { min: 0.3,  max: 0.7,  smoothing: 'tau' },
  scleraBrightness:    { min: 0.45, max: 0.95, smoothing: 'tau' },
  scleraHue:           { min: 0,    max: 360,  smoothing: 'tau', circular: true },
  scleraSat:           { min: 0,    max: 0.6,  smoothing: 'tau' },
  catchlightIntensity: { min: 0,    max: 1,    smoothing: 'tau' },
  glowRadius:          { min: 0,    max: 1,    smoothing: 'tau' },
  glowIntensity:       { min: 0,    max: 1,    smoothing: 'tau' },
  jitter:              { min: 0,    max: 1,    smoothing: 'tau' },
  microsaccadeRate:    { min: 0.3,  max: 2,    smoothing: 'tau' },
  scanRate:            { min: 0,    max: 4,    smoothing: 'tau' },
  blinkRate:           { min: 0,    max: 30,   smoothing: 'tau' },
  driftSpeed:          { min: 0,    max: 2,    smoothing: 'tau' },
  talk:                { min: 0,    max: 1,    smoothing: 'tau' },
  tau:                 { min: 80,   max: 600,  smoothing: 'snap' },
  pupilAttackMs:       { min: 120,  max: 400,  smoothing: 'snap', persist: true },
  pupilReleaseMs:      { min: 800,  max: 3000, smoothing: 'snap', persist: true },
};

// Full baseline state. On a preset change, keys the preset omits reset to
// these values — except PARAM_META persist keys, which carry across.
const DEFAULTS = {
  lidUpper: 0.12, lidLower: 0.05, lidAsym: 0.05,
  pupilSize: 0.30, irisSize: 0.42, eyeScale: 1.0, separation: 1.0,
  posX: 0, posY: 0,
  gazeX: 0, gazeY: 0.05, headTilt: 0,
  browAngle: 2, browHeight: -0.3, browArch: 0.3, browVisible: 0.4,
  irisHue: 30, irisSat: 0.15, irisLight: 0.35,
  scleraBrightness: 0.45, scleraHue: 40, scleraSat: 0.05,
  catchlightIntensity: 0.3, glowRadius: 0.3, glowIntensity: 0.15,
  jitter: 0.05, microsaccadeRate: 0.3, scanRate: 0, blinkRate: 2,
  driftSpeed: 0.4, talk: 0, tau: 500, pupilAttackMs: 200, pupilReleaseMs: 1400,
};

// ---- Presets (§10.1 verbatim; curious/narrowed interpolated per §10) ----
const PRESETS = {
  dormant:  { lidUpper: 0.12, lidLower: 0.05, pupilSize: 0.30, irisSize: 0.42,
              eyeScale: 1.0, browAngle: 2, browHeight: -0.3, browArch: 0.3,
              browVisible: 0.4, irisHue: 30, irisSat: 0.15, irisLight: 0.35,
              scleraBrightness: 0.45, scleraHue: 40, scleraSat: 0.05,
              catchlightIntensity: 0.3, glowRadius: 0.3, glowIntensity: 0.15,
              jitter: 0.05, microsaccadeRate: 0.3, scanRate: 0, blinkRate: 2,
              driftSpeed: 0.4, tau: 500 },

  stirring: { lidUpper: 0.7, lidLower: 0.08, pupilSize: 0.45, irisSize: 0.45,
              eyeScale: 1.0, browAngle: 4, browHeight: 0.1, browArch: 0.5,
              browVisible: 0.7, irisHue: 38, irisSat: 0.4, irisLight: 0.45,
              scleraBrightness: 0.7, scleraHue: 45, scleraSat: 0.06,
              catchlightIntensity: 0.6, glowRadius: 0.45, glowIntensity: 0.35,
              jitter: 0.2, microsaccadeRate: 1.0, scanRate: 3.0, blinkRate: 14,
              driftSpeed: 1.2, tau: 300 },

  watching: { lidUpper: 0.85, lidLower: 0.10, pupilSize: 0.35, irisSize: 0.45,
              eyeScale: 1.0, browAngle: 0, browHeight: 0, browArch: 0.5,
              browVisible: 0.8, irisHue: 40, irisSat: 0.5, irisLight: 0.5,
              scleraBrightness: 0.85, scleraHue: 45, scleraSat: 0.05,
              catchlightIntensity: 0.8, glowRadius: 0.5, glowIntensity: 0.45,
              jitter: 0.12, microsaccadeRate: 1.0, scanRate: 0, blinkRate: 8,
              driftSpeed: 1.0, tau: 250 },

  curious:  { lidUpper: 0.8, lidLower: 0.08, lidAsym: 0.22, pupilSize: 0.42,
              irisSize: 0.46, eyeScale: 1.0, headTilt: 12,
              browAngle: 6, browHeight: 0.25, browArch: 0.7, browVisible: 0.85,
              irisHue: 40, irisSat: 0.5, irisLight: 0.52,
              scleraBrightness: 0.85, scleraHue: 45, scleraSat: 0.05,
              catchlightIntensity: 0.8, glowRadius: 0.5, glowIntensity: 0.4,
              jitter: 0.08, microsaccadeRate: 0.8, scanRate: 0, blinkRate: 10,
              driftSpeed: 0.9, tau: 300 },

  narrowed: { lidUpper: 0.45, lidLower: 0.35, pupilSize: 0.20, irisSize: 0.46,
              eyeScale: 1.0, browAngle: -14, browHeight: -0.45, browArch: 0.2,
              browVisible: 0.9, irisHue: 30, irisSat: 0.55, irisLight: 0.45,
              scleraBrightness: 0.8, scleraHue: 45, scleraSat: 0.05,
              catchlightIntensity: 0.7, glowRadius: 0.4, glowIntensity: 0.4,
              jitter: 0.25, microsaccadeRate: 1.6, scanRate: 0, blinkRate: 5,
              driftSpeed: 1.0, tau: 200 },

  rage:     { lidUpper: 0.95, lidLower: 0.30, pupilSize: 0.14, irisSize: 0.48,
              eyeScale: 1.15, browAngle: -26, browHeight: -0.7, browArch: 0.1,
              browVisible: 1.0, irisHue: 2, irisSat: 0.95, irisLight: 0.5,
              scleraBrightness: 0.9, scleraHue: 8, scleraSat: 0.45,
              catchlightIntensity: 1.0, glowRadius: 0.85, glowIntensity: 0.9,
              jitter: 0.8, microsaccadeRate: 2.0, scanRate: 0, blinkRate: 3,
              driftSpeed: 1.6, tau: 120 },

  gentle:   { lidUpper: 0.75, lidLower: 0.05, pupilSize: 0.52, irisSize: 0.50,
              eyeScale: 1.0, browAngle: 14, browHeight: 0.4, browArch: 0.9,
              browVisible: 0.8, irisHue: 45, irisSat: 0.45, irisLight: 0.62,
              scleraBrightness: 0.8, scleraHue: 45, scleraSat: 0.04,
              catchlightIntensity: 0.7, glowRadius: 0.6, glowIntensity: 0.4,
              jitter: 0.02, microsaccadeRate: 0.5, scanRate: 0, blinkRate: 12,
              driftSpeed: 0.6, tau: 350 },

  // Not in §10.1 — implies a talking face (no mouth shown) via the speech
  // prosody machinery in the life layer.
  speaking: { lidUpper: 0.82, lidLower: 0.10, pupilSize: 0.38, irisSize: 0.45,
              eyeScale: 1.0, browAngle: 2, browHeight: 0.1, browArch: 0.55,
              browVisible: 0.85, irisHue: 40, irisSat: 0.5, irisLight: 0.5,
              scleraBrightness: 0.85, scleraHue: 45, scleraSat: 0.05,
              catchlightIntensity: 0.8, glowRadius: 0.5, glowIntensity: 0.45,
              jitter: 0.08, microsaccadeRate: 0.7, scanRate: 0, blinkRate: 15,
              driftSpeed: 1.0, tau: 250, talk: 0.85 },
};

const PRESET_KEYS = ['dormant', 'stirring', 'watching', 'curious', 'narrowed', 'rage', 'gentle', 'speaking'];
