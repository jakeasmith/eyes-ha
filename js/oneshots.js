'use strict';
// One-shots (§10.2 Lunge, §10.3 Vanish) and the §13 behavior rules that
// govern them. The §3 boundary: smoothing owns preset transitions, GSAP owns
// one-shots, and a one-shot suspends smoothing on EXACTLY the keys it
// animates via Engine.lockedKeys, releasing them on completion. GSAP tweens
// write Engine.current directly; the engine skips locked keys.
//
// Rendering must continue if GSAP failed to load — triggers just no-op.

const Oneshots = (() => {
  const rand = mulberry32(SEED ^ 0x05E7);
  let lungeTl = null;
  let vanishTl = null;
  let blackout = false; // §10.3 hold: nothing rendered — checked by main loop
  let lungeHeld = false;      // Shift-held lunge: holds until released
  let heldPrevPupil = null;

  const hasGsap = () => {
    if (typeof gsap !== 'undefined') return true;
    console.warn('one-shot skipped: GSAP not loaded');
    return false;
  };

  function lock(keys) { for (const k of keys) Engine.lockedKeys.add(k); }
  function unlock(keys) { for (const k of keys) Engine.lockedKeys.delete(k); }

  // ---- Lunge (§10.2) ------------------------------------------------------
  const LUNGE_KEYS = ['lidUpper', 'eyeScale', 'gazeX', 'gazeY', 'jitter'];

  // Attack tweens shared by both lunge modes.
  function lungeAttack(tlVars) {
    const O = CONFIG.oneshot;
    const cur = Engine.current;
    const z = ZONES[Engine.activeZone] || ZONES.away;
    lock(LUNGE_KEYS);
    return gsap.timeline(tlVars)
      .to(cur, { lidUpper: 1.0, eyeScale: O.lungeEyeScale, duration: O.lungeAttack, ease: 'power3.out' }, 0)
      .to(cur, { gazeX: z.gazeX, gazeY: z.gazeY, duration: O.lungeAttack, ease: 'power3.out' }, 0)
      .set(cur, { jitter: O.lungeJitter }, 0);
  }

  // Held lunge: attack on Shift down, hold for as long as it's held.
  function lungeStart() {
    if (!hasGsap()) return;
    if (lungeHeld || (lungeTl && lungeTl.isActive())) return;
    lungeHeld = true;
    heldPrevPupil = Engine.target.pupilSize;
    Engine.target.pupilSize = PARAM_META.pupilSize.max;
    lungeTl = lungeAttack({});
  }

  // Release: unlock and let the engine smooth everything home to the
  // still-active preset — "back to normal" is wherever we lunged from.
  function lungeEnd() {
    if (!lungeHeld) return;
    lungeHeld = false;
    if (lungeTl) { lungeTl.kill(); lungeTl = null; }
    unlock(LUNGE_KEYS);
    // Restore the pupil target only if nothing else (a preset change mid-
    // hold) already rewrote it; recovery runs on the slow §5.2 release.
    if (Engine.target.pupilSize === PARAM_META.pupilSize.max) {
      Engine.target.pupilSize = heldPrevPupil;
    }
  }

  function lunge() {
    if (!hasGsap()) return;
    if (lungeHeld) return; // a held lunge is already in charge
    // Idempotent: firing mid-lunge restarts the hold timer, never queues a
    // second. Mid-attack the hold hasn't started, so there is nothing to do.
    if (lungeTl && lungeTl.isActive()) {
      if (lungeTl.time() > lungeTl.labels.hold) lungeTl.seek('hold', false);
      return;
    }
    const O = CONFIG.oneshot;
    const cur = Engine.current;
    const W = PRESETS.watching;
    // Pupils snap wide through the ENGINE so §5.2 owns the asymmetry:
    // attack now, slow release when watching's value is restored below.
    Engine.target.pupilSize = PARAM_META.pupilSize.max;

    lungeTl = lungeAttack({ onComplete: () => { unlock(LUNGE_KEYS); Engine.applyPreset('watching'); } })
      .addLabel('hold', O.lungeAttack)
      .to({}, { duration: O.lungeHold }, 'hold')
      .to(cur, { lidUpper: W.lidUpper, eyeScale: W.eyeScale, jitter: W.jitter, duration: O.lungeRetreat, ease: 'power2.inOut' });
  }

  // ---- Vanish (§10.3) -----------------------------------------------------
  const VANISH_KEYS = ['lidUpper'];

  function vanish() {
    if (!hasGsap()) return;
    if (vanishTl && vanishTl.isActive()) return; // idempotent: one at a time
    const O = CONFIG.oneshot;
    const cur = Engine.current;
    const reopenLid = Engine.target.lidUpper; // resume the active preset
    const holdDur = O.vanishHoldMin + rand() * (O.vanishHoldMax - O.vanishHoldMin);
    lock(VANISH_KEYS);

    vanishTl = gsap.timeline({ onComplete: () => { unlock(VANISH_KEYS); blackout = false; } })
      .to(cur, { lidUpper: 0, duration: CONFIG.blinkCloseSec, ease: 'power2.in' }, 0)
      .call(() => {
        blackout = true;
        // Reopen at a different posY: a random jump within the envelope.
        // Where the viewport affords no vertical travel this is a no-op on
        // screen by construction (§4.1). Applied while nothing renders.
        const jump = (O.vanishJumpMin + rand() * (O.vanishJumpMax - O.vanishJumpMin))
          * (rand() < 0.5 ? -1 : 1);
        const posY = Math.max(-1, Math.min(1, Engine.current.posY + jump));
        Engine.current.posY = posY;
        Engine.target.posY = posY; // persists until the next Vanish
      })
      .to({}, { duration: holdDur })
      .call(() => { blackout = false; })
      .to(cur, { lidUpper: reopenLid, duration: O.reopenSec, ease: 'power2.out' });
  }

  // ---- §13: Gentle overrides everything; Sleep cancels everything ---------
  function cancelAll() {
    if (lungeTl) { lungeTl.kill(); lungeTl = null; }
    if (vanishTl) { vanishTl.kill(); vanishTl = null; }
    lungeHeld = false;
    Engine.lockedKeys.clear();
    blackout = false;
  }

  function gentle() { cancelAll(); Engine.applyPreset('gentle'); }
  function sleep() { cancelAll(); Engine.applyPreset('dormant'); }

  return {
    lunge, lungeStart, lungeEnd, vanish, gentle, sleep, cancelAll,
    get blackout() { return blackout; },
  };
})();
