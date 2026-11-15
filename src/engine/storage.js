// 工程持久化：localStorage 保存 / 重载，关键帧、转场、音频起点完整恢复。
import { cloneProject, validateProject } from './project.js';

export const STORAGE_KEY = 'procedural-poster-project';

export function saveProject(project, key = STORAGE_KEY) {
  const snapshot = cloneProject(project);
  localStorage.setItem(key, JSON.stringify(snapshot));
  return snapshot;
}

export function loadProject(key = STORAGE_KEY) {
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  const data = JSON.parse(raw);
  validateProject(data);
  return data;
}

export function hasSavedProject(key = STORAGE_KEY) {
  return localStorage.getItem(key) !== null;
}

export function clearProject(key = STORAGE_KEY) {
  localStorage.removeItem(key);
}

export function parseProjectJSON(text) {
  const data = JSON.parse(text);
  validateProject(data);
 return data;
}
