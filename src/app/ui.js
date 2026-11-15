import { kf } from '../engine/project.js';

export const $ = (sel) => document.querySelector(sel);

export function formatClock(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

const LAYER_LABELS = {
  background: '背景几何',
  title: '标题',
  labels: '数据标签',
};

// 绘制时间线刻度与当前场景三层的关键帧点。
export function buildTimeline(project, scene) {
  const ruler = $('#ruler');
  const tracks = $('#tracks');
  ruler.innerHTML = '';
  tracks.innerHTML = '';
  for (let sec = 0; sec <= project.duration; sec += 1) {
    const tick = document.createElement('span');
    tick.style.left = `${(sec / project.duration) * 100}%`;
    tick.textContent = `${sec}s`;
    ruler.appendChild(tick);
  }
  const layers = Object.values(scene.layers);
  layers.forEach((layer, rowIdx) => {
    const row = document.createElement('div');
    row.style.position = 'absolute';
    row.style.top = `${(rowIdx / layers.length) * 100}%`;
    row.style.height = `${100 / layers.length}%`;
    row.style.width = '100%';
    for (const [trackName, track] of Object.entries(layer.tracks)) {
      const isColor = trackName === 'color';
      for (const frame of track) {
        const globalT = scene.inPoint + frame.t;
        const dot = document.createElement('div');
        dot.className = `kf-dot${isColor ? ' color' : ''}`;
        dot.style.left = `${(globalT / project.duration) * 100}%`;
        dot.title = `${LAYER_LABELS[layer.id] || layer.name}.${trackName} @${frame.t}s = ${frame.value}`;
        row.appendChild(dot);
      }
    }
    tracks.appendChild(row);
  });
}

const TRACK_LABELS = {
  x: 'X 位移', y: 'Y 位移', radius: '半径', rotation: '旋转',
  opacity: '不透明度', fontSize: '字号', color: '颜色',
};

export function renderKeyframeEditor(scene, activeLayer, onSelectLayer) {
  const selector = $('#layerSelector');
  selector.innerHTML = '';
  for (const [id, layer] of Object.entries(scene.layers)) {
    const btn = document.createElement('button');
    btn.textContent = LAYER_LABELS[id] || layer.name;
    if (id === activeLayer) btn.className = 'active';
    btn.addEventListener('click', () => onSelectLayer(id));
    selector.appendChild(btn);
  }

  const editor = $('#kfEditor');
  editor.innerHTML = '';
  const layer = scene.layers[activeLayer];
  for (const [trackName, track] of Object.entries(layer.tracks)) {
    const row = document.createElement('div');
    row.className = 'kf-row';
    const label = document.createElement('span');
    label.textContent = TRACK_LABELS[trackName] || trackName;
    const values = document.createElement('div');
    values.className = 'kf-values';
    for (const frame of track) {
      const chip = document.createElement('span');
      chip.className = 'kf-chip';
      chip.textContent = `${frame.t.toFixed(1)}s → ${frame.value}`;
      values.appendChild(chip);
    }
    row.append(label, values);
    editor.appendChild(row);
  }
}

export { kf };
