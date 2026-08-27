'use strict';
// Viewport-derived geometry (§4.1). No assumptions about resolution or aspect
// ratio: eye scale comes from the smaller dimension, the movement envelope
// from whatever space is left over on each axis. Recomputed on resize.

const Viewport = (() => {
  const metrics = {
    vw: 0, vh: 0, dpr: 1,
    eyeW: 0, eyeH: 0,        // baseline eye size at eyeScale = 1
    anchorY: 0,              // resting pair-center y (posY = 0)
    travelX: 0,              // half-range of posX in px (0 = axis clamped)
    travelYUp: 0, travelYDown: 0, // posY range above/below the anchor
  };

  function compute() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const minDim = Math.min(vw, vh);
    const eyeW = minDim * CONFIG.eyeWidthFrac;
    const eyeH = eyeW * CONFIG.eyeAspect;
    const margin = minDim * CONFIG.marginFrac;

    // Envelope at baseline scale/separation = 1: the pair may clip the edge at
    // envelope extremes when eyeScale > 1, which is acceptable (§4.1 derives
    // travel from the resting footprint, not the momentary one).
    const pairHalfW = (eyeW * (2 + CONFIG.gapFrac)) / 2;
    metrics.vw = vw;
    metrics.vh = vh;
    metrics.dpr = window.devicePixelRatio || 1;
    metrics.eyeW = eyeW;
    metrics.eyeH = eyeH;
    metrics.travelX = Math.max(0, vw / 2 - pairHalfW - margin);
    // Vertical travel is asymmetric around the anchor: posY -1..1 spans
    // whatever room exists above vs. below it.
    metrics.anchorY = vh * CONFIG.anchorY;
    metrics.travelYUp = Math.max(0, metrics.anchorY - eyeH * 0.9 - margin);
    metrics.travelYDown = Math.max(0, vh - metrics.anchorY - eyeH * 0.9 - margin);
    return metrics;
  }

  return { metrics, compute };
})();
