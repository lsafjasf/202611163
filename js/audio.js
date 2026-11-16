/* Web Audio:双侧张力音调 + 风声 + 告警/成功/失败音效 */
(function (root) {
'use strict';

var ctx = null, master = null;
var voiceL = null, voiceR = null, windSrc = null, windGain = null, alarmOsc = null, alarmGain = null;

function ensure() {
  if (ctx) return true;
  var AC = root.AudioContext || root.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  function makeVoice(type) {
    var osc = ctx.createOscillator();
    osc.type = type;
    var g = ctx.createGain();
    g.gain.value = 0;
    osc.connect(g); g.connect(master);
    osc.start();
    return { osc: osc, gain: g };
  }
  voiceL = makeVoice('triangle');
  voiceR = makeVoice('sawtooth');

  // 风声:循环噪声 + 带通
  var len = ctx.sampleRate * 2;
  var buf = ctx.createBuffer(1, len, ctx.sampleRate);
  var d = buf.getChannelData(0);
  for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  windSrc = ctx.createBufferSource();
  windSrc.buffer = buf; windSrc.loop = true;
  var bp = ctx.createBiquadFilter();
  bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.6;
  windGain = ctx.createGain(); windGain.gain.value = 0;
  windSrc.connect(bp); bp.connect(windGain); windGain.connect(master);
  windSrc.start();

  alarmOsc = ctx.createOscillator();
  alarmOsc.type = 'square'; alarmOsc.frequency.value = 880;
  alarmGain = ctx.createGain(); alarmGain.gain.value = 0;
  alarmOsc.connect(alarmGain); alarmGain.connect(master);
  alarmOsc.start();
  return true;
}

/* 每帧根据状态更新持续音 */
function update(state, muted) {
  if (!ensure()) return;
  if (ctx.state === 'suspended') ctx.resume();
  var t = ctx.currentTime;
  var m = muted ? 0 : 1;
  // 张力 -> 音高(90~210Hz),应力 -> 音量
  voiceL.osc.frequency.setTargetAtTime(90 + state.left.tension * 1.2, t, 0.05);
  voiceR.osc.frequency.setTargetAtTime(90 + state.right.tension * 1.2, t, 0.05);
  voiceL.gain.gain.setTargetAtTime(m * (0.02 + state.left.stress / 100 * 0.12), t, 0.05);
  voiceR.gain.gain.setTargetAtTime(m * (0.02 + state.right.stress / 100 * 0.12), t, 0.05);
  windGain.gain.setTargetAtTime(m * state.wind.force / 100 * 0.10, t, 0.1);
  var alarmOn = (state.left.stress >= 60 || state.right.stress >= 60) &&
                state.phase !== 'SUCCESS' && state.phase !== 'FAILED';
  var beep = alarmOn ? (Math.floor(state.time * 4) % 2 === 0 ? 0.08 : 0) : 0;
  alarmGain.gain.setTargetAtTime(m * beep, t, 0.02);
}

function blip(freq, dur, type, vol) {
  if (!ensure()) return;
  var o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type || 'sine'; o.frequency.value = freq;
  g.gain.setValueAtTime(vol || 0.2, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g); g.connect(master);
  o.start(); o.stop(ctx.currentTime + dur);
}

function success() {
  if (!ensure()) return;
  [523, 659, 784, 1047].forEach(function (f, i) {
    setTimeout(function () { blip(f, 0.35, 'sine', 0.25); }, i * 140);
  });
}

function failure() {
  if (!ensure()) return;
  blip(160, 0.8, 'sawtooth', 0.3);
  setTimeout(function () { blip(90, 1.0, 'sawtooth', 0.3); }, 200);
}

/* 重开时复位所有持续音 */
function reset() {
  if (!ctx) return;
  var t = ctx.currentTime;
  voiceL.gain.gain.setTargetAtTime(0, t, 0.02);
  voiceR.gain.gain.setTargetAtTime(0, t, 0.02);
  windGain.gain.setTargetAtTime(0, t, 0.02);
  alarmGain.gain.setTargetAtTime(0, t, 0.02);
}

root.BridgeAudio = { update: update, success: success, failure: failure, reset: reset, ensure: ensure };
})(typeof window !== 'undefined' ? window : globalThis);
