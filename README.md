# eyes-ha

A quick hobby project: a pair of animated eyes projected onto an upstairs
window for Halloween, controlled from Home Assistant.

Everything is drawn in code on a 2D canvas. No build step, no image assets,
no backend. The iris is generated procedurally from a seed, and a constantly
running "life layer" (microsaccades, asymmetric blinks, drift, breathing)
keeps the eyes from ever sitting still. On top of that sit eight moods
(dormant through rage, plus one that implies a talking face) and a few
one-shots: lunge, vanish, drop.

Control arrives over MQTT with Home Assistant device discovery, so the whole
thing shows up as a single HA device with preset buttons, gaze zones, an
intensity slider, and trigger buttons. If the broker is unreachable the show
still runs from the keyboard.

`SPEC.md` is the full design doc, including why the sclera matters more than
the glow and why the creepiness lives in the behavior rather than the pixels.

## Running it

Serve the directory as static files and open `index.html`. For MQTT, copy
`config.example.js` to `config.js` and point it at your broker's websocket
listener. If you serve the page over HTTPS, proxy the broker on the same
origin at `/mqtt` (`tailscale serve` handles both jobs nicely).

## Keys

`1`-`5` presets, `q` rage, `w` speaking, `g` gentle, `s` sleep, `f` lunge
(or hold Shift to hold the lunge), `v` vanish, `d` drop/rise, `e` cycle gaze
zones, `a`/`z` intensity, backtick for the tuning panel, `?` for the full
list.

## License

MIT.
