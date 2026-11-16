import { generateTile } from './textures.js';
import { applyRepairs } from './repair.js';
import { renderSphere, renderCube } from './preview3d.js';
import { Store } from './store.js';
import {
  createElement, elementBounds, validateElements,
  DESIGN_SIZE, SAFE_MARGIN_PCT,
} from './overlay.js';
import { drawElements, drawSafeArea, drawSelection } from './render.js';
import { preflight, buildSVG, renderExportCanvas } from './exporter.js';
import { defaultTemplate, boundaryTemplate } from './templates.js';

const TILE = 256;          // preview tile resolution
const STAGE = 768;         // canvas px (3x3 tiles in flat mode)
const MODEL_RES = 384;     // model preview render resolution

const store = new Store(window.localStorage);
const $ = (id) => document.getElementById(id);
const stage = $('stage');
const ctx = stage.getContext('2d');

const measureCtx = document.createElement('canvas').getContext('2d');
function measureFn(el) {
  measureCtx.font = `${el.fontSize}px ${el.fontFamily}`;
  return {
    w: Math.ceil(measureCtx.measureText(el.text || '').width),
    h: Math.ceil(el.fontSize * 1.2),
  };
}

let selectedId = null;
let tileData = null;       // raw generated tile (TILE x TILE)
let repairedTile = null;   // tile + repair strokes
let activeStroke = null;   // transient brush stroke points
let dragState = null;      // transient element drag
const imageCache = {};     // element id -> HTMLImageElement

// ---------- texture pipeline ----------
function regenTile() {
  tileData = generateTile(store.state.params, TILE);
  reapplyRepairs();
}
function reapplyRepairs() {
  if (!tileData) return;
  const strokes = activeStroke
    ? [...store.state.repairs, ...pointsToStrokes(activeStroke)]
    : store.state.repairs;
  repairedTile = applyRepairs(tileData, TILE, strokes);
}
function pointsToStrokes(points) {
  return points.map(p => ({ x: p.x, y: p.y, r: p.r, strength: 0.85 }));
}

// ---------- preview ----------
function render() {
  const s = store.state;
  ctx.clearRect(0, 0, STAGE, STAGE);
  if (s.view.mode === 'flat') {
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = TILE;
    tmp.getContext('2d').putImageData(new ImageData(repairedTile, TILE, TILE), 0, 0);
    const pattern = ctx.createPattern(tmp, 'repeat');
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, STAGE, STAGE);
    ctx.save();
    ctx.translate(TILE, TILE);
    drawElements(ctx, s.elements, TILE / DESIGN_SIZE, s.timeline, imageCache);
    drawSafeArea(ctx, TILE, SAFE_MARGIN_PCT);
    const sel = s.elements.find(e => e.id === selectedId);
    if (sel) drawSelection(ctx, sel, TILE / DESIGN_SIZE, measureFn);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.strokeRect(TILE + 0.5, TILE + 0.5, TILE - 1, TILE - 1);
  } else {
    const out = new Uint8ClampedArray(MODEL_RES * MODEL_RES * 4);
    if (s.view.model === 'sphere') renderSphere(repairedTile, TILE, out, MODEL_RES);
    else renderCube(repairedTile, TILE, out, MODEL_RES);
    const tmp = document.createElement('canvas');
    tmp.width = tmp.height = MODEL_RES;
    tmp.getContext('2d').putImageData(new ImageData(out, MODEL_RES, MODEL_RES), 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(tmp, 0, 0, STAGE, STAGE);
  }
  refreshChrome();
}

let renderQueued = false;
function queueRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}

// ---------- chrome (status, buttons, panel) ----------
function refreshChrome() {
  $('btn-undo').disabled = !store.canUndo();
  $('btn-redo').disabled = !store.canRedo();
  $('save-state').textContent = store.hasSaved() ? '存在已保存工程' : '尚未保存';
  syncParamPanel();
  syncElementPanel();
}

function setStatus(msg) { $('status').textContent = msg; }

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 7000);
}

// ---------- parameter panel ----------
const PARAMS = [
  ['p-scale', 'scale', 'v-scale', v => v.toFixed(2)],
  ['p-angle', 'angle', 'v-angle', v => v + '°'],
  ['p-contrast', 'contrast', 'v-contrast', v => v.toFixed(2)],
  ['p-seed', 'seed', 'v-seed', v => String(v)],
];
function syncParamPanel() {
  const p = store.state.params;
  for (const [id, key, vid, fmt] of PARAMS) {
    $(id).value = p[key];
    $(vid).textContent = fmt(p[key]);
  }
  $('v-brush').textContent = brushSize + 'px';
  $('v-time').textContent = Number(store.state.timeline).toFixed(2);
  for (const b of document.querySelectorAll('#seg-type button')) {
    b.classList.toggle('active', b.dataset.type === p.type);
  }
  for (const b of document.querySelectorAll('#seg-view button')) {
    b.classList.toggle('active', b.dataset.view === store.state.view.mode);
  }
  $('seg-model').hidden = store.state.view.mode !== 'model';
  for (const b of document.querySelectorAll('#seg-model button')) {
    b.classList.toggle('active', b.dataset.model === store.state.view.model);
  }
}

let regenTimer = null;
function scheduleRegen() {
  clearTimeout(regenTimer);
  regenTimer = setTimeout(() => { regenTile(); queueRender(); }, 120);
}
for (const [id, key] of PARAMS) {
  $(id).addEventListener('input', (e) => {
    store.update(s => { s.params[key] = Number(e.target.value); });
    scheduleRegen();
  });
  $(id).addEventListener('change', (e) => {
    const v = Number(e.target.value);
    store.commit(s => { s.params[key] = v; });
  });
}
$('seg-type').addEventListener('click', (e) => {
  const t = e.target.dataset && e.target.dataset.type;
  if (!t) return;
  store.commit(s => { s.params.type = t; });
  scheduleRegen();
});
$('seg-view').addEventListener('click', (e) => {
  const v = e.target.dataset && e.target.dataset.view;
  if (v) store.commit(s => { s.view.mode = v; });
});
$('seg-model').addEventListener('click', (e) => {
  const m = e.target.dataset && e.target.dataset.model;
  if (m) store.commit(s => { s.view.model = m; });
});
$('p-time').addEventListener('input', (e) => {
  store.update(s => { s.timeline = Number(e.target.value); });
});

// ---------- brush + element interaction ----------
let brushSize = 24;
$('p-brush').addEventListener('input', (e) => {
  brushSize = Number(e.target.value);
  $('v-brush').textContent = brushSize + 'px';
});

function stageToTile(ev) {
  const r = stage.getBoundingClientRect();
  const sx = (ev.clientX - r.left) * (STAGE / r.width);
  const sy = (ev.clientY - r.top) * (STAGE / r.height);
  return { x: sx - TILE, y: sy - TILE }; // center-tile pixel coords
}

function hitElement(px, py) {
  const els = store.state.elements;
  for (let i = els.length - 1; i >= 0; i--) {
    const b = elementBounds(els[i], measureFn);
    const k = TILE / DESIGN_SIZE;
    if (px >= b.x * k && px <= (b.x + b.w) * k && py >= b.y * k && py <= (b.y + b.h) * k) {
      return els[i];
    }
  }
  return null;
}

stage.addEventListener('pointerdown', (ev) => {
  if (store.state.view.mode !== 'flat') return;
  stage.setPointerCapture(ev.pointerId);
  const p = stageToTile(ev);
  const hit = hitElement(p.x, p.y);
  if (hit) {
    selectedId = hit.id;
    dragState = {
      id: hit.id,
      dx: p.x - hit.x * (TILE / DESIGN_SIZE),
      dy: p.y - hit.y * (TILE / DESIGN_SIZE),
      orig: { x: hit.x, y: hit.y },
      moved: false,
    };
  } else {
    selectedId = null;
    activeStroke = [];
    addBrushPoint(p);
  }
  queueRender();
});
stage.addEventListener('pointermove', (ev) => {
  const p = stageToTile(ev);
  if (dragState) {
    dragState.moved = true;
    const k = TILE / DESIGN_SIZE;
    const nx = (p.x - dragState.dx) / k, ny = (p.y - dragState.dy) / k;
    store.update(s => {
      const el = s.elements.find(e => e.id === dragState.id);
      if (el) { el.x = Math.round(nx); el.y = Math.round(ny); }
    });
  } else if (activeStroke) {
    addBrushPoint(p);
  }
});
stage.addEventListener('pointerup', () => {
  if (dragState) {
    if (dragState.moved) {
      const id = dragState.id;
      const orig = dragState.orig;
      const cur = store.state.elements.find(e => e.id === id);
      const fx = cur && cur.x, fy = cur && cur.y;
      // transient drag was never committed; restore origin, then commit final
      store.update(s => {
        const el = s.elements.find(e => e.id === id);
        if (el) { el.x = orig.x; el.y = orig.y; }
      });
      store.commit(s => {
        const el = s.elements.find(e => e.id === id);
        if (el) { el.x = fx; el.y = fy; }
      });
      checkSafeArea();
    }
    dragState = null;
  }
  if (activeStroke) {
    const strokes = pointsToStrokes(activeStroke);
    activeStroke = null;
    store.commit(s => { s.repairs.push(...strokes); });
    reapplyRepairs();
  }
  queueRender();
});

function addBrushPoint(p) {
  if (p.x < -64 || p.y < -64 || p.x > TILE + 64 || p.y > TILE + 64) return;
  activeStroke.push({ x: p.x / TILE, y: p.y / TILE, r: brushSize / TILE });
  reapplyRepairs();
  queueRender();
}

function checkSafeArea() {
  const issues = validateElements(store.state.elements, DESIGN_SIZE, SAFE_MARGIN_PCT, measureFn);
  if (issues.length) {
    toast('安全区警告：\n' + issues.map(i => i.message).join('\n'));
  }
}

// ---------- element panel ----------
function selectedEl() {
  return store.state.elements.find(e => e.id === selectedId) || null;
}
function syncElementPanel() {
  const el = selectedEl();
  const panel = $('element-props');
  panel.hidden = !el;
  if (!el) return;
  $('el-text').value = el.text || '';
  $('el-fontsize').value = el.fontSize || 32;
  $('el-font').value = el.fontFamily || 'sans-serif';
  $('el-color').value = el.color;
  $('el-x').value = Math.round(el.x);
  $('el-y').value = Math.round(el.y);
  $('el-w').value = Math.round(el.w);
  $('el-h').value = Math.round(el.h);
}
function commitSelected(fn) {
  const id = selectedId;
  if (!id) return;
  store.commit(s => {
    const el = s.elements.find(e => e.id === id);
    if (el) fn(el);
  });
  checkSafeArea();
}
$('el-text').addEventListener('change', e => commitSelected(el => { el.text = e.target.value; }));
$('el-fontsize').addEventListener('change', e => commitSelected(el => { el.fontSize = Number(e.target.value); }));
$('el-font').addEventListener('change', e => commitSelected(el => { el.fontFamily = e.target.value; }));
$('el-color').addEventListener('change', e => commitSelected(el => { el.color = e.target.value; }));
for (const [id, key] of [['el-x', 'x'], ['el-y', 'y'], ['el-w', 'w'], ['el-h', 'h']]) {
  $(id).addEventListener('change', e => commitSelected(el => { el[key] = Number(e.target.value); }));
}
$('btn-del-el').addEventListener('click', () => {
  const id = selectedId;
  if (!id) return;
  store.commit(s => { s.elements = s.elements.filter(e => e.id !== id); });
  selectedId = null;
});

function addElement(type) {
  const el = createElement(type);
  store.commit(s => { s.elements.push(el); });
  selectedId = el.id;
  checkSafeArea();
}
$('btn-add-text').addEventListener('click', () => addElement('text'));
$('btn-add-rect').addEventListener('click', () => addElement('rect'));
$('btn-add-ellipse').addEventListener('click', () => addElement('ellipse'));

// ---------- undo / redo / save / reload ----------
$('btn-undo').addEventListener('click', () => store.undo());
$('btn-redo').addEventListener('click', () => store.redo());
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) store.redo(); else store.undo();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    store.redo();
  }
});
$('btn-save').addEventListener('click', () => {
  store.save();
  setStatus('已保存 ' + new Date().toLocaleTimeString());
  queueRender();
});
$('btn-reload').addEventListener('click', () => {
  if (store.reload()) {
    selectedId = null;
    regenTile();
    setStatus('已重新载入保存的工程');
  } else {
    toast('没有找到已保存的工程。请先点击「保存」。');
  }
});

// ---------- project import / export ----------
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('btn-export-json').addEventListener('click', () => {
  download(new Blob([store.serialize()], { type: 'application/json' }), 'texture-project.json');
});
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    store.restore(await file.text());
    selectedId = null;
    regenTile();
    setStatus('工程导入成功');
  } catch (err) {
    toast('导入失败：' + err.message);
  }
  e.target.value = '';
});

// ---------- templates ----------
function loadTemplate(tpl, label) {
  store.commit(s => {
    s.params = tpl.params;
    s.repairs = tpl.repairs;
    s.elements = tpl.elements;
    s.timeline = tpl.timeline;
  });
  selectedId = null;
  regenTile();
  setStatus('已载入' + label);
  checkSafeArea();
}
$('btn-tpl-default').addEventListener('click', () => loadTemplate(defaultTemplate(), '默认案例'));
$('btn-tpl-boundary').addEventListener('click', () => loadTemplate(boundaryTemplate(), '边界案例'));

// ---------- PNG / SVG export ----------
async function exportPNG(size) {
  const issues = preflight(store.state, measureFn);
  if (issues.length) {
    toast(`导出已取消，请先修复 ${issues.length} 个问题：\n` + issues.map(i => i.message).join('\n'));
    return;
  }
  const canvas = await renderExportCanvas(store.state, size, {
    generateTile, applyRepairs, drawElements, measureFn, imageCache,
  });
  canvas.toBlob((blob) => {
    download(blob, `texture-${store.state.params.type}-${size}.png`);
    setStatus(`已导出 PNG ${size}×${size}`);
  }, 'image/png');
}
$('btn-png512').addEventListener('click', () => exportPNG(512));
$('btn-png1024').addEventListener('click', () => exportPNG(1024));

$('btn-svg').addEventListener('click', async () => {
  const issues = preflight(store.state, measureFn);
  if (issues.length) {
    toast(`导出已取消，请先修复 ${issues.length} 个问题：\n` + issues.map(i => i.message).join('\n'));
    return;
  }
  const size = 512;
  const canvas = await renderExportCanvas(store.state, size, {
    generateTile, applyRepairs, drawElements: (c) => c, measureFn, imageCache,
  });
  const svg = buildSVG(store.state, canvas.toDataURL('image/png'), size, measureFn);
  download(new Blob([svg], { type: 'image/svg+xml' }), `texture-${store.state.params.type}.svg`);
  setStatus('已导出 SVG（文字与图形保持可编辑）');
});

// ---------- init ----------
store.subscribe(() => {
  reapplyRepairs();
  queueRender();
});
// First run: load the default case so the app opens with a working example.
{
  const tpl = defaultTemplate();
  store.update(s => {
    s.params = tpl.params;
    s.elements = tpl.elements;
    s.timeline = tpl.timeline;
  });
}
regenTile();
render();
