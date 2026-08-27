# Halloween Eyes — Implementation Spec

A single-page browser app rendering **one pair** of animated, expressive eyes, projected from indoors onto a tall portrait window. Controlled live from Home Assistant over MQTT.

---

## 1. Design Thesis

Read this before implementing anything else. It governs the choices below.

Creepiness is not a visual style — it is a specific perceptual failure. The best account in the literature is **disrupted mentalization**: difficulty apprehending the mind of another being in a way that makes it seem threateningly unpredictable, inside a broader ambiguity about whether a threat is present.

Two consequences:

1. **You need a legible mind in order to disrupt it.** Stylized glowing ovals read as decorative, not creepy, because there is no apparent intent to become uncertain about.
2. **The strangeness lives in behavior, not geometry.** The life layer (§6) and escalation presets are the payload. Rendering exists to make them legible.

### 1.1 Stylization target — "lifelike," not "photoreal"

**This is clearly an animation.** Read "realism" throughout this document as *anatomically informed illustration*, at roughly the fidelity of a well-painted game character — never as a photograph.

The reasoning is not effort-saving:

- **The valley is crossed by motion, not pixels.** A stylized eye that moves perfectly is far more unsettling than a photoreal eye that moves slightly wrong. The latter reads as cheap CGI — a quality judgment, not a fear response. Spend the fidelity budget on §6.
- **Fine detail is wasted.** This is viewed at a distance, in the dark, at whatever scale the display affords. Texture below a certain size is thrown away before anyone sees it.
- **A photographic eye in a black field reads as a cutout** — a sticker on a window. An illustrated one reads as intentional.
- **Legibility comes from silhouette and value contrast**, which stylization sharpens.

The operative split: **the anatomy research below tells you *which* features to include; stylization tells you *how* to draw them.** Both are independent. Limbal ring, collarette, catchlight, and lid shadow all still apply — rendered as illustration.

### 1.2 The sclera is load-bearing

The uncanny response appears keyed on **sclera** — human eyes have large, visible, distinctive whites, and artificial or uncanny eyes have disproportionate, unnatural, or missing sclera.

So: **do not build glowing irises floating in black.** Build a large, clearly visible, off-white sclera containing a normal-looking eye, and let it *behave* wrong. Abnormal sclera *color* is a strong lever — reserve it for Rage rather than spending it at baseline.

---

## 2. Constraints

**Hard constraint: no build step.** The rationale, so the implementer can apply judgment rather than follow a rule:

- **Longevity.** This runs one night and sleeps eleven months. A single HTML file opens in five years exactly as it opens today. A `node_modules` tree does not.
- **Portability.** Fewer moving parts between "I want to see the eyes" and seeing the eyes.

This is not a prohibition on libraries — see §3. TypeScript is an acceptable exception if the implementer wants it; a 30-key parameter object where `display.pupilSze` fails silently is a real hazard. If TS is used, keep the compiled output committed so the no-build property survives.

| Constraint | Value |
|---|---|
| Build step | None (TS optional, output committed) |
| Rendering | Canvas 2D |
| Backend | None — browser talks to Mosquitto directly |
| Serving | Static files behind `tailscale serve` (HTTPS, tailnet-only) |
| File count | One `.html`. No external assets. |

**Non-goals:** lip sync, mouth, face, nose, **more than one pair of eyes**, audio playback, a build pipeline, a server.

---

## 3. Libraries

| Library | Role | Required? |
|---|---|---|
| **mqtt.js** | Control layer over websockets | Yes |
| **GSAP** | One-shot sequences (Lunge, Vanish) | Strongly recommended |
| **Tweakpane** | Dev-only tuning panel | Dev only |
| **stats.js** | Dev-only FPS meter | Dev only |

All four are script tags. GSAP is free for commercial use including all former Club plugins.

**Critical architectural rule.** GSAP and the smoothing engine (§5) must never both own the same parameter — two authorities writing one value produces stutter that is miserable to debug. The boundary:

- Smoothing owns **preset transitions**.
- GSAP owns **one-shots**.
- A one-shot **suspends smoothing** on exactly the keys it touches, and releases them on completion.

Implement this as an explicit `lockedKeys` Set checked by the smoothing loop.

**Tweakpane must be dev-only.** Bind it to the live parameter objects, include a "copy values to clipboard" button so tuned settings paste back into source, and hide it behind a keypress so it never appears on the live display.

---

## 4. Display & Serving

### 4.1 Display is unknown — adapt to it

**Make no assumptions about resolution, aspect ratio, or display device.** The page must work correctly in whatever viewport the browser reports, from a phone in portrait to an ultrawide monitor, and adapt if that changes mid-session.

Derive everything from the viewport at runtime:

- **Eye scale** from the smaller viewport dimension, so the pair is never clipped.
- **Movement envelope** from the *larger* dimension. This is the useful part: whatever space exists beyond what the eyes occupy is room the character can move through. A tall narrow viewport gives vertical travel; a wide one gives horizontal.
- **Recompute on `resize`**, including orientation change and DPR change.

Expose the envelope as two parameters, `posX` and `posY` (§8), normalized -1 to 1 against the available travel. At an aspect ratio where one axis has no spare room, that axis simply clamps to 0 and nothing else changes. No special cases, no layout modes.

This turns Vanish (§10.3) from a hack into a natural consequence: it reopens at a different `posY` because `posY` is a real parameter, not because the renderer has a hidden Y-offset.

### 4.2 Visual requirements

- **Pure black background** (`#000000`). This is an aesthetic choice — the character exists in a void, with nothing to anchor it or give it scale.
- `cursor: none`, no scrollbars, no page chrome.
- **`MIRROR` config flag**, default off. Horizontally flips the canvas via `transform: scaleX(-1)` for display setups that need it. Purely optional; nothing else in the spec depends on it.

### 4.3 Serving

Hosted on a server, exposed via `tailscale serve`. Two consequences that matter:

**Wake Lock works.** Tailscale Serve provisions a TLS certificate automatically for the tailnet DNS name, so the page loads over HTTPS and counts as a secure context. Request the lock via `navigator.wakeLock`, feature-detect with `"wakeLock" in navigator`, and **re-request on `visibilitychange`** — locks auto-release when the document becomes inactive.

**The broker connection must be `wss://`.** An HTTPS page cannot open a plain `ws://` socket; browsers block it as mixed content, and it will fail with a console error rather than a visible symptom. See §11.1.

Note the display device is not the host. The browser rendering this may be a laptop, a tablet, a Pi — which is exactly why §4.1 assumes nothing.

## 5. Rendering Architecture

### 5.1 Three-layer state model

1. **`target`** — the requested preset. Snaps on preset change.
2. **`current`** — lerps toward `target` each frame, per key.
3. **`display`** — `current` plus the life layer (§6) and intensity scaling (§8). What the renderer consumes. Never written back into `current`.

Frame-rate-independent exponential smoothing:

```js
current[k] += (target[k] - current[k]) * (1 - Math.exp(-dt / tau));
```

Not a fixed `* 0.1` lerp. Default `tau` ≈ 250ms → visually complete in ~800ms. Skip any key in `lockedKeys` (§3).

**Jagged flashes are structurally impossible under this model.** Preserve that. Anything needing an instant change (Vanish) is an explicit separate mechanism, never a bypass.

### 5.2 Asymmetric pupil dynamics

Pupil size does **not** use the shared `tau`. Real dilation and constriction are asymmetric: arousal dilation begins within ~200ms, while light-driven constriction bottoms out around 1s with redilation completing near 3s.

Use `pupilAttackMs` (default 200) when dilating and `pupilReleaseMs` (default 1400) when constricting. Snapping wide fast and recovering slowly reads as involuntary — exactly the register wanted.

### 5.3 Other rules

- `irisHue` and `scleraHue` are circular — interpolate along the shorter arc.
- `requestAnimationFrame`, delta-time based, `dt` clamped to ~50ms.
- Handle resize and `devicePixelRatio`.
- **Cache all gradient objects outside the render loop.** Recreating `createRadialGradient` per frame is the classic canvas perf trap. Regenerate only on preset change or resize.

---

## 6. The Life Layer

Per §1, this is where creepiness actually comes from. It is the primary mechanism, not polish. Budget accordingly.

Applied to `display` every frame on top of `current`, always active, scaled by `driftSpeed` and `intensity`.

### 6.1 Two distinct saccade behaviors

These are different behaviors and must not share a rate:

| Behavior | Rate | Amplitude | When |
|---|---|---|---|
| **Microsaccades** | ~1/s | ≤4% eye width | Always. A staring creature is here. |
| **Scanning saccades** | 3–4/s | large | Only when actively searching (Stirring). |

Fixations sit around 250ms — roughly four saccades per second — while microsaccades run about one per second. A creature *staring at you* should be at microsaccade rate. Running scan rate continuously looks frantic, not predatory. Two parameters: `microsaccadeRate`, `scanRate`.

Saccade onset should be fast (~60ms) then hold. Never perfectly centered for more than a couple of seconds.

### 6.2 Blinks

Real blinks run 100–400ms with roughly 50ms fully closed; adults blink 16–20 times per minute at baseline.

- Close fast (~80ms), open slower (~150ms).
- **Never in perfect sync** — offset the right eye 15–60ms. Perfect sync reads as mechanical.
- Roughly 1 in 8 blinks holds closed 400–900ms.
- **Reduced blink rate reads as predatory.** Watching sits deliberately below human baseline (§10.1). This is a choice, not an error.

### 6.3 Blink–saccade coupling

Blinks begin slightly before or simultaneously with **upward** saccades, but never after; with downward saccades they are sometimes initiated after onset. So: trigger a blink at the *start* of an upward gaze shift, and optionally *after* onset on a downward one. Almost nobody animates this, and it costs about six lines.

### 6.4 Drift

- Value noise on `browAngle`, ±2°, period 4–8s.
- Breathing: slow sinusoid on `lidUpper` (±0.03) and `eyeScale` (±0.01), period ~5s.

Hand-rolled value noise is fine — one dimension, ~15 lines.

---

## 7. Eye Rendering

### 7.1 The iris is drawn procedurally

**No image assets.** The iris is drawn in code to an offscreen canvas at startup, then blitted per frame. Per §1.1 the target is illustration, and the anatomy below is a drawing recipe rather than a reference for sourcing artwork.

Draw the iris once at high resolution into an offscreen canvas, in this order, working outward from the pupil:

1. **Base** — radial gradient from `irisLight` at the inner edge to roughly 60% of it at the limbus. Darker at the rim.
2. **Pupillary zone** (pupil margin → collarette, the inner ⅓): radial striations from the sphincter muscle. 40–70 tapered lines at randomized angles, varying length and alpha, brightest near the collarette.
3. **Collarette** — a slightly raised irregular boundary at ⅓ of the way from pupil margin to limbus. Draw as a jagged ring, brighter than its surroundings. Not a clean circle.
4. **Ciliary zone** (collarette → limbus): circumferential folds from the dilator muscle. Short arc segments, **neither continuous nor perfect circles** — that irregularity is what stops it reading as machined.
5. **Crypts** — 8–20 small dark elongated pits, arranged in loose rows, concentrated just outside the collarette.
6. **Pupillary ruff** — a dark border right at the pupil margin.
7. **Limbal ring** — dark ring at the outer edge, width per §7.3.

Regenerate this offscreen canvas **only when `irisHue`, `irisSat`, or `irisLight` change** — that is, on preset transitions, not per frame. Cache it.

**Dilation is not a scale.** Real dilation compresses the pupillary zone while the ciliary zone stays comparatively fixed. Handle it by drawing the iris in **normalized polar space** — radius expressed as fraction of the pupil-to-limbus span — and remapping that span at draw time as `pupilSize` changes. Striations compress and stretch correctly; the collarette moves; the ciliary zone barely shifts. Scaling a flat bitmap gets all three wrong.

**Expose the generation parameters** (striation count, crypt density, collarette position and irregularity, fold segment count) as `CONFIG` constants bound to Tweakpane. These are exactly the values that need trial-and-error against the real display.

Seed the randomness from a constant so the iris is reproducible between reloads — otherwise tuning is impossible.

### 7.2 Cues that sell it, in order of payoff

1. **Specular highlight (catchlight)** — one bright offset dot, consistent light direction across both eyes. Separates "alive" from "dead" more than anything else.
2. **Limbal ring** — dark ring at the iris edge. One stroke, large effect.
3. **Lid shadow** — the upper lid darkens the top of the eyeball. Without it the eye looks pasted on.
4. **Non-white sclera** — see §7.4.
5. **Almond shape** — two arcs meeting at a tear-duct point. Not a circle.

### 7.3 Limbal ring coupling

Limbal ring thickness varies **inversely** with dilation — a larger pupil narrows the ring. Derive it:

```js
limbalWidth = LIMBAL_BASE * (1 - 0.5 * normalized(pupilSize));
```

Nobody can name this effect; everybody registers it.

### 7.4 Sclera

Per §1.2 the sclera is doing predator detection, not atmosphere. Keep the baseline bright.

Sclera is never pure white: slight yellowing, and in dark-eyed people a smattering of brown pigment most pronounced near the limbus. Shadow toward the corners, faintly warm near the tear duct.

`scleraHue` / `scleraSat` are a **Rage-only lever**. People look away from human-like eyes with abnormal sclera color — that is a strong effect and spending it at baseline wastes it.

### 7.5 Compositing

Glow via cached `createRadialGradient` behind each eye, composited with `globalCompositeOperation = 'lighter'`, then reset. Clip iris and pupil to the eye shape so they vanish correctly behind closing lids.

---

## 8. Parameter Schema

### Lids
| Param | Range | Notes |
|---|---|---|
| `lidUpper` | 0–1 | 0 closed, 1 fully open |
| `lidLower` | 0–1 | 0 resting, 1 raised |
| `lidAsym` | 0–0.3 | Right-eye deviation. Never 0 for long. |

### Eye
| Param | Range | Notes |
|---|---|---|
| `pupilSize` | 0.12–0.65 | Fraction of iris radius. Asymmetric dynamics (§5.2). |
| `irisSize` | 0.3–0.6 | Fraction of eye width |
| `eyeScale` | 0.7–2.5 | 1.0 default |
| `separation` | 0.8–1.4 | Gap multiplier |

### Layout
| Param | Range | Notes |
|---|---|---|
| `posX` | -1–1 | Position within the horizontal movement envelope (§4.1) |
| `posY` | -1–1 | Position within the vertical movement envelope (§4.1) |

### Gaze
| Param | Range | Notes |
|---|---|---|
| `gazeX` | -1–1 | Negative = viewer's left |
| `gazeY` | -1–1 | Negative up, positive down. Down range ~2× up. |
| `headTilt` | -15–15 | Degrees, rotates the pair about a shared midpoint |

### Brows
| Param | Range | Notes |
|---|---|---|
| `browAngle` | -30–30 | Negative = inner ends down (angry) |
| `browHeight` | -1–1 | |
| `browArch` | 0–1 | |
| `browVisible` | 0–1 | Opacity |

### Color & Light
| Param | Range | Notes |
|---|---|---|
| `irisHue` | 0–360 | Circular interp |
| `irisSat` | 0–1 | |
| `irisLight` | 0.3–0.7 | |
| `scleraBrightness` | 0.45–0.95 | Load-bearing (§1.2). Keep high. |
| `scleraHue` | 0–360 | Rage-only lever |
| `scleraSat` | 0–0.6 | Rage-only lever |
| `catchlightIntensity` | 0–1 | |
| `glowRadius` | 0–1 | |
| `glowIntensity` | 0–1 | |

*Derived, not stored:* `limbalWidth` (§7.3), lid-gaze coupling (§9.2).

### Motion
| Param | Range | Notes |
|---|---|---|
| `jitter` | 0–1 | |
| `microsaccadeRate` | 0.3–2 | Per second. Default ~1. |
| `scanRate` | 0–4 | Per second. 0 unless searching. |
| `blinkRate` | 0–30 | Per minute. Human baseline 16–20. |
| `driftSpeed` | 0–2 | |
| `tau` | 80–600 | ms |
| `pupilAttackMs` | 120–400 | Dilation |
| `pupilReleaseMs` | 800–3000 | Constriction |

---

## 9. Gaze Zones & Intensity

### 9.1 Zones

HA gives presence, not coordinates. Targets are discrete named zones:

| Zone | gazeX | gazeY | Meaning |
|---|---|---|---|
| `sidewalk` | -0.6 | 0.35 | Far, off to one side |
| `walkway` | -0.2 | 0.6 | Approaching |
| `porch` | 0.1 | 0.85 | Directly below, close |
| `door` | 0.5 | 0.9 | At the door |
| `away` | 0.0 | -0.3 | Disengaged |

Tune at the top of the file — geometry dependent.

### 9.2 Lid–gaze coupling

**Lids must follow the pupil.** Moving only the pupil gives you eyes with pupils parked at the bottom, which does not read as looking down. Render-time derivations from `gazeY`:

- `lidUpper` reduced by up to `0.35 * max(0, gazeY)`
- `lidLower` raised by up to `0.15 * max(0, gazeY)`
- Iris ellipse squashed vertically up to 12% at full down-gaze
- `browHeight` drops by up to `0.2 * max(0, gazeY)`

### 9.3 Intensity

Global scalar 0–1, applied at the `display` stage, multiplying `jitter`, `irisSat`, `microsaccadeRate`, `glowIntensity`, `driftSpeed`. Default 0.5.

Orthogonal to preset. **Do not create scared/scarier preset variants** — this dial covers the whole night.

---

## 10. Presets

Seven resting presets plus two one-shots.

| Preset | Character |
|---|---|
| `dormant` | Lids nearly shut, slow breathing, rare slit-open. Dim. Default. |
| `stirring` | Lids peel open, pupils dilate, `scanRate` active — the only preset that scans. |
| `watching` | Locked on active zone, `scanRate` 0, microsaccades only, blink rate below human baseline. The workhorse. |
| `curious` | Head tilt 10–14°, one brow raised (`lidAsym` high), slight dilation. |
| `narrowed` | Lids tighten, brows down and in, pupils constrict, elevated microsaccades. |
| `rage` | Brows hard down, pinprick pupils, iris hue red, **sclera tinted**, high jitter, bright glow. |
| `gentle` | Brows up and arched, warm hue, soft slow blinks, large pupils, low jitter. |

### 10.1 Starting values

```js
dormant:  { lidUpper: 0.12, lidLower: 0.05, pupilSize: 0.30, irisSize: 0.42,
            eyeScale: 1.0, browAngle: 2, browHeight: -0.3, browArch: 0.3,
            browVisible: 0.4, irisHue: 30, irisSat: 0.15, irisLight: 0.35,
            scleraBrightness: 0.45, scleraHue: 40, scleraSat: 0.05,
            catchlightIntensity: 0.3, glowRadius: 0.3, glowIntensity: 0.15,
            jitter: 0.05, microsaccadeRate: 0.3, scanRate: 0, blinkRate: 2,
            driftSpeed: 0.4, tau: 500 }

stirring: { lidUpper: 0.7, lidLower: 0.08, pupilSize: 0.45, irisSize: 0.45,
            eyeScale: 1.0, browAngle: 4, browHeight: 0.1, browArch: 0.5,
            browVisible: 0.7, irisHue: 38, irisSat: 0.4, irisLight: 0.45,
            scleraBrightness: 0.7, scleraHue: 45, scleraSat: 0.06,
            catchlightIntensity: 0.6, glowRadius: 0.45, glowIntensity: 0.35,
            jitter: 0.2, microsaccadeRate: 1.0, scanRate: 3.0, blinkRate: 14,
            driftSpeed: 1.2, tau: 300 }

watching: { lidUpper: 0.85, lidLower: 0.10, pupilSize: 0.35, irisSize: 0.45,
            eyeScale: 1.0, browAngle: 0, browHeight: 0, browArch: 0.5,
            browVisible: 0.8, irisHue: 40, irisSat: 0.5, irisLight: 0.5,
            scleraBrightness: 0.85, scleraHue: 45, scleraSat: 0.05,
            catchlightIntensity: 0.8, glowRadius: 0.5, glowIntensity: 0.45,
            jitter: 0.12, microsaccadeRate: 1.0, scanRate: 0, blinkRate: 8,
            driftSpeed: 1.0, tau: 250 }

rage:     { lidUpper: 0.95, lidLower: 0.30, pupilSize: 0.14, irisSize: 0.48,
            eyeScale: 1.15, browAngle: -26, browHeight: -0.7, browArch: 0.1,
            browVisible: 1.0, irisHue: 2, irisSat: 0.95, irisLight: 0.5,
            scleraBrightness: 0.9, scleraHue: 8, scleraSat: 0.45,
            catchlightIntensity: 1.0, glowRadius: 0.85, glowIntensity: 0.9,
            jitter: 0.8, microsaccadeRate: 2.0, scanRate: 0, blinkRate: 3,
            driftSpeed: 1.6, tau: 120 }

gentle:   { lidUpper: 0.75, lidLower: 0.05, pupilSize: 0.52, irisSize: 0.50,
            eyeScale: 1.0, browAngle: 14, browHeight: 0.4, browArch: 0.9,
            browVisible: 0.8, irisHue: 45, irisSat: 0.45, irisLight: 0.62,
            scleraBrightness: 0.8, scleraHue: 45, scleraSat: 0.04,
            catchlightIntensity: 0.7, glowRadius: 0.6, glowIntensity: 0.4,
            jitter: 0.02, microsaccadeRate: 0.5, scanRate: 0, blinkRate: 12,
            driftSpeed: 0.6, tau: 350 }
```

Fill `curious` and `narrowed` by interpolating the table descriptions. **All values are informed guesses, not measurements — starting points to be tuned by eye.**

### 10.2 Lunge (one-shot, GSAP timeline)

1. `lidUpper` → 1.0, `eyeScale` → ~2.3 over **~120ms** (the one place a hard motion is correct)
2. Pupils snap wide using `pupilAttackMs`
3. Gaze snaps to active zone
4. Hold ~400ms, high jitter
5. Retreat over ~600ms; pupils recover on `pupilReleaseMs` (slower than they opened)
6. Auto-return to `watching`

**Idempotent** — firing mid-lunge restarts the hold timer, never queues a second.

### 10.3 Vanish (one-shot)

1. Fast full blink to closed
2. Hold fully black **2.5–5s** (nothing rendered)
3. Reopen at a **different `posY`** — a random jump of 0.3–0.8 within the envelope (§4.1)
4. Resume previous preset

New position persists until the next Vanish. Still one pair — this is repositioning, not duplication. Where the viewport affords little vertical travel, the jump shrinks or vanishes on its own; no special handling.

---

## 11. MQTT Interface

### 11.1 Connection

`mqtt.js` over **secure** websockets. The page is served over HTTPS (§4.3), so a plain `ws://` connection is blocked as mixed content. `wss://` is mandatory, not a preference.

**Proxy the broker through the same Tailscale origin.** Tailscale Serve forwards WebSocket upgrades correctly, so:

```
tailscale serve --set-path /mqtt http://localhost:1884
```

then connect to `wss://<host>.<tailnet>.ts.net/mqtt`. Same origin as the page, TLS terminated by Tailscale, no certificates to manage on Mosquitto.

**Caveat: do not put anything in the `wss://` query string.** There is a known Tailscale issue where query parameters are stripped from WebSocket upgrade requests before reaching the backend. Irrelevant if the URL is just a path — a trap if credentials or options are ever passed that way. Pass connection options through mqtt.js's options object, never the URL.

*Fallback if the proxy misbehaves:* direct `wss://` to Mosquitto on 8884, which requires configuring certs on the broker. The HA add-on defaults are 1883/1884 unencrypted (MQTT/websockets) and 8883/8884 encrypted.

Broker URL and base topic from URL query params. **Credentials must not go in query params** (browser history) — use a small `config.js` sibling file, gitignored, or prompt once and hold in memory. Tailnet-only exposure reduces but does not remove the need for this.

**Last Will required:**

```js
{ will: { topic: `${base}/status`, payload: 'offline', retain: true, qos: 1 } }
```

Publish `online` (retained) on connect. Auto-reconnect with backoff. **Rendering must continue uninterrupted regardless of MQTT state.**

### 11.2 Topics

Base default: `eyes`

| Topic | Direction | Payload |
|---|---|---|
| `eyes/status` | out, retained | `online` / `offline` |
| `eyes/preset` | out, retained | current preset name |
| `eyes/preset/set` | in | preset name |
| `eyes/gaze` | out, retained | zone name |
| `eyes/gaze/set` | in | zone name |
| `eyes/intensity` | out, retained | `0.0`–`1.0` |
| `eyes/intensity/set` | in | `0.0`–`1.0` |
| `eyes/auto` | out, retained | `ON` / `OFF` |
| `eyes/auto/set` | in | `ON` / `OFF` |
| `eyes/trigger/set` | in | `lunge` \| `vanish` \| `notice` \| `sleep` |

### 11.3 State echo — mandatory

Always publish actual state back on the non-`/set` topics. Never optimistic. Presets time out on their own and Lunge auto-returns, so HA must hear about transitions it did not command.

---

## 12. Home Assistant Discovery

Publish **retained** to `homeassistant/device/halloween_eyes/config`. The `<component>` path segment is literally `device` — this is device discovery, one payload for all entities.

Requirements:
- `dev` (device) and `o` (origin) mappings at root level are **mandatory** for device discovery and cannot be overridden per-component.
- Each entry under `cmps` needs a `p` (platform) option and a `unique_id`.

```json
{
  "dev": {
    "ids": "halloween_eyes",
    "name": "Halloween Eyes",
    "mf": "Haunted Labs",
    "mdl": "Procedural Eyes",
    "sw": "1.0"
  },
  "o": { "name": "halloween-eyes", "sw": "1.0" },
  "avty_t": "eyes/status",
  "cmps": {
    "preset": {
      "p": "select",
      "name": "Preset",
      "unique_id": "halloween_eyes_preset",
      "command_topic": "eyes/preset/set",
      "state_topic": "eyes/preset",
      "options": ["dormant","stirring","watching","curious","narrowed","rage","gentle"]
    },
    "gaze": {
      "p": "select",
      "name": "Gaze Zone",
      "unique_id": "halloween_eyes_gaze",
      "command_topic": "eyes/gaze/set",
      "state_topic": "eyes/gaze",
      "options": ["sidewalk","walkway","porch","door","away"]
    },
    "intensity": {
      "p": "number",
      "name": "Intensity",
      "unique_id": "halloween_eyes_intensity",
      "command_topic": "eyes/intensity/set",
      "state_topic": "eyes/intensity",
      "min": 0, "max": 1, "step": 0.05, "mode": "slider"
    },
    "auto": {
      "p": "switch",
      "name": "Auto Escalate",
      "unique_id": "halloween_eyes_auto",
      "command_topic": "eyes/auto/set",
      "state_topic": "eyes/auto"
    },
    "btn_notice": {
      "p": "button", "name": "Notice",
      "unique_id": "halloween_eyes_notice",
      "command_topic": "eyes/trigger/set", "payload_press": "notice"
    },
    "btn_lunge": {
      "p": "button", "name": "Lunge",
      "unique_id": "halloween_eyes_lunge",
      "command_topic": "eyes/trigger/set", "payload_press": "lunge"
    },
    "btn_vanish": {
      "p": "button", "name": "Vanish",
      "unique_id": "halloween_eyes_vanish",
      "command_topic": "eyes/trigger/set", "payload_press": "vanish"
    },
    "btn_gentle": {
      "p": "button", "name": "Gentle",
      "unique_id": "halloween_eyes_gentle",
      "command_topic": "eyes/preset/set", "payload_press": "gentle"
    },
    "btn_sleep": {
      "p": "button", "name": "Sleep",
      "unique_id": "halloween_eyes_sleep",
      "command_topic": "eyes/trigger/set", "payload_press": "sleep"
    },
    "current": {
      "p": "sensor",
      "name": "Current Preset",
      "unique_id": "halloween_eyes_current",
      "state_topic": "eyes/preset"
    }
  }
}
```

The preset dropdown lists **resting presets only**. One-shots are buttons — selecting a one-shot as a resting state would put the app in a state it is designed to exit.

### 12.1 The five night-of buttons

| Button | Action |
|---|---|
| **Notice** | `dormant` → `stirring` → `watching`, gaze to `walkway`. Manual override when the sensor misses. |
| **Lunge** | §10.2. Self-terminating. |
| **Vanish** | §10.3. |
| **Gentle** | Overrides everything in flight. |
| **Sleep** | Hard return to `dormant`. Cancels all timers and one-shots. |

**Dashboard layout matters.** Put Gentle on a different row and different color from Lunge — the one misfire that genuinely ruins someone's night is hitting Lunge on a three-year-old. Big tiles; this is operated outdoors, in the dark, one-handed.

---

## 13. Behavior Rules

1. **Timeouts.** `narrowed` and `rage` auto-return to `watching` after **90s** without a new command.
2. **Gentle overrides everything**, from any state, mid-animation, including an in-flight Lunge. Must always work.
3. **Idempotency.** All triggers safe to fire repeatedly.
4. **`auto` switch.** The app only exposes the switch and echoes its state. HA automations check it as a condition. No app-side gating logic.
5. **Unknown payloads** ignored, logged, never crash the loop.

---

## 14. Local Keyboard Fallback

If MQTT is unreachable the show still runs. The map is left-hand-first so the operator can drive it one-handed: `1`–`5` dormant/stirring/watching/curious/narrowed, `Q` rage, `W` speaking, `G` Gentle (doubles as the §13 override), `S` Sleep, `F` Lunge, `V` Vanish, `E` cycles gaze zones, `A`/`Z` intensity up/down, `` ` `` Tweakpane. Right hand (rare): `M` mirror toggle, `?` shortcut overlay.

---

## 15. Acceptance Criteria

- [ ] Runs from static files behind `tailscale serve` with no build step; Wake Lock acquired and re-acquired after visibility change
- [ ] 4+ hours without memory growth, frame decay, or display sleep
- [ ] Pure black everywhere except eyes and glow
- [ ] **Correct at any viewport** — phone portrait, ultrawide, square, and resized mid-session without reload
- [ ] Movement envelope uses available space on whichever axis has it; clamps gracefully where it doesn't
- [ ] Broker connects over `wss://` with no mixed-content errors in console
- [ ] **Sclera is large, clearly visible, and off-white at baseline** — not a glowing iris in a void
- [ ] Sclera tinting appears in Rage and nowhere else
- [ ] No preset transition snaps or flashes (except intentional Lunge onset and Vanish blackout)
- [ ] Eyes never perfectly still; blinks visibly asymmetric between the two
- [ ] Watching uses microsaccades only — no continuous scanning
- [ ] Pupils dilate fast and recover slowly, visibly asymmetric
- [ ] Limbal ring visibly narrows as the pupil widens
- [ ] Looking down reads as *looking down at you* — lids follow, not just pupils
- [ ] Gentle interrupts a Lunge mid-animation, every time
- [ ] Rage times out to Watching after 90s untouched
- [ ] Killing the tab marks the HA device unavailable within seconds
- [ ] All controls appear under one HA device card from a single discovery message, no YAML, no restart
- [ ] Double-tapping Lunge does not queue two lunges
- [ ] Everything still works after the broker restarts mid-session
- [ ] Tweakpane hidden by default and never visible on the live display
- [ ] No external asset files — the page renders correctly with nothing but the `.html` and its CDN script tags
- [ ] Iris regenerates only on hue/saturation change, never per frame
- [ ] Dilation compresses the pupillary zone rather than uniformly scaling the iris

---

## 16. Implementation Order

1. Canvas, black background, viewport-derived scale and envelope (§4.1), static eye pair — sclera, procedurally drawn iris, pupil, limbal ring, catchlight, lids, brows
2. Parameter object + smoothing engine + `lockedKeys` + keyboard preset switching + Tweakpane
3. **Life layer** — microsaccades, asymmetric blinks, blink–saccade coupling, drift, breathing
4. Gaze zones with lid coupling; head tilt
5. Asymmetric pupil dynamics; limbal ring coupling
6. Intensity scalar
7. Lunge and Vanish as GSAP timelines with idempotency
8. MQTT connect, LWT, subscribe, state echo
9. Device discovery publishing
10. Mirror, wake lock, resize/DPR, error resilience

**Steps 1–3 must look genuinely unsettling with keyboard control alone.** If they don't, no amount of Home Assistant integration will save it. Stop and tune before proceeding.

---

## 17. Notes for the Implementer

- Everything is drawn in code. Lids and brows are arcs and rotated beziers; all the expression lives there. The iris is the only piece with real internal structure (§7.1), and it is generated once and cached.
- Prefer readability at distance and low contrast over fine detail.
- Keep all tunable constants in one `CONFIG` block. Expect heavy trial-and-error against the real display.

---

## 18. Open Questions — Owner: Jake

Not blockers for steps 1–3, but needed before the night:

1. **Sensor inventory** — the gaze-zone design assumes HA presence entities mapping to sidewalk/walkway/porch/door. What actually exists?
2. **Display hardware** — the client browser's capability determines how much headroom the render loop has.

---

## 19. Footnote — Possible Library Extraction

*Not in scope. Recorded so the seam survives to a possible winter project.*

Procedural eye libraries are common but uniformly embedded and cartoon-styled — Cozmo-derived robot eyes on small OLEDs, several independently converging on this same parameters-plus-interpolation architecture. Realistic eyes, meanwhile, live in texture-and-editor tools (Uncanny Eyes, Live2D, Rive). The quadrant of **procedural parameters + illustrated realism + web** appears empty. The one web entry, CyberAgentAILab/Web-Eye-Animation, is a fixed-emotion API with no parameter layer beneath it.

If extracted, the contribution is the **parameter vocabulary**, not the interpolation engine: limbal ring coupling, asymmetric pupil dynamics, the microsaccade/scan split, blink–saccade coupling, and sclera as load-bearing.

Constraints for a future extraction:

- **Extract, don't design.** Ship this app first. Abstractions designed before a working use case are reliably worse.
- **The seam is already here.** §5–§9 is the library. §11–§13 is the app. Keep them from bleeding into each other during implementation — that discipline costs nothing now and is the entire value later.
- **Zero dependencies.** A rendering library cannot depend on GSAP. Expose parameters and let the host drive one-shots.
- **Presets as plain JSON**, so users ship personalities rather than forks.

Sketch:

```js
const eyes = new Eyes(canvas);
eyes.set({ pupilSize: 0.4, browAngle: -20 });
eyes.preset('watching', { tau: 250 });
eyes.look(x, y, z);
eyes.trigger('blink', { long: true });
eyes.intensity = 0.7;
eyes.on('blink', handler);
```