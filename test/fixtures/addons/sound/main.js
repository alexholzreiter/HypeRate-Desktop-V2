// A silent tone (gain 0): proves Web Audio runs without making noise during tests
const ctx = new AudioContext();
const osc = ctx.createOscillator(), gain = ctx.createGain();
gain.gain.value = 0;
osc.connect(gain).connect(ctx.destination);
osc.start(); osc.stop(ctx.currentTime + 0.1);
hyperate.log('audio ' + ctx.state);
