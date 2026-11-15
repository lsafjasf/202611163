// 极简浏览器环境桩：只实现 AssemblyApp 用到的 API，供 node:test 无头验收。
export class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.closed = false;
    FakeAudioContext.instances.push(this);
  }
  createGain() {
    return {
      gain: { value: 1, setTargetAtTime() {} },
      connect() {}
    };
  }
  createOscillator() {
    return {
      type: '',
      frequency: { value: 0 },
      connect() { return { connect() {} }; },
      start() {},
      stop() {}
    };
  }
  resume() { this.state = 'running'; }
  close() { this.closed = true; return Promise.resolve(); }
}
FakeAudioContext.instances = [];

export function makeFakeCanvas() {
  const noop = () => {};
  const ctx2d = {
    fillRect: noop,
    fillText: noop,
    strokeRect: noop,
    beginPath: noop,
    roundRect: noop,
    fill: noop,
    stroke: noop,
    moveTo: noop,
    lineTo: noop,
    ellipse: noop,
    arc: noop,
    setLineDash: noop,
    measureText: () => ({ width: 40 }),
    save: noop,
    restore: noop,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    globalAlpha: 1
  };
  return { width: 980, height: 600, getContext: () => ctx2d };
}

export class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) {
    this.listeners.get(type)?.delete(fn);
  }
  dispatch(event) {
    for (const fn of this.listeners.get(event.type) || []) fn(event);
  }
}

export class FakeLocalStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  clear() { this.map.clear(); }
}

export function installBrowserFakes() {
  FakeAudioContext.instances.length = 0;
  const target = new FakeEventTarget();
  const storage = new FakeLocalStorage();
  globalThis.AudioContext = FakeAudioContext;
  globalThis.addEventListener = target.addEventListener.bind(target);
  globalThis.removeEventListener = target.removeEventListener.bind(target);
  globalThis.localStorage = storage;
  globalThis.requestAnimationFrame = () => 0;
  return { target, storage };
}
