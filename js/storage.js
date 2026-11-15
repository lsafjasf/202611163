import { normalizeAdjustments } from "./color.js";
import { normalizeState, snapshotProject } from "./model.js";

export const WORKSPACE_KEY = "lumen.studio.workspace.v1";
export const DRAFT_KEY = "lumen.studio.draft.v1";
const PAYLOAD_VERSION = 1;

function storageOrNull(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function sanitizePreset(preset) {
  if (!preset || preset.builtin) return null;
  return {
    id: String(preset.id || `preset-${Date.now()}`),
    name: String(preset.name || "未命名预设").slice(0, 24),
    builtin: false,
    params: normalizeAdjustments(preset.params),
    createdAt: preset.createdAt || new Date().toISOString(),
  };
}

export function sanitizeKeyframe(frame) {
  if (!frame) return null;
  return {
    id: String(frame.id || `frame-${Date.now()}`),
    name: String(frame.name || "关键帧").slice(0, 32),
    createdAt: frame.createdAt || new Date().toISOString(),
    state: normalizeState(frame.state),
  };
}

export function createWorkspacePayload(state, customPresets, keyframes) {
  return {
    version: PAYLOAD_VERSION,
    savedAt: new Date().toISOString(),
    state: snapshotProject(state),
    customPresets: customPresets.map(sanitizePreset).filter(Boolean),
    keyframes: keyframes.map(sanitizeKeyframe).filter(Boolean),
  };
}

export function saveWorkspace(state, customPresets, keyframes, storage) {
  const target = storageOrNull(storage);
  if (!target) {
    throw new Error("浏览器存储不可用，请下载项目 JSON 备份。");
  }
  const payload = createWorkspacePayload(state, customPresets, keyframes);
  target.setItem(WORKSPACE_KEY, JSON.stringify(payload));
  return payload;
}

export function saveDraft(state, customPresets, keyframes, storage) {
  const target = storageOrNull(storage);
  if (!target) return false;
  try {
    target.setItem(
      DRAFT_KEY,
      JSON.stringify(createWorkspacePayload(state, customPresets, keyframes)),
    );
    return true;
  } catch {
    return false;
  }
}

export function parseWorkspace(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    version: PAYLOAD_VERSION,
    savedAt: raw.savedAt || null,
    state: normalizeState(raw.state),
    customPresets: Array.isArray(raw.customPresets)
      ? raw.customPresets.map(sanitizePreset).filter(Boolean)
      : [],
    keyframes: Array.isArray(raw.keyframes)
      ? raw.keyframes.map(sanitizeKeyframe).filter(Boolean)
      : [],
  };
}

export function loadWorkspace(storage) {
  const target = storageOrNull(storage);
  if (!target) return null;
  const raw = target.getItem(WORKSPACE_KEY);
  if (!raw) return null;
  try {
    return parseWorkspace(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearWorkspace(storage) {
  const target = storageOrNull(storage);
  target?.removeItem(WORKSPACE_KEY);
}
