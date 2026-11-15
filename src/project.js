export const SOURCE_LENGTH = 8;
export const MIN_SHOT_DURATION = 0.5;
export const STORAGE_KEY = "beatboard.project.night-flight.v1";
export const DRAFT_KEY = "beatboard.project.night-flight.draft.v1";

const TRANSITIONS = new Set(["cut", "dissolve", "wipe", "flash"]);

const SCENE_SEEDS = [
  {
    id: "departure",
    no: "01",
    name: "离岸",
    english: "DEPARTURE",
    visual: "ferry",
    palette: ["#07151b", "#2b6267", "#e8ad5d"],
    sourceIn: 0.5,
    sourceOut: 4.5,
    subtitle: { text: "潮声替我们数着拍子。", in: 0.45, out: 3.6 },
    transition: { type: "cut", duration: 0 },
    keyframes: [
      { time: 0, zoom: 1.03, x: 0.48, y: 0.5 },
      { time: 2.8, zoom: 1.13, x: 0.53, y: 0.47 },
    ],
  },
  {
    id: "rain-alley",
    no: "02",
    name: "雨巷",
    english: "RAIN ALLEY",
    visual: "alley",
    palette: ["#11101d", "#574061", "#f09272"],
    sourceIn: 1,
    sourceOut: 5,
    subtitle: { text: "霓虹把夜色折成两半。", in: 0.5, out: 3.55 },
    transition: { type: "dissolve", duration: 0.35 },
    keyframes: [
      { time: 0, zoom: 1.01, x: 0.5, y: 0.51 },
      { time: 2.2, zoom: 1.1, x: 0.44, y: 0.5 },
    ],
  },
  {
    id: "rooftop",
    no: "03",
    name: "天台",
    english: "ROOFTOP",
    visual: "rooftop",
    palette: ["#241712", "#9a563a", "#f4bb65"],
    sourceIn: 0.75,
    sourceOut: 5.75,
    subtitle: { text: "城市在脚下交换心跳。", in: 0.6, out: 4.35 },
    transition: { type: "wipe", duration: 0.45 },
    keyframes: [
      { time: 0, zoom: 1.04, x: 0.52, y: 0.48 },
      { time: 3.3, zoom: 1.15, x: 0.47, y: 0.54 },
    ],
  },
  {
    id: "tunnel",
    no: "04",
    name: "隧道",
    english: "TUNNEL",
    visual: "tunnel",
    palette: ["#120b0b", "#6b2721", "#f16f51"],
    sourceIn: 1.5,
    sourceOut: 5.5,
    subtitle: { text: "把回声留在身后。", in: 0.55, out: 3.4 },
    transition: { type: "flash", duration: 0.18 },
    keyframes: [
      { time: 0, zoom: 1.01, x: 0.5, y: 0.5 },
      { time: 2.8, zoom: 1.19, x: 0.5, y: 0.5 },
    ],
  },
  {
    id: "signal",
    no: "05",
    name: "信号",
    english: "SIGNAL",
    visual: "signal",
    palette: ["#071714", "#285d51", "#67d7bf"],
    sourceIn: 0.5,
    sourceOut: 5.5,
    subtitle: { text: "收到，来自很远的地方。", in: 0.65, out: 4.4 },
    transition: { type: "dissolve", duration: 0.3 },
    keyframes: [
      { time: 0, zoom: 1.02, x: 0.49, y: 0.5 },
      { time: 3.1, zoom: 1.1, x: 0.56, y: 0.46 },
    ],
  },
  {
    id: "daybreak",
    no: "06",
    name: "黎明",
    english: "DAYBREAK",
    visual: "dawn",
    palette: ["#221715", "#b2624b", "#ffd28d"],
    sourceIn: 1,
    sourceOut: 7,
    subtitle: { text: "最后一拍，天亮了。", in: 0.7, out: 5.4 },
    transition: { type: "wipe", duration: 0.55 },
    keyframes: [
      { time: 0, zoom: 1.01, x: 0.5, y: 0.5 },
      { time: 4.2, zoom: 1.14, x: 0.49, y: 0.46 },
    ],
  },
];

export function createDefaultProject() {
  return {
    format: "beatboard.project",
    version: 1,
    id: "night-flight-06",
    title: "夜航 · 六格分镜",
    fps: 30,
    audio: {
      bpm: 120,
      start: 0.25,
      gain: 0.68,
      preset: "night-drive",
    },
    scenes: SCENE_SEEDS.map((scene) => ({
      ...scene,
      palette: [...scene.palette],
      subtitle: { ...scene.subtitle },
      transition: { ...scene.transition },
      keyframes: scene.keyframes.map((keyframe) => ({ ...keyframe })),
    })),
    updatedAt: null,
  };
}

export function cloneProject(project) {
  return JSON.parse(JSON.stringify(project));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function roundTime(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

export function roundFrame(value, fps = 30) {
  return Math.round(Number(value) * fps) / fps;
}

export function sceneDuration(scene) {
  return Math.max(0, roundTime(scene.sourceOut - scene.sourceIn));
}

export function computeLayout(project) {
  let cursor = 0;
  const scenes = project.scenes.map((scene, index) => {
    const duration = sceneDuration(scene);
    const item = {
      scene,
      index,
      start: roundTime(cursor),
      end: roundTime(cursor + duration),
      duration,
    };
    cursor += duration;
    return item;
  });
  const total = roundTime(cursor);
  const beatDuration = 60 / project.audio.bpm;
  return {
    scenes,
    total,
    beatDuration,
    sceneById: new Map(scenes.map((item) => [item.scene.id, item])),
  };
}

export function getSceneAt(layout, time) {
  const clamped = clamp(time, 0, Math.max(0, layout.total));
  return (
    layout.scenes.find((item) => clamped >= item.start && clamped < item.end) ||
    layout.scenes[layout.scenes.length - 1] ||
    null
  );
}

export function getLocalTime(sceneItem, time) {
  if (!sceneItem) return 0;
  return clamp(time - sceneItem.start, 0, sceneItem.duration);
}

export function getActiveCaption(sceneItem, time) {
  if (!sceneItem) return null;
  const local = getLocalTime(sceneItem, time);
  const { subtitle } = sceneItem.scene;
  if (!subtitle.text || local < subtitle.in || local > subtitle.out) return null;
  return subtitle.text;
}

export function computeAudioEvents(project, layout = computeLayout(project)) {
  const beatDuration = 60 / project.audio.bpm;
  const events = [];
  let halfBeat = 0;
  let time = project.audio.start;
  while (time < layout.total - 0.001 && halfBeat < 1000) {
    const offbeat = halfBeat % 2 === 1;
    const beatInBar = Math.floor(halfBeat / 2) % 4;
    let type = "hat";
    let velocity = 0.52;
    if (!offbeat && beatInBar === 0) {
      type = "kick";
      velocity = 1;
    } else if (!offbeat && beatInBar === 2) {
      type = "snare";
      velocity = 0.82;
    } else if (!offbeat && beatInBar === 1) {
      type = "hat";
      velocity = 0.28;
    } else if (!offbeat && beatInBar === 3) {
      type = "rim";
      velocity = 0.58;
    }
    const scene = getSceneAt(layout, time);
    events.push({
      id: `${type}-${halfBeat}`,
      time: roundTime(time),
      type,
      velocity,
      beat: Math.floor(halfBeat / 2),
      beatInBar,
      sceneIndex: scene ? scene.index : 0,
    });
    halfBeat += 1;
    time = roundTime(project.audio.start + halfBeat * (beatDuration / 2));
  }
  return events;
}

export function getAudioEventAt(project, layout, time) {
  const events = computeAudioEvents(project, layout);
  let current = null;
  for (const event of events) {
    if (event.time > time + 0.0001) break;
    current = event;
  }
  return current;
}

export function getBeatInfo(project, time) {
  const beatDuration = 60 / project.audio.bpm;
  const elapsed = Math.max(0, time - project.audio.start);
  const beat = Math.floor(elapsed / beatDuration);
  const phase = (elapsed % beatDuration) / beatDuration;
  return {
    beat,
    beatInBar: beat % 4,
    phase,
    beatDuration,
    active: time >= project.audio.start,
  };
}

export function formatTimecode(seconds, fps = 30, showHours = true) {
  const safe = Math.max(0, Number(seconds) || 0);
  const totalFrames = Math.round(safe * fps);
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (value) => String(value).padStart(2, "0");
  return showHours
    ? `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`
    : `${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

export function formatClock(seconds, fps = 30) {
  return formatTimecode(seconds, fps, false);
}

export function formatSeconds(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, "0")}:${secs.toFixed(2).padStart(5, "0")}`;
}

export function formatShortDuration(seconds) {
  return `${Number(seconds).toFixed(1)}s`;
}

function numeric(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeProject(input) {
  const defaults = createDefaultProject();
  if (!input || typeof input !== "object" || !Array.isArray(input.scenes)) {
    throw new Error("工程文件缺少 scenes 数据");
  }

  const scenes = input.scenes.slice(0, 6).map((raw, index) => {
    const fallback = defaults.scenes[index];
    const scene = raw && typeof raw === "object" ? raw : {};
    let sourceIn = clamp(numeric(scene.sourceIn, fallback.sourceIn), 0, SOURCE_LENGTH - MIN_SHOT_DURATION);
    let sourceOut = clamp(
      numeric(scene.sourceOut, fallback.sourceOut),
      sourceIn + MIN_SHOT_DURATION,
      SOURCE_LENGTH,
    );
    if (!Number.isFinite(sourceIn)) sourceIn = 0;
    if (!Number.isFinite(sourceOut)) sourceOut = SOURCE_LENGTH;
    const subtitle = scene.subtitle && typeof scene.subtitle === "object" ? scene.subtitle : {};
    const transition = scene.transition && typeof scene.transition === "object" ? scene.transition : {};
    const keyframes = Array.isArray(scene.keyframes)
      ? scene.keyframes
          .filter((item) => item && Number.isFinite(Number(item.time)))
          .map((item) => ({
            time: clamp(roundTime(item.time), 0, SOURCE_LENGTH),
            zoom: clamp(numeric(item.zoom, 1), 0.75, 2),
            x: clamp(numeric(item.x, 0.5), 0, 1),
            y: clamp(numeric(item.y, 0.5), 0, 1),
          }))
          .sort((a, b) => a.time - b.time)
      : [];
    return {
      id: String(scene.id || fallback.id),
      no: String(scene.no || fallback.no).slice(0, 3),
      name: String(scene.name || fallback.name).slice(0, 24),
      english: String(scene.english || fallback.english).slice(0, 30),
      visual: String(scene.visual || fallback.visual),
      palette: Array.isArray(scene.palette) && scene.palette.length >= 3
        ? scene.palette.slice(0, 3).map((color) => String(color))
        : [...fallback.palette],
      sourceIn: roundTime(sourceIn),
      sourceOut: roundTime(sourceOut),
      subtitle: {
        text: String(subtitle.text ?? fallback.subtitle.text).slice(0, 60),
        in: clamp(roundTime(numeric(subtitle.in, fallback.subtitle.in)), 0, SOURCE_LENGTH),
        out: clamp(roundTime(numeric(subtitle.out, fallback.subtitle.out)), 0, SOURCE_LENGTH),
      },
      transition: {
        type: TRANSITIONS.has(transition.type) ? transition.type : fallback.transition.type,
        duration: clamp(roundTime(numeric(transition.duration, fallback.transition.duration)), 0, 2),
      },
      keyframes,
    };
  });

  if (scenes.length !== 6) {
    throw new Error("该工程不是六格分镜，需要正好 6 个镜头");
  }

  const audio = input.audio && typeof input.audio === "object" ? input.audio : {};
  return {
    format: "beatboard.project",
    version: 1,
    id: String(input.id || defaults.id),
    title: String(input.title || defaults.title).slice(0, 60),
    fps: clamp(Math.round(numeric(input.fps, 30)), 24, 60),
    audio: {
      bpm: clamp(Math.round(numeric(audio.bpm, 120)), 60, 200),
      start: clamp(roundTime(numeric(audio.start, 0.25)), 0, 20),
      gain: clamp(numeric(audio.gain, 0.68), 0, 1),
      preset: String(audio.preset || "night-drive"),
    },
    scenes,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : null,
  };
}

export function projectForStorage(project) {
  const copy = cloneProject(project);
  const layout = computeLayout(copy);
  return {
    ...copy,
    totalDuration: layout.total,
    savedAt: new Date().toISOString(),
  };
}

export function timelineSnapshot(project) {
  const layout = computeLayout(project);
  return {
    total: layout.total,
    scenes: layout.scenes.map((item) => ({
      id: item.scene.id,
      no: item.scene.no,
      sourceIn: item.scene.sourceIn,
      sourceOut: item.scene.sourceOut,
      duration: item.duration,
      start: item.start,
      end: item.end,
      subtitle: { ...item.scene.subtitle },
      transition: { ...item.scene.transition },
      keyframeCount: item.scene.keyframes.length,
    })),
    audio: { ...project.audio },
  };
}

export function snapshotHash(snapshot) {
  const text = JSON.stringify(snapshot);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
