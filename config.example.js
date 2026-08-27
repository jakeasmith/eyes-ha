// Copy to config.js (gitignored) and fill in real values. The page renders
// fine without config.js — MQTT just stays offline (§11.1: credentials never
// go in query params; broker URL may also be passed as ?broker=).
window.EYES_CONFIG = {
  brokerUrl: 'ws://mqtt-broker.example.com:1884',
  username: 'eyes',
  password: 'CHANGE_ME',
  baseTopic: 'eyes',
};
