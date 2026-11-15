import { cloneModel, normalizeModel } from "./model.js";
import { deepEqual } from "./util.js";

export class History {
  constructor(limit = 60) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  record(previousModel, label = "编辑") {
    const snapshot = cloneModel(previousModel);
    if (this.undoStack.length
      && deepEqual(this.undoStack[this.undoStack.length - 1].model, snapshot)) {
      return;
    }
    this.undoStack.push({ model: snapshot, label });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack = [];
  }

  undo(currentModel) {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push({ model: cloneModel(currentModel), label: entry.label });
    return {
      model: normalizeModel(entry.model),
      label: entry.label
    };
  }

  redo(currentModel) {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push({ model: cloneModel(currentModel), label: entry.label });
    return {
      model: normalizeModel(entry.model),
      label: entry.label
    };
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get undoLabel() {
    return this.undoStack[this.undoStack.length - 1]?.label || "";
  }

  get redoLabel() {
    return this.redoStack[this.redoStack.length - 1]?.label || "";
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
  }
}
