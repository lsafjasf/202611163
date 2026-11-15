import { normalizeState } from "./model.js";

const STORAGE_KEY = "metro-graph-lab-state-v1";

export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : {});
  } catch {
    return normalizeState({});
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(normalizeState(state)));
  } catch {
    // Persistence is optional when storage is blocked.
  }
}

export function stateStorageKey() {
  return STORAGE_KEY;
}
