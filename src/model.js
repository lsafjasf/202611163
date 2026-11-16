// 数据模型、默认示例工程与本地持久化。

export const MAX_FRAMES = 12;
export const STAGE_W = 640;
export const STAGE_H = 360;
const STORAGE_KEY = 'stickframe.project.v1';

// 可拖动的关节点（顺序即绘制顺序）
export const JOINTS = [
  'head', 'neck', 'hip',
  'lShoulder', 'lElbow', 'lHand',
  'rShoulder', 'rElbow', 'rHand',
  'lKnee', 'lFoot',
  'rKnee', 'rFoot',
];

// 骨段连线
export const BONES = [
  ['head', 'neck'], ['neck', 'hip'],
  ['neck', 'lShoulder'], ['lShoulder', 'lElbow'], ['lElbow', 'lHand'],
  ['neck', 'rShoulder'], ['rShoulder', 'rElbow'], ['rElbow', 'rHand'],
  ['hip', 'lKnee'], ['lKnee', 'lFoot'],
  ['hip', 'rKnee'], ['rKnee', 'rFoot'],
];

const GROUND_Y = 322;

function walkPose(i) {
  const phase = (i % 6) / 6 * Math.PI * 2;
  const hipX = 120 + i * 34;
  const hipY = 168 - Math.round(6 * Math.abs(Math.sin(phase)));
  const swing = Math.sin(phase);
  const head = { x: hipX + 2, y: hipY - 52 };
  const neck = { x: hipX, y: hipY - 30 };
  const hip = { x: hipX, y: hipY };

  const lFoot = swing >= 0
    ? { x: hipX - 30, y: GROUND_Y }
    : { x: hipX + 26, y: GROUND_Y - 46 };
  const rFoot = swing < 0
    ? { x: hipX - 30, y: GROUND_Y }
    : { x: hipX + 26, y: GROUND_Y - 46 };
  const lKnee = {
    x: Math.round((hip.x + lFoot.x) / 2) - 8,
    y: Math.round((hip.y + lFoot.y) / 2) - 10,
  };
  const rKnee = {
    x: Math.round((hip.x + rFoot.x) / 2) + 8,
    y: Math.round((hip.y + rFoot.y) / 2) - 10,
  };

  const armSwing = Math.sin(phase + Math.PI);
  const lShoulder = { x: neck.x - 4, y: neck.y + 4 };
  const rShoulder = { x: neck.x + 4, y: neck.y + 4 };
  const lElbow = { x: lShoulder.x - 6, y: neck.y + 18 };
  const rElbow = { x: rShoulder.x + 6, y: neck.y + 18 };
  const lHand = {
    x: lElbow.x + Math.round(armSwing * 14),
    y: neck.y + 34 + Math.round(Math.abs(armSwing) * 6),
  };
  const rHand = {
    x: rElbow.x - Math.round(armSwing * 14),
    y: neck.y + 34 + Math.round(Math.abs(armSwing) * 6),
  };

  return {
    head, neck, hip,
    lShoulder, lElbow, lHand,
    rShoulder, rElbow, rHand,
    lKnee, lFoot, rKnee, rFoot,
  };
}

function footstepFor(i) {
  const m = i % 6;
  if (m === 0) return 'left';
  if (m === 3) return 'right';
  return 'none';
}

function makeFrame(i) {
  return {
    id: `f${Date.now().toString(36)}_${i}_${Math.random().toString(36).slice(2, 7)}`,
    pose: walkPose(i),
    footstep: footstepFor(i),
  };
}

function makeScene(name, indexBase) {
  const frames = [];
  for (let i = 0; i < MAX_FRAMES; i += 1) frames.push(makeFrame(i + indexBase));
  return {
    id: `scene_${Math.random().toString(36).slice(2, 9)}`,
    name,
    frames,
    inPoint: 0,
    outPoint: frames.length - 1,
    audioStartFrame: 0,
    fadeInFrames: 2,
    fadeOutFrames: 2,
    subtitles: [
      { id: `sub_${Math.random().toString(36).slice(2, 8)}`, startFrame: 0, endFrame: 3, text: '火柴人开始行走' },
      { id: `sub_${Math.random().toString(36).slice(2, 8)}`, startFrame: 6, endFrame: 10, text: '脚步声与画面同步' },
    ],
  };
}

export function createDefaultProject() {
  const sceneA = makeScene('场景 1 · 散步', 0);
  const sceneB = makeScene('场景 2 · 再走一遍', 0);
  return {
    version: 1,
    fps: 12,
    stageWidth: STAGE_W,
    stageHeight: STAGE_H,
    activeSceneId: sceneA.id,
    scenes: [sceneA, sceneB],
    savedAt: null,
  };
}

export function createBlankScene(name) {
  const scene = makeScene(name, 0);
  // 空白场景：保留两帧，姿态为静止站立，方便用户自己摆
  const base = scene.frames[0].pose;
  scene.frames = scene.frames.slice(0, 2).map((f, idx) => ({
    ...f,
    id: `f${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
    pose: structuredClone(base),
    footstep: idx === 0 ? 'left' : 'none',
  }));
  scene.outPoint = 1;
  scene.subtitles = [];
  scene.fadeInFrames = 0;
  scene.fadeOutFrames = 0;
  scene.name = name;
  return scene;
}

export function saveProjectLocal(project) {
  const data = { ...project, savedAt: new Date().toISOString() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  return data;
}

export function loadProjectLocal() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const project = JSON.parse(raw);
    if (!project || !Array.isArray(project.scenes) || project.scenes.length === 0) return null;
    return project;
  } catch {
    return null;
  }
}

export function clearProjectLocal() {
  localStorage.removeItem(STORAGE_KEY);
}
