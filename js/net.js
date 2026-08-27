'use strict';
// MQTT control layer (§11) + HA device discovery (§12). App side of the §19
// seam: talks to Engine/Oneshots through their public surface only.
//
// Rendering must continue uninterrupted regardless of MQTT state (§11.1):
// every failure path here degrades to "keyboard-only show" with a console
// warning, never a crash. Unknown payloads are ignored and logged (§13.5).

const Net = (() => {
  let client = null;
  let base = 'eyes';
  // §13.4: the app only stores and echoes the auto switch; HA automations
  // check it as a condition. No app-side gating logic.
  let autoState = 'OFF';
  const lastEcho = { preset: null, gaze: null, intensity: null, auto: null };

  function config() {
    const cfg = window.EYES_CONFIG || {};
    const qp = new URLSearchParams(location.search);
    base = qp.get('base') || cfg.baseTopic || 'eyes';
    // Priority: query param, config.js, same-origin /mqtt path when the page
    // is HTTPS (the tailscale serve layout from §11.1).
    const url = qp.get('broker') || cfg.brokerUrl
      || (location.protocol === 'https:' ? `wss://${location.host}/mqtt` : null);
    return { url, username: cfg.username, password: cfg.password };
  }

  function init() {
    const { url, username, password } = config();
    if (!url) {
      console.warn('MQTT off: no broker URL (config.js or ?broker=)');
      return;
    }
    if (typeof mqtt === 'undefined') {
      console.warn('MQTT off: mqtt.js not loaded');
      return;
    }
    client = mqtt.connect(url, {
      username, password,
      clientId: 'eyes-' + Math.random().toString(16).slice(2, 10),
      reconnectPeriod: 3000,
      connectTimeout: 8000,
      // Last Will (§11.1): required, retained, so HA marks the device
      // unavailable within seconds of the tab dying.
      will: { topic: `${base}/status`, payload: 'offline', retain: true, qos: 1 },
    });
    client.on('connect', onConnect);
    client.on('message', (t, p) => {
      try { onMessage(t, p.toString().trim()); }
      catch (e) { console.warn('mqtt handler error', e); }
    });
    client.on('error', (e) => console.warn('mqtt:', e.message));
  }

  function onConnect() {
    client.publish(`${base}/status`, 'online', { retain: true, qos: 1 });
    publishDiscovery();
    client.subscribe([
      `${base}/preset/set`, `${base}/gaze/set`, `${base}/intensity/set`,
      `${base}/auto/set`, `${base}/trigger/set`,
      'homeassistant/status', // republish discovery when HA restarts
    ]);
    for (const k of Object.keys(lastEcho)) lastEcho[k] = null; // force re-echo
  }

  function onMessage(topic, payload) {
    if (topic === 'homeassistant/status') {
      if (payload === 'online') {
        publishDiscovery();
        for (const k of Object.keys(lastEcho)) lastEcho[k] = null;
      }
      return;
    }
    switch (topic.slice(base.length + 1)) {
      case 'preset/set':
        if (PRESETS[payload]) Engine.applyPreset(payload);
        else console.warn('unknown preset', payload);
        break;
      case 'gaze/set':
        if (ZONES[payload]) Engine.setGazeZone(payload);
        else console.warn('unknown zone', payload);
        break;
      case 'intensity/set': {
        const v = parseFloat(payload);
        if (Number.isFinite(v) && v >= 0 && v <= 1) Engine.setIntensity(v);
        else console.warn('bad intensity', payload);
        break;
      }
      case 'auto/set':
        if (payload === 'ON' || payload === 'OFF') autoState = payload;
        else console.warn('bad auto payload', payload);
        break;
      case 'trigger/set': {
        const fn = {
          lunge: Oneshots.lunge, vanish: Oneshots.vanish, drop: Oneshots.drop,
          notice: Oneshots.notice, sleep: Oneshots.sleep, gentle: Oneshots.gentle,
        }[payload];
        if (fn) fn();
        else console.warn('unknown trigger', payload);
        break;
      }
      default:
        console.warn('unhandled topic', topic, payload);
    }
  }

  // §11.3 state echo — mandatory, never optimistic: publish ACTUAL state on
  // the non-/set topics. Presets time out and one-shots auto-return, so HA
  // must hear about transitions it did not command. Called every frame;
  // publishes only on change, retained.
  function frame() {
    if (!client || !client.connected) return;
    const now = {
      preset: Engine.activePreset,
      gaze: Engine.activeZone,
      intensity: String(Math.round(Engine.intensityTarget * 100) / 100),
      auto: autoState,
    };
    for (const k of Object.keys(now)) {
      if (now[k] !== lastEcho[k]) {
        lastEcho[k] = now[k];
        client.publish(`${base}/${k}`, now[k], { retain: true, qos: 1 });
      }
    }
  }

  // ---- §12: HA device discovery — one retained payload for all entities.
  function publishDiscovery() {
    const t = (s) => `${base}/${s}`;
    const payload = {
      dev: {
        ids: 'halloween_eyes', name: 'Halloween Eyes',
        mf: 'Haunted Labs', mdl: 'Procedural Eyes', sw: '1.0',
      },
      o: { name: 'halloween-eyes', sw: '1.0' },
      avty_t: t('status'),
      cmps: {
        preset: {
          p: 'select', name: 'Preset', unique_id: 'halloween_eyes_preset',
          command_topic: t('preset/set'), state_topic: t('preset'),
          options: PRESET_KEYS, // resting presets only; one-shots are buttons
        },
        gaze: {
          p: 'select', name: 'Gaze Zone', unique_id: 'halloween_eyes_gaze',
          command_topic: t('gaze/set'), state_topic: t('gaze'),
          options: Object.keys(ZONES),
        },
        intensity: {
          p: 'number', name: 'Intensity', unique_id: 'halloween_eyes_intensity',
          command_topic: t('intensity/set'), state_topic: t('intensity'),
          min: 0, max: 1, step: 0.05, mode: 'slider',
        },
        auto: {
          p: 'switch', name: 'Auto Escalate', unique_id: 'halloween_eyes_auto',
          command_topic: t('auto/set'), state_topic: t('auto'),
        },
        btn_notice: {
          p: 'button', name: 'Notice', unique_id: 'halloween_eyes_notice',
          command_topic: t('trigger/set'), payload_press: 'notice',
        },
        btn_lunge: {
          p: 'button', name: 'Lunge', unique_id: 'halloween_eyes_lunge',
          command_topic: t('trigger/set'), payload_press: 'lunge',
        },
        btn_vanish: {
          p: 'button', name: 'Vanish', unique_id: 'halloween_eyes_vanish',
          command_topic: t('trigger/set'), payload_press: 'vanish',
        },
        btn_drop: {
          p: 'button', name: 'Drop', unique_id: 'halloween_eyes_drop',
          command_topic: t('trigger/set'), payload_press: 'drop',
        },
        btn_gentle: {
          p: 'button', name: 'Gentle', unique_id: 'halloween_eyes_gentle',
          command_topic: t('preset/set'), payload_press: 'gentle',
        },
        btn_sleep: {
          p: 'button', name: 'Sleep', unique_id: 'halloween_eyes_sleep',
          command_topic: t('trigger/set'), payload_press: 'sleep',
        },
        current: {
          p: 'sensor', name: 'Current Preset', unique_id: 'halloween_eyes_current',
          state_topic: t('preset'),
        },
      },
    };
    client.publish('homeassistant/device/halloween_eyes/config',
      JSON.stringify(payload), { retain: true, qos: 1 });
  }

  return { init, frame };
})();
