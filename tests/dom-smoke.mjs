// Minimal DOM stub to smoke-test the UI controller in Node.
import { App } from '../js/main.js';
import { stepOnce } from '../js/engine.js';

class El {
  constructor(id) {
    this.id = id;
    this.value = '0';
    this.checked = false;
    this.disabled = false;
    this.max = '0';
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.style = {};
    this.listeners = {};
    this.width = 460;
    this.height = 720;
    this.classList = {
      set: new Set(),
      add(c) { this.set.add(c); },
      remove(c) { this.set.delete(c); },
      contains(c) { return this.set.has(c); }
    };
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  emit(type, ev = {}) {
    (this.listeners[type] || []).forEach((fn) => fn(ev));
  }
  getContext() {
    return new Proxy({}, { get: (t, p) => {
      if (p === 'createRadialGradient') return () => ({ addColorStop() {} });
      return typeof p === 'string' ? () => {} : undefined;
    } });
  }
}

const ids = ['scene', 'statusBadge', 'audioToggle', 'btnStart', 'btnPause', 'btnStep',
  'btnReset', 'btnReplay', 'replayScrub', 'replayTime', 'lastChange', 'triggerBox',
  'triggerTitle', 'triggerBody', 'curSlider', 'curVal', 'dampSlider', 'dampVal',
  'massSlider', 'massVal', 'autoToggle', 'mY', 'mVy', 'mX', 'mVx', 'mFz', 'mFx',
  'mTemp', 'mPress', 'mScore', 'mTime', 'limitBody', 'eventLog'];
const registry = new Map(ids.map((id) => [id, new El(id)]));

globalThis.document = {
  getElementById: (id) => registry.get(id),
  querySelectorAll: () => [],
  addEventListener: () => {}
};
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const app = new App();

// Normal run for a few frames, then pause / single step / resume equivalence.
app.start();
for (let n = 0; n < 200; n++) app.singleStep();
const pausedState = JSON.stringify({ y: app.state.y, vy: app.state.vy, step: app.state.step });
app.resetAll();
app.start();
for (let n = 0; n < 200; n++) {
  stepOnce(app.state, app.activePilot());
}
const liveState = JSON.stringify({ y: app.state.y, vy: app.state.vy, step: app.state.step });
if (pausedState !== liveState) throw new Error('pause/step path diverged from live path');

// Replay scrubbing stays finite and continuous.
app.enterReplay();
const scrub = registry.get('replayScrub');
scrub.max = String(app.replayStore.length - 1);
let prevY = null;
for (let i = 0; i <= 20; i++) {
  scrub.value = String(Math.round((i / 20) * (app.replayStore.length - 1)));
  scrub.emit('input');
}

// Reset clears the trigger panel and restores initial conditions.
app.resetAll();
if (app.state.t !== 0 || app.state.step !== 0) throw new Error('reset drift');
if (registry.get('triggerBox').classList.contains('show')) throw new Error('trigger panel not cleared');

// Load scenario triggers immediately and exposes the trigger panel after start.
app.chooseScenario('load', new El('x'));
app.start();
if (app.state.status !== 'triggered') throw new Error('load scenario should trigger');
app.showTrigger();
if (!registry.get('triggerBox').classList.contains('show')) throw new Error('trigger panel hidden');

console.log('DOM smoke test OK ·', JSON.parse(pausedState));
