// Smoke test for the browser layer without a real browser: stubs DOM,
// canvas 2d context, localStorage and rAF, then drives main.js through
// play mode, all key bindings, pause/restart/solo/rotate, and replay mode.
const gradient = { addColorStop() {} };
const ctx2d = new Proxy(
  {},
  {
    get: (t, p) => {
      if (p === 'createLinearGradient') return () => gradient;
      return () => {};
    },
    set: () => true,
  }
);
const canvas = { width: 960, height: 640, getContext: () => ctx2d };

const listeners = {};
let stored = {
  gondola_replays: JSON.stringify([
    {
      when: '2026-11-16T00:00:00Z',
      result: 'lost',
      reason: 'cable-snap',
      seats: { L: 'hoist', R: 'swing' },
      solo: false,
      repairs: [
        { x: -8, y: 10 },
        { x: 7, y: 16 },
        { x: -2, y: 22 },
      ],
      events: [
        { t: 0, type: 'start' },
        { t: 3.2, type: 'conflict', kind: 'estop-interrupt' },
      ],
      frames: Array.from({ length: 50 }, (_, i) => ({
        t: i * 0.1,
        x: i * 0.05,
        y: 6 + i * 0.02,
        armX: i * 0.05,
        len: 6 + i * 0.02,
        theta: 0.1,
        tension: 2200 + i * 10,
        resource: 90 - i * 0.1,
        timeLeft: 240 - i * 0.1,
        wind: i > 20 ? 1.1 : 0,
        done: 0,
      })),
      conflicts: [{ t: 3.2, kind: 'estop-interrupt' }],
    },
  ]),
};

globalThis.window = {
  addEventListener: (type, fn) => {
    (listeners[type] ||= []).push(fn);
  },
};
globalThis.document = { getElementById: () => canvas };
globalThis.localStorage = {
  getItem: (k) => stored[k] ?? null,
  setItem: (k, v) => {
    stored[k] = v;
  },
};
let rafCb = null;
globalThis.requestAnimationFrame = (cb) => {
  rafCb = cb;
};

let failures = 0;
function check(name, cond) {
  console.log(`${cond ? 'ok  ' : 'FAIL'} - ${name}`);
  if (!cond) failures++;
}
function key(type, code) {
  for (const fn of listeners[type] || []) fn({ code, repeat: false, preventDefault() {} });
}
function frames(n) {
  for (let i = 0; i < n; i++) {
    const cb = rafCb;
    rafCb = null;
    cb(performance.now() + i * 16.7);
  }
}

try {
  await import('../src/main.js');
  check('main.js imports and starts loop', typeof rafCb === 'function');

  // Every mapped key, press + release, while running frames.
  const keys = ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyF', 'Enter'];
  for (const k of keys) key('keydown', k);
  frames(30);
  for (const k of keys) key('keyup', k);
  frames(30);
  check('simultaneous two-seat key input runs clean', true);

  key('keydown', 'KeyP'); // pause
  frames(10);
  key('keydown', 'KeyP'); // resume
  key('keydown', 'KeyT'); // solo debug on
  frames(10);
  key('keydown', 'KeyW');
  key('keydown', 'KeyD');
  frames(30);
  key('keyup', 'KeyW');
  key('keyup', 'KeyD');
  key('keydown', 'KeyT'); // solo debug off
  key('keydown', 'KeyQ'); // rotate control sides
  key('keydown', 'KeyR'); // restart
  frames(20);
  check('pause/solo/rotate/restart run clean', true);

  key('keydown', 'KeyV'); // enter replay mode
  frames(40);
  key('keydown', 'Space'); // pause playback
  key('keydown', 'ArrowRight');
  key('keydown', 'ArrowLeft');
  frames(10);
  key('keydown', 'Escape'); // exit replay
  frames(10);
  check('replay viewer runs clean', true);
} catch (err) {
  console.error(err);
  failures++;
}

console.log(failures === 0 ? '\nsmoke test passed' : `\n${failures} smoke check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
