'use strict';
// Eye-pair renderer (§7). Everything is drawn in code: lids and brows are
// beziers, the iris is the cached procedural texture from iris.js. The sclera
// is load-bearing (§1.2) — a large off-white white containing a normal eye,
// never a glowing iris in a void.
//
// Gradients are cached and regenerated only when their (quantized) inputs
// change — zero per-frame createGradient calls in steady state (§5.3).

const Renderer = (() => {
  let canvas = null;
  let ctx = null;

  const TAU2 = Math.PI * 2;
  const DEG = Math.PI / 180;
  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const hsl = (h, s, l, a) =>
    `hsla(${h.toFixed(1)},${(s * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%,${a})`;

  // Tiny keyed single-slot caches for gradient objects.
  const caches = {};
  function cached(name, key, make) {
    const slot = caches[name] || (caches[name] = { key: null, value: null });
    if (slot.key !== key) {
      slot.key = key;
      slot.value = make();
    }
    return slot.value;
  }

  function init(el) {
    canvas = el;
    ctx = canvas.getContext('2d');
    resize();
  }

  function resize() {
    const m = Viewport.compute();
    canvas.width = Math.round(m.vw * m.dpr);
    canvas.height = Math.round(m.vh * m.dpr);
    for (const k of Object.keys(caches)) caches[k].key = null;
  }

  // ---------------------------------------------------------------- gradients

  function scleraGradient(d, w, h) {
    const key = `${Math.round(d.scleraBrightness * 100)}|${Math.round(d.scleraHue)}|${Math.round(d.scleraSat * 100)}|${Math.round(w)}`;
    return cached('sclera', key, () => {
      const g = ctx.createRadialGradient(0, -h * 0.1, w * 0.05, 0, 0, w * 0.62);
      const l = d.scleraBrightness;
      // Never pure white (§7.4): slight warm yellowing, shadowed corners.
      g.addColorStop(0, hsl(d.scleraHue, d.scleraSat, clamp01(l * 1.02), 1));
      g.addColorStop(0.62, hsl(d.scleraHue, d.scleraSat, l * 0.94, 1));
      g.addColorStop(1, hsl(d.scleraHue, Math.min(0.6, d.scleraSat + 0.08), l * 0.62, 1));
      return g;
    });
  }

  function glowGradient(d) {
    const key = `${Math.round(d.irisHue)}|${Math.round(d.irisSat * 100)}`;
    return cached('glow', key, () => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
      const h = d.irisHue;
      const s = Math.min(1, d.irisSat * 0.8);
      g.addColorStop(0, hsl(h, s, 0.62, 0.55));
      g.addColorStop(0.45, hsl(h, s, 0.55, 0.18));
      g.addColorStop(1, hsl(h, s, 0.5, 0));
      return g;
    });
  }

  function lidShadowGradient() {
    // Unit-space gradient (y 0→1), positioned per frame with a transform.
    return cached('lidShadow', 'static', () => {
      const g = ctx.createLinearGradient(0, 0, 0, 1);
      g.addColorStop(0, `rgba(15,8,5,${CONFIG.lidShadowAlpha})`);
      g.addColorStop(1, 'rgba(15,8,5,0)');
      return g;
    });
  }

  // -------------------------------------------------------------------- eyes

  // Almond eye path (§7.2 cue 5): two beziers meeting at a raised outer
  // corner and a lower inner (tear-duct) corner. Bezier control-point y is
  // peak/0.75 since endpoints sit near y=0.
  function eyePath(w, h, yT, yB, isR) {
    const cInY = 0.05 * h;
    const cOutY = -0.06 * h;
    const xL = -w * (isR ? 0.54 : 0.5); // inner corner extends slightly (duct)
    const xR = w * (isR ? 0.5 : 0.54);
    const yL = isR ? cInY : cOutY;
    const yR = isR ? cOutY : cInY;
    const p = new Path2D();
    p.moveTo(xL, yL);
    p.bezierCurveTo(-w * 0.22, yT * 1.33, w * 0.22, yT * 1.33, xR, yR);
    p.bezierCurveTo(w * 0.24, yB * 1.38, -w * 0.24, yB * 1.38, xL, yL);
    p.closePath();
    return p;
  }

  function drawEye(d, isR, w, h) {
    const asym = isR ? d.lidAsym : 0;
    const blinkEnv = isR ? (d.blinkR ?? 1) : (d.blinkL ?? 1);
    const open = clamp01(d.lidUpper + asym) * blinkEnv;

    // Lid geometry: lower lid rests low and rises with lidLower; the upper
    // lid closes down to MEET the lower lid, so a blink actually shuts.
    const yB = h * (0.06 + 0.30 * (1 - 0.7 * d.lidLower));
    const yT = yB - (yB + h * 0.50) * open;

    // Glow behind the eye (§7.5): additive, cached gradient.
    if (d.glowIntensity > 0.01) {
      const gr = w * (CONFIG.glowBaseFrac + CONFIG.glowSpanFrac * d.glowRadius);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = d.glowIntensity * Math.max(0.25, open);
      ctx.scale(gr, gr * 0.8);
      ctx.fillStyle = glowGradient(d);
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    }

    const irisD = d.irisSize * w;
    const irisR = irisD / 2;

    if (open > 0.02) {
      const path = eyePath(w, h, yT, yB, isR);

      // Sclera (§1.2, §7.4).
      ctx.fillStyle = scleraGradient(d, w, h);
      ctx.fill(path);

      ctx.save();
      ctx.clip(path);

      // Iris texture, offset by gaze. Down-range ≈ 2× up-range (§8).
      const gx = d.gazeX * CONFIG.gazeTravelX * w;
      const gy = d.gazeY < 0
        ? d.gazeY * CONFIG.gazeTravelUp * h
        : d.gazeY * CONFIG.gazeTravelUp * CONFIG.gazeDownBoost * h;
      const tex = Iris.raster(d.pupilSize, d.irisHue, d.irisSat, d.irisLight);
      ctx.drawImage(tex, gx - irisR, gy - irisR, irisD, irisD);

      // Lid shadow (§7.2 cue 3): the upper lid darkens the top of the eyeball.
      const depth = h * CONFIG.lidShadowDepth;
      ctx.save();
      ctx.translate(0, yT);
      ctx.scale(1, depth);
      ctx.fillStyle = lidShadowGradient();
      ctx.fillRect(-w * 0.6, 0, w * 1.2, 1);
      ctx.restore();

      // Caruncle: faintly warm tear-duct corner (§7.4). Subtle — a warm cast,
      // not a visible sore.
      const ductX = (isR ? -1 : 1) * w * 0.51;
      ctx.beginPath();
      ctx.ellipse(ductX, h * 0.04, w * 0.04, h * 0.07, 0, 0, TAU2);
      ctx.fillStyle = 'rgba(140,75,65,0.22)';
      ctx.fill();

      // Catchlight (§7.2 cue 1): one bright offset dot, same light direction
      // in both eyes; a faint secondary opposite it.
      if (d.catchlightIntensity > 0.01) {
        const co = irisR * CONFIG.catchlightOffset;
        ctx.beginPath();
        ctx.arc(gx - co, gy - co, irisR * CONFIG.catchlightSize, 0, TAU2);
        ctx.fillStyle = `rgba(255,252,246,${0.95 * d.catchlightIntensity})`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(gx + co * 0.8, gy + co * 0.9, irisR * CONFIG.catchlightSize * 0.4, 0, TAU2);
        ctx.fillStyle = `rgba(255,252,246,${0.3 * d.catchlightIntensity})`;
        ctx.fill();
      }

      ctx.restore();

      // Upper lash line: defines the lid edge so the eye doesn't float.
      ctx.beginPath();
      const xL = -w * (isR ? 0.54 : 0.5);
      const xR2 = w * (isR ? 0.5 : 0.54);
      const yL = isR ? 0.05 * h : -0.06 * h;
      const yR = isR ? -0.06 * h : 0.05 * h;
      ctx.moveTo(xL, yL);
      ctx.bezierCurveTo(-w * 0.22, yT * 1.33, w * 0.22, yT * 1.33, xR2, yR);
      ctx.strokeStyle = 'rgba(18,10,8,0.65)';
      ctx.lineWidth = Math.max(1, w * 0.016);
      ctx.stroke();
    } else {
      // Closed: a faint curved seam so blinks read as blinks, not flicker.
      ctx.beginPath();
      ctx.moveTo(-w * 0.5, 0.02 * h);
      ctx.quadraticCurveTo(0, yB * 1.2, w * 0.5, 0.02 * h);
      ctx.strokeStyle = `rgba(120,95,80,${0.35 * d.scleraBrightness})`;
      ctx.lineWidth = Math.max(1, w * 0.012);
      ctx.stroke();
    }

    drawBrow(d, isR, w, h);
  }

  function drawBrow(d, isR, w, h) {
    if (d.browVisible <= 0.01) return;
    const raise = isR ? d.lidAsym * CONFIG.lidAsymBrowFactor : 0;
    const browH = Math.min(1.4, d.browHeight + raise);
    const cy = -h * (0.78 + 0.35 * browH);

    ctx.save();
    // Canonical frame: -x = inner (nose) end. Mirror per side so browAngle
    // negative always pulls the INNER ends down (§8).
    ctx.scale(isR ? 1 : -1, 1);
    ctx.translate(0, cy);
    ctx.rotate(d.browAngle * DEG);

    const tIn = h * 0.13;   // inner thickness
    const tOut = h * 0.045; // tapered outer end
    const archLift = -d.browArch * h * 0.30;
    const x0 = -w * 0.46, x1 = w * 0.5;
    const y0 = h * 0.02, y1 = h * 0.06;

    ctx.beginPath();
    ctx.moveTo(x0, y0 - tIn / 2);
    ctx.quadraticCurveTo(0, archLift - tIn / 2, x1, y1 - tOut / 2);
    ctx.lineTo(x1, y1 + tOut / 2);
    ctx.quadraticCurveTo(0, archLift + tIn / 2, x0, y0 + tIn / 2);
    ctx.closePath();
    ctx.fillStyle = `rgba(26,15,12,${d.browVisible})`;
    ctx.fill();
    ctx.restore();
  }

  // -------------------------------------------------------------------- frame

  function render(d) {
    const m = Viewport.metrics;
    ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, m.vw, m.vh);

    const w = m.eyeW * d.eyeScale;
    const h = w * CONFIG.eyeAspect;
    const centerDist = w * (1 + CONFIG.gapFrac * d.separation);
    const cx = m.vw / 2 + d.posX * m.travelX;
    const cy = m.vh / 2 + d.posY * m.travelY;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(d.headTilt * DEG); // rotates the pair about its midpoint (§8)

    ctx.save();
    ctx.translate(-centerDist / 2, 0);
    drawEye(d, false, w, h);
    ctx.restore();

    ctx.save();
    ctx.translate(centerDist / 2, 0);
    drawEye(d, true, w, h);
    ctx.restore();

    ctx.restore();
  }

  return { init, resize, render };
})();
