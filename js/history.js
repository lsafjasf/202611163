import { deepClone } from "./core.js";

export class History {
  constructor(initialScene, limit = 80) {
    this.limit = limit;
    this.past = [];
    this.future = [];
    this.present = deepClone(initialScene);
  }

  reset(scene) {
    this.past = [];
    this.future = [];
    this.present = deepClone(scene);
  }

  commit(nextScene) {
    const next = deepClone(nextScene);
    if (JSON.stringify(this.present) === JSON.stringify(next)) return false;
    this.past.push(this.present);
    if (this.past.length > this.limit) this.past.shift();
    this.present = next;
    this.future = [];
    return true;
  }

  undo() {
    if (!this.past.length) return null;
    this.future.unshift(this.present);
    this.present = this.past.pop();
    return deepClone(this.present);
  }

  redo() {
    if (!this.future.length) return null;
    this.past.push(this.present);
    this.present = this.future.shift();
    return deepClone(this.present);
  }

  canUndo() {
    return this.past.length > 0;
  }

  canRedo() {
    return this.future.length > 0;
  }
}
