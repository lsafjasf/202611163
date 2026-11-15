// 工程模型：默认工程、序列化/反序列化、深拷贝。纯逻辑，可在 Node 中测试。

export const PROJECT_VERSION = 1;

function kf(points) {
  return points.map(([t, v]) => ({ t, v }));
}

// 内置示例场景：10 秒片头，波浪背景 + 标题 + 光带三层关键帧，
// 字幕、淡入转场与三个合成音频事件。
export function makeDefaultScene(id, name) {
  return {
    id,
    name,
    in: 0,
    out: 10,
    transition: { type: "fade", duration: 0.8 },
    layers: {
      wave: {
        keyframes: {
          amplitude: kf([[0, 18], [3, 46], [6.5, 26], [10, 40]]),
          frequency: kf([[0, 1.6], [5, 2.4], [10, 1.8]]),
          speed: kf([[0, 0.6], [4, 1.4], [10, 0.8]]),
          hue: kf([[0, 210], [5, 262], [10, 190]]),
        },
      },
      title: {
        text: "星 河 片 头",
        keyframes: {
          x: kf([[0, 480], [10, 480]]),
          y: kf([[0, 620], [1.6, 270], [8.4, 270], [10, 240]]),
          opacity: kf([[0, 0], [1.2, 0], [2.2, 1], [8.6, 1], [10, 0]]),
          scale: kf([[0, 1.6], [2.2, 1.0], [10, 1.05]]),
          tracking: kf([[0, 60], [2.4, 12], [10, 12]]),
        },
      },
      lightband: {
        keyframes: {
          x: kf([[0, -300], [3.2, 1260], [3.21, -300], [6.4, 1260], [6.41, -300], [9.6, 1260]]),
          opacity: kf([[0, 0.85], [9.6, 0.85], [10, 0]]),
          angle: kf([[0, -18], [10, -18]]),
          width: kf([[0, 150], [5, 210], [10, 150]]),
        },
      },
    },
    subtitles: [
      { start: 2.6, end: 5.0, text: "第一幕 · 波浪升起" },
      { start: 5.4, end: 8.0, text: "第二幕 · 光带掠过" },
    ],
    audio: [
      { id: "a1", type: "whoosh", start: 0.4, duration: 1.6, freq: 320, gain: 0.5 },
      { id: "a2", type: "chime", start: 2.6, duration: 1.2, freq: 660, gain: 0.45 },
      { id: "a3", type: "whoosh", start: 5.4, duration: 1.4, freq: 260, gain: 0.5 },
      { id: "a4", type: "pulse", start: 8.2, duration: 1.4, freq: 110, gain: 0.5 },
    ],
  };
}

export function makeDefaultProject() {
  return {
    version: PROJECT_VERSION,
    name: "十秒片头示例",
    width: 960,
    height: 540,
    fps: 30,
    scenes: [makeDefaultScene("scene-1", "开场")],
    activeScene: 0,
  };
}

export function getScene(project, index) {
  const i = index ?? project.activeScene;
  return project.scenes[Math.max(0, Math.min(i, project.scenes.length - 1))];
}

export function sceneDuration(scene) {
  return scene.out - scene.in;
}

export function serializeProject(project) {
  return JSON.stringify(project, null, 2);
}

// 解析并做最小校验；失败抛错，调用方保证不把坏数据写回工程。
export function deserializeProject(text) {
  const data = JSON.parse(text);
  if (typeof data !== "object" || data === null) throw new Error("工程不是对象");
  if (!Array.isArray(data.scenes) || data.scenes.length === 0) {
    throw new Error("工程缺少场景");
  }
  for (const scene of data.scenes) {
    if (typeof scene.in !== "number" || typeof scene.out !== "number" || scene.out <= scene.in) {
      throw new Error(`场景 ${scene.name || scene.id} 入点/出点非法`);
    }
    for (const layerName of ["wave", "title", "lightband"]) {
      if (!scene.layers || !scene.layers[layerName] || !scene.layers[layerName].keyframes) {
        throw new Error(`场景 ${scene.name || scene.id} 缺少图层 ${layerName}`);
      }
    }
    scene.subtitles = scene.subtitles || [];
    scene.audio = scene.audio || [];
    scene.transition = scene.transition || { type: "fade", duration: 0 };
  }
  data.activeScene = Math.min(data.activeScene || 0, data.scenes.length - 1);
  data.width = data.width || 960;
  data.height = data.height || 540;
  data.fps = data.fps || 30;
  return data;
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}
