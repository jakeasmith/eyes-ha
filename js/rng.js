'use strict';
// Seeded randomness. Separate streams (iris vs. life) so tuning one doesn't
// reshuffle the other; both derive from the single SEED constant.

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 1-D value noise (§6.4): seeded lattice of random values, smoothstep
// interpolation between them. Returns 0..1; callers recenter as needed.
function makeNoise1D(seed) {
  const rand = mulberry32(seed);
  const lattice = [];
  const at = (i) => {
    while (lattice.length <= i) lattice.push(rand());
    return lattice[i];
  };
  return function (t) {
    if (t < 0) t = 0;
    const i = Math.floor(t);
    const f = t - i;
    const s = f * f * (3 - 2 * f);
    return at(i) * (1 - s) + at(i + 1) * s;
  };
}
