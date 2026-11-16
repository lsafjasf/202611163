// App state with undo/redo stacks and persistence (localStorage or JSON
// file). Serializable so templates, fonts, images and keyframes restore
// identically. Storage backend is injectable for Node tests.

export const STATE_VERSION = 1;
const STORAGE_KEY = 'tile-texture-studio:v1';
const MAX_HISTORY = 100;

export function defaultState() {
  return {
    version: STATE_VERSION,
    params: { type: 'stone', scale: 1.5, angle: 0, contrast: 1.0, seed: 42 },
    repairs: [],       // [{x,y,r,strength}] in tile space
    elements: [],      // overlay elements (see overlay.js)
    view: { mode: 'flat', model: 'sphere' },
    timeline: 0,
  };
}

function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

export class Store {
  constructor(storage) {
    this.storage = storage || null; // localStorage-like {getItem,setItem}
    this.state = defaultState();
    this.past = [];
    this.future = [];
    this.listeners = new Set();
  }

  subscribe(fn) { this.listeners.add(fn); }
  emit() { for (const fn of this.listeners) fn(this.state); }

  // Commit a mutation: snapshot current state for undo, apply fn, notify.
  commit(fn) {
    this.past.push(JSON.stringify(this.state));
    if (this.past.length > MAX_HISTORY) this.past.shift();
    this.future.length = 0;
    fn(this.state);
    this.emit();
  }

  // Transient update (e.g. slider drag) — no history entry.
  update(fn) { fn(this.state); this.emit(); }

  canUndo() { return this.past.length > 0; }
  canRedo() { return this.future.length > 0; }

  undo() {
    if (!this.past.length) return false;
    this.future.push(JSON.stringify(this.state));
    this.state = JSON.parse(this.past.pop());
    this.emit();
    return true;
  }

  redo() {
    if (!this.future.length) return false;
    this.past.push(JSON.stringify(this.state));
    this.state = JSON.parse(this.future.pop());
    this.emit();
    return true;
  }

  serialize() { return JSON.stringify(this.state, null, 2); }

  restore(json) {
    const parsed = typeof json === 'string' ? JSON.parse(json) : json;
    if (parsed.version !== STATE_VERSION) {
      throw new Error(`工程版本 ${parsed.version} 与当前版本 ${STATE_VERSION} 不兼容。`);
    }
    this.past.push(JSON.stringify(this.state));
    this.future.length = 0;
    this.state = Object.assign(defaultState(), parsed);
    this.emit();
  }

  save() {
    if (!this.storage) return false;
    this.storage.setItem(STORAGE_KEY, this.serialize());
    return true;
  }

  reload() {
    if (!this.storage) return false;
    const json = this.storage.getItem(STORAGE_KEY);
    if (!json) return false;
    this.restore(json);
    return true;
  }

  hasSaved() {
    return !!(this.storage && this.storage.getItem(STORAGE_KEY));
  }
}

export { STORAGE_KEY, deepClone };
