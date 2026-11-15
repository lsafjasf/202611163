function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class HistoryStore {
  constructor(initialState, onChange, limit = 80) {
    this.present = clone(initialState);
    this.past = [];
    this.future = [];
    this.limit = limit;
    this.onChange = onChange;
    this.batchSnapshot = null;
  }

  get state() {
    return this.present;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  emit() {
    this.onChange?.(this.present, {
      canUndo: this.canUndo,
      canRedo: this.canRedo,
    });
  }

  update(nextState, { record = true } = {}) {
    if (record && !this.batchSnapshot) {
      this.past.push(clone(this.present));
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    this.present = clone(nextState);
    this.emit();
  }

  beginBatch() {
    if (this.batchSnapshot) return;
    this.batchSnapshot = clone(this.present);
  }

  endBatch() {
    if (!this.batchSnapshot) return;
    const snapshot = this.batchSnapshot;
    this.batchSnapshot = null;
    if (JSON.stringify(snapshot) !== JSON.stringify(this.present)) {
      this.past.push(snapshot);
      if (this.past.length > this.limit) this.past.shift();
      this.future = [];
    }
    this.emit();
  }

  undo() {
    if (this.batchSnapshot) this.endBatch();
    const previous = this.past.pop();
    if (!previous) return false;
    this.future.push(clone(this.present));
    this.present = previous;
    this.emit();
    return true;
  }

  redo() {
    if (this.batchSnapshot) this.endBatch();
    const next = this.future.pop();
    if (!next) return false;
    this.past.push(clone(this.present));
    this.present = next;
    this.emit();
    return true;
  }

  replace(nextState, { record = false } = {}) {
    if (record) {
      this.past.push(clone(this.present));
      if (this.past.length > this.limit) this.past.shift();
    }
    this.batchSnapshot = null;
    this.future = [];
    this.present = clone(nextState);
    this.emit();
  }
}
