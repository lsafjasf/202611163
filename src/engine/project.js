// 工程数据模型：场景 + 三层（背景几何 / 标题 / 数据标签）+ 音频与转场。
// 所有关键帧结构为 { t, value, easing? }，t 单位为秒（场景本地时间）。

export const PROJECT_VERSION = 1;

export function kf(t, value, easing = 'linear') {
  return { t, value, easing };
}

export function sortTrack(track) {
  return (track || []).sort((a, b) => a.t - b.t);
}

function defaultBackground() {
  return {
    id: 'bg',
    name: '背景几何',
    tracks: {
      x: [kf(0, 0.22, 'easeInOut'), kf(6, 0.78, 'easeInOut')],
      y: [kf(0, 0.3, 'easeInOut'), kf(6, 0.62, 'easeInOut')],
      radius: [kf(0, 120), kf(3, 220, 'easeOut'), kf(6, 150)],
      rotation: [kf(0, 0), kf(6, Math.PI)],
      opacity: [kf(0, 0.35), kf(3, 0.95, 'easeOut'), kf(6, 0.5)],
      color: [kf(0, '#1d2b64'), kf(6, '#7b2ff7')],
    },
  };
}

function defaultTitle() {
  return {
    id: 'title',
    name: '标题',
    text: '程序化动态海报',
    tracks: {
      x: [kf(0, 0.5), kf(6, 0.5)],
      y: [kf(0, 0.28), kf(6, 0.2)],
      opacity: [kf(0, 0, 'hold'), kf(0.6, 1, 'easeOut'), kf(5.4, 1), kf(6, 0, 'easeIn')],
      fontSize: [kf(0, 64), kf(6, 84, 'easeInOut')],
      color: [kf(0, '#ffffff'), kf(6, '#ffe27a')],
    },
  };
}

function defaultLabels() {
  return {
    id: 'labels',
    name: '数据标签',
    items: [
      { label: '曝光', value: '128K', offsetX: 0.18, offsetY: 0.74 },
      { label: '转化', value: '36%', offsetX: 0.5, offsetY: 0.82 },
      { label: '留存', value: '91%', offsetX: 0.82, offsetY: 0.74 },
    ],
    tracks: {
      opacity: [kf(0, 0, 'hold'), kf(1.2, 1, 'easeOut'), kf(6, 0.85)],
      y: [kf(0, 0), kf(6, -0.05, 'easeInOut')],
      color: [kf(0, '#9ad7ff'), kf(6, '#ffffff')],
    },
  };
}

function makeScene(id, name, inPoint, outPoint, palette, transition) {
  return {
    id,
    name,
    inPoint,
    outPoint,
    transition,
    audio: { bpm: 120, startAt: 0, kick: [0, 1, 2, 3], hat: [0.5, 1.5, 2.5, 3.5] },
    layers: {
      background: { ...defaultBackground(), tracks: cloneTracks(defaultBackground().tracks) },
      title: { ...defaultTitle(), text: name, tracks: cloneTracks(defaultTitle().tracks) },
      labels: { ...defaultLabels(), tracks: cloneTracks(defaultLabels().tracks) },
    },
    palette,
  };
}

function cloneTracks(tracks) {
  return Object.fromEntries(Object.entries(tracks).map(([k, v]) => [k, v.map((f) => ({ ...f }))]));
}

export function createDefaultProject() {
  const sceneA = makeScene('scene-a', '第一章 · 生成', 0, 6, { bg: '#0b1026' }, {
    type: 'fade',
    duration: 0.8,
  });
  const sceneB = makeScene('scene-b', '第二章 · 扩散', 6, 12, { bg: '#160b26' }, {
    type: 'slide',
    duration: 0.8,
  });
  return {
    version: PROJECT_VERSION,
    width: 960,
    height: 540,
    duration: 12,
    loop: true,
    scenes: [sceneA, sceneB],
  };
}

// 深拷贝，保证导出失败或场景切换不会污染已加载工程。
export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function sceneDuration(scene) {
  return scene.outPoint - scene.inPoint;
}

// 根据全局时间定位场景，返回场景与本地时间；越界时钳制到最后一个场景。
export function locateScene(project, globalTime) {
  const scenes = project.scenes;
  for (const scene of scenes) {
    if (globalTime < scene.outPoint || scene === scenes[scenes.length - 1]) {
      const local = Math.max(0, globalTime - scene.inPoint);
      return { scene, local, global: globalTime };
    }
  }
  const last = scenes[scenes.length - 1];
  return { scene: last, local: sceneDuration(last), global: globalTime };
}

export function validateProject(data) {
  if (!data || Array.isArray(data) || typeof data !== 'object') {
    throw new Error('工程必须是 JSON 对象');
  }
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error('工程缺少 scenes 数组');
  }
  for (const [i, s] of data.scenes.entries()) {
    if (!(s.outPoint > s.inPoint)) throw new Error(`场景 ${i} 入出点不合法`);
    if (!s.layers || !s.layers.background || !s.layers.title || !s.layers.labels) {
      throw new Error(`场景 ${i} 缺少三层结构`);
    }
  }
  return true;
}
