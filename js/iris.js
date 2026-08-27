'use strict';
// Procedural iris (§7.1). Two halves, deliberately split:
//
//  generate() — runs the seeded recipe ONCE, emitting a display list of
//    primitives whose radial coordinate u is normalized to the
//    pupil-margin→limbus span (0 = pupil margin, 1 = limbus).
//
//  raster(pupilSize, hue, sat, light) — replays the display list into an
//    offscreen canvas, mapping u through the CURRENT pupil radius:
//    r(u) = pupilR + u * (limbusR - pupilR). Dilation therefore compresses
//    the pupillary zone while the ciliary zone barely moves and the
//    collarette rides the boundary — never a bitmap scale.
//
// The raster is redrawn only when its quantized inputs change (dirty check,
// no cache structure); in steady state each frame is one drawImage.

const Iris = (() => {
  let list = null;
  let canvas = null;
  let ctx = null;
  let lastKey = '';

  const TAU2 = Math.PI * 2;

  function generate() {
    const rand = mulberry32(SEED ^ 0x1815);
    const C = CONFIG.iris;
    list = { striations: [], collarette: [], folds: [], crypts: [] };

    // §7.1(2) pupillary zone: 40–70 tapered radial striations, randomized
    // angle/length/alpha, brightest near the collarette.
    for (let i = 0; i < C.striationCount; i++) {
      list.striations.push({
        th: rand() * TAU2,
        u0: 0.02 + rand() * 0.05,
        u1: C.collaretteU * (0.75 + rand() * 0.45), // some stop short, some cross
        w: 0.008 + rand() * 0.014,                  // width, fraction of limbus radius
        alpha: C.striationAlpha * (0.4 + rand() * 0.6),
        dl: 0.10 + rand() * 0.14,                   // lightness lift
      });
    }

    // §7.1(3) collarette: irregular jagged ring at ~⅓ of the span.
    for (let i = 0; i < C.collaretteVerts; i++) {
      list.collarette.push({
        th: (i / C.collaretteVerts) * TAU2,
        u: C.collaretteU + (rand() * 2 - 1) * C.collaretteJag,
      });
    }

    // §7.1(4) ciliary zone: short circumferential arc segments — neither
    // continuous nor perfect circles.
    for (let i = 0; i < C.foldCount; i++) {
      list.folds.push({
        u: C.collaretteU + 0.08 + rand() * (0.88 - C.collaretteU - 0.08),
        th0: rand() * TAU2,
        dth: (0.06 + rand() * 0.22) * TAU2 * 0.25, // 5°–25° arcs
        w: 0.004 + rand() * 0.008,
        alpha: 0.10 + rand() * 0.22,
        dl: (rand() < 0.5 ? -1 : 1) * (0.05 + rand() * 0.08),
      });
    }

    // §7.1(5) crypts: small dark elongated pits in loose rows just outside
    // the collarette.
    for (let i = 0; i < C.cryptCount; i++) {
      const row = rand() < 0.65 ? 0 : 1;
      list.crypts.push({
        th: rand() * TAU2,
        u: C.collaretteU + 0.05 + row * 0.16 + rand() * 0.08,
        len: 0.05 + rand() * 0.09,  // radial elongation, fraction of limbus radius
        w: 0.015 + rand() * 0.02,
        alpha: 0.30 + rand() * 0.25,
      });
    }

    lastKey = ''; // force re-raster
  }

  function hsl(h, s, l, a) {
    return `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;
  }

  const clamp01 = (v) => Math.min(1, Math.max(0, v));

  // pupilSize: fraction of iris radius (§8). Returns the cached canvas.
  function raster(pupilSize, hue, sat, light) {
    const key = `${Math.round(pupilSize * 64)}|${Math.round(hue)}|${Math.round(sat * 100)}|${Math.round(light * 100)}`;
    if (key === lastKey && canvas) return canvas;
    lastKey = key;

    const size = CONFIG.iris.texSize;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      ctx = canvas.getContext('2d');
    }
    const c = size / 2;
    const R = c * 0.985;             // limbus radius in texture px
    const pupilR = pupilSize * R;
    const r = (u) => pupilR + u * (R - pupilR);

    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, R, 0, TAU2);
    ctx.clip();

    // (1) Base: radial gradient, brighter at the pupil margin, ~60% at the limbus.
    const base = ctx.createRadialGradient(c, c, Math.max(1, pupilR * 0.8), c, c, R);
    base.addColorStop(0, hsl(hue, sat, clamp01(light * 1.08), 1));
    base.addColorStop(0.75, hsl(hue, sat, light * 0.78, 1));
    base.addColorStop(1, hsl(hue, sat, light * 0.58, 1));
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, size, size);

    // (4) Ciliary folds (drawn before striations so the pupillary zone sits on top).
    for (const f of list.folds) {
      ctx.beginPath();
      ctx.arc(c, c, r(f.u), f.th0, f.th0 + f.dth);
      ctx.strokeStyle = hsl(hue, sat, clamp01(light + f.dl), f.alpha);
      ctx.lineWidth = Math.max(1, f.w * R);
      ctx.stroke();
    }

    // (2) Striations: tapered radial lines, brightest near the collarette.
    for (const s of list.striations) {
      const r0 = r(s.u0);
      const r1 = r(s.u1);
      if (r1 - r0 < 1) continue;
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate(s.th);
      const w0 = s.w * R * 0.4;
      const w1 = s.w * R;
      const grad = ctx.createLinearGradient(r0, 0, r1, 0);
      grad.addColorStop(0, hsl(hue, sat, clamp01(light + s.dl), s.alpha * 0.25));
      grad.addColorStop(1, hsl(hue, sat, clamp01(light + s.dl), s.alpha));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(r0, -w0 / 2);
      ctx.lineTo(r1, -w1 / 2);
      ctx.lineTo(r1, w1 / 2);
      ctx.lineTo(r0, w0 / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // (5) Crypts: dark radially-elongated pits.
    for (const cr of list.crypts) {
      ctx.save();
      ctx.translate(c + Math.cos(cr.th) * r(cr.u), c + Math.sin(cr.th) * r(cr.u));
      ctx.rotate(cr.th);
      ctx.beginPath();
      ctx.ellipse(0, 0, cr.len * R * 0.5, cr.w * R * 0.5, 0, 0, TAU2);
      ctx.fillStyle = hsl(hue, sat * 0.9, light * 0.45, cr.alpha);
      ctx.fill();
      ctx.restore();
    }

    // (3) Collarette: jagged ring, brighter than surroundings, not a clean circle.
    ctx.beginPath();
    for (let i = 0; i <= list.collarette.length; i++) {
      const v = list.collarette[i % list.collarette.length];
      const x = c + Math.cos(v.th) * r(v.u);
      const y = c + Math.sin(v.th) * r(v.u);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hsl(hue, sat, clamp01(light + 0.14), 0.5);
    ctx.lineWidth = Math.max(1.5, R * 0.010);
    ctx.stroke();
    // faint dark inner echo for depth
    ctx.save();
    ctx.translate(c, c);
    ctx.scale(0.97, 0.97);
    ctx.translate(-c, -c);
    ctx.strokeStyle = hsl(hue, sat, light * 0.5, 0.25);
    ctx.lineWidth = Math.max(1, R * 0.008);
    ctx.stroke();
    ctx.restore();

    // (6) Pupillary ruff: dark border at the pupil margin.
    const ruffR = r(CONFIG.iris.ruffWidth) - pupilR;
    ctx.beginPath();
    ctx.arc(c, c, pupilR + ruffR / 2, 0, TAU2);
    ctx.strokeStyle = hsl(hue, sat * 0.8, light * 0.25, 0.85);
    ctx.lineWidth = Math.max(1, ruffR);
    ctx.stroke();

    // Pupil proper.
    ctx.beginPath();
    ctx.arc(c, c, pupilR, 0, TAU2);
    ctx.fillStyle = '#040303';
    ctx.fill();

    // (7) Limbal ring — width inversely coupled to dilation (§7.3).
    const meta = PARAM_META.pupilSize;
    const norm = (pupilSize - meta.min) / (meta.max - meta.min);
    const limbalW = CONFIG.iris.limbalBase * (1 - 0.5 * norm) * R;
    ctx.beginPath();
    ctx.arc(c, c, R - limbalW / 2, 0, TAU2);
    ctx.strokeStyle = hsl(hue, sat * 0.7, light * 0.22, 0.9);
    ctx.lineWidth = limbalW;
    ctx.stroke();
    // soft inner fade so the ring doesn't read as machined
    ctx.beginPath();
    ctx.arc(c, c, R - limbalW * 1.25, 0, TAU2);
    ctx.strokeStyle = hsl(hue, sat * 0.7, light * 0.3, 0.35);
    ctx.lineWidth = limbalW * 0.8;
    ctx.stroke();

    ctx.restore();
    return canvas;
  }

  return { generate, raster, invalidate: () => { lastKey = ''; } };
})();
