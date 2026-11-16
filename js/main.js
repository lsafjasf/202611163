// 交互主逻辑:选择/拖拽/缩放/吸附、文本编辑、撤销重做、保存载入、导出。
import {
  PAGE, gridFor, createState, makeText, makeImage, makeShape,
  createHistory, snapshotOf, undo, redo, reflowColumns, validate,
  serialize, deserialize,
} from './model.js';
import { drawPage, fontOf } from './render.js';
import { exportSVG, exportPNG, downloadBlob, downloadJSON } from './exporter.js';
import { defaultCase, boundaryCase } from './presets.js';

const $ = (id) => document.getElementById(id);
const canvas = $('stage');
const ctx = canvas.getContext('2d');
const SAVE_KEY = 'poster-grid-editor-save';

let state = defaultCase();
const hist = createHistory();
let lastSnapshot = snapshotOf(state);
const images = {};
let playTime = null;
let playRaf = 0;

function canvasPos(evt) {
  const r = canvas.getBoundingClientRect();
  return {
    x: (evt.clientX - r.left) * (PAGE.w / r.width),
    y: (evt.clientY - r.top) * (PAGE.h / r.height),
  };
}

function render() {
  drawPage(ctx, state, { selectedId: state.selectedId, images, time: playTime });
  syncPanel();
}

function showAlerts(issues, { allowUndo = false } = {}) {
  const box = $('alerts');
  if (!issues.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = issues.map((i) =>
    `<div class="${i.level}">[${i.level === 'error' ? '错误' : '警告'}] ${i.msg}<span class="fix">修复建议:${i.fix}</span></div>`
  ).join('') + (allowUndo ? '<div><button id="alertUndo">撤销上一步</button></div>' : '');
  const btn = $('alertUndo');
  if (btn) btn.onclick = () => { doUndo(); };
}

function commit() {
  hist.undoStack.push(lastSnapshot);
  if (hist.undoStack.length > hist.limit) hist.undoStack.shift();
  hist.redoStack.length = 0;
  lastSnapshot = snapshotOf(state);
  autosave();
  render();
}

function checkAndAlert({ allowUndo = false } = {}) {
  const issues = validate(state, measureLines);
  showAlerts(issues, { allowUndo: allowUndo && issues.length > 0 });
  return issues;
}

function measureLines(el) {
  ctx.save();
  ctx.font = fontOf(el);
  let lines = 1, cur = '';
  for (const ch of String(el.text || '')) {
    if (ch === '\n') { lines++; cur = ''; continue; }
    if (ctx.measureText(cur + ch).width > el.w && cur) { lines++; cur = ch; }
    else cur += ch;
  }
  ctx.restore();
  return lines;
}

function selected() {
  return state.elements.find((e) => e.id === state.selectedId) || null;
}

// ---------- 命中测试 / 拖拽 / 吸附 ----------
const SNAP = 8;
let drag = null;

function hitTest(p) {
  for (let i = state.elements.length - 1; i >= 0; i--) {
    const el = state.elements[i];
    if (p.x >= el.x && p.x <= el.x + el.w && p.y >= el.y && p.y <= el.y + el.h) {
      const onHandle = p.x >= el.x + el.w - 12 && p.y >= el.y + el.h - 12;
      return { el, mode: onHandle ? 'resize' : 'move' };
    }
  }
  return null;
}

function snapGuides() {
  const g = gridFor(state.cols);
  return {
    vx: [...g.vGuides, g.safe.x, g.safe.x + g.safe.w, PAGE.w / 2],
    hy: [...g.hGuides, g.safe.y, g.safe.y + g.safe.h],
  };
}

function applySnap(el) {
  const { vx, hy } = snapGuides();
  const xTargets = [el.x, el.x + el.w / 2, el.x + el.w];
  const yTargets = [el.y, el.y + el.h / 2, el.y + el.h];
  for (const gx of vx) {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(xTargets[i] - gx) < SNAP) { el.x += gx - xTargets[i]; break; }
    }
  }
  for (const gy of hy) {
    for (let i = 0; i < 3; i++) {
      if (Math.abs(yTargets[i] - gy) < SNAP) { el.y += gy - yTargets[i]; break; }
    }
  }
}

canvas.addEventListener('mousedown', (evt) => {
  const p = canvasPos(evt);
  const hit = hitTest(p);
  if (hit) {
    state.selectedId = hit.el.id;
    drag = { ...hit, startX: p.x, startY: p.y, orig: { ...hit.el } };
  } else {
    state.selectedId = null;
    drag = null;
  }
  render();
});

window.addEventListener('mousemove', (evt) => {
  if (!drag) return;
  const p = canvasPos(evt);
  const dx = p.x - drag.startX;
  const dy = p.y - drag.startY;
  const el = drag.el;
  if (drag.mode === 'move') {
    el.x = Math.round(drag.orig.x + dx);
    el.y = Math.round(drag.orig.y + dy);
    applySnap(el);
  } else {
    el.w = Math.max(8, Math.round(drag.orig.w + dx));
    el.h = Math.max(8, Math.round(drag.orig.h + dy));
  }
  render();
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const el = drag.el;
  const moved = el.x !== drag.orig.x || el.y !== drag.orig.y || el.w !== drag.orig.w || el.h !== drag.orig.h;
  drag = null;
  if (moved) {
    commit();
    checkAndAlert({ allowUndo: true });
  }
});

// ---------- 双击编辑文本 ----------
const editor = $('textEditor');
let editingEl = null;

canvas.addEventListener('dblclick', (evt) => {
  const p = canvasPos(evt);
  const hit = hitTest(p);
  if (!hit || hit.el.type !== 'text') return;
  editingEl = hit.el;
  const r = canvas.getBoundingClientRect();
  const k = r.width / PAGE.w;
  editor.hidden = false;
  editor.style.left = `${editingEl.x * k}px`;
  editor.style.top = `${editingEl.y * k}px`;
  editor.style.width = `${editingEl.w * k}px`;
  editor.style.height = `${Math.max(editingEl.h, editingEl.fontSize * 1.5) * k}px`;
  editor.style.fontSize = `${editingEl.fontSize * k}px`;
  editor.value = editingEl.text;
  editor.focus();
  editor.select();
});

function closeEditor(save) {
  if (!editingEl) return;
  if (save && editor.value !== editingEl.text) {
    editingEl.text = editor.value;
    commit();
    checkAndAlert({ allowUndo: true });
  }
  editingEl = null;
  editor.hidden = true;
}
editor.addEventListener('blur', () => closeEditor(true));
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeEditor(false);
  e.stopPropagation();
});

// ---------- 属性面板 ----------
function syncPanel() {
  const el = selected();
  $('panelEmpty').hidden = !!el;
  $('panelBody').hidden = !el;
  if (!el) return;
  $('pType').value = { text: '文本', image: '图片', shape: '图形' }[el.type];
  $('pX').value = Math.round(el.x);
  $('pY').value = Math.round(el.y);
  $('pW').value = Math.round(el.w);
  $('pH').value = Math.round(el.h);
  $('pOpacity').value = el.opacity ?? 1;
  $('textProps').hidden = el.type !== 'text';
  $('shapeProps').hidden = el.type !== 'shape';
  $('imageProps').hidden = el.type !== 'image';
  if (el.type === 'text') {
    $('pText').value = el.text;
    $('pFont').value = el.fontFamily || 'sans-serif';
    $('pFontSize').value = el.fontSize;
    $('pColor').value = el.color || '#1a1a2e';
    $('pAlign').value = el.align || 'left';
    $('pBold').checked = !!el.bold;
  }
  if (el.type === 'shape') {
    $('pFill').value = el.fill || '#4f6df5';
    $('pShape').value = el.shape || 'rect';
  }
  const kfList = $('kfList');
  kfList.innerHTML = '';
  (el.keyframes || []).forEach((kf, i) => {
    const row = document.createElement('div');
    row.className = 'kf';
    row.innerHTML = `<span>t=${kf.t}s</span>`;
    const del = document.createElement('button');
    del.textContent = '删除';
    del.onclick = () => { el.keyframes.splice(i, 1); commit(); };
    row.appendChild(del);
    kfList.appendChild(row);
  });
}

function bindPanel(id, apply) {
  $(id).addEventListener('change', () => {
    const el = selected();
    if (!el) return;
    apply(el);
    commit();
    checkAndAlert({ allowUndo: true });
  });
}
bindPanel('pX', (el) => { el.x = +$('pX').value; });
bindPanel('pY', (el) => { el.y = +$('pY').value; });
bindPanel('pW', (el) => { el.w = Math.max(1, +$('pW').value); });
bindPanel('pH', (el) => { el.h = Math.max(1, +$('pH').value); });
bindPanel('pOpacity', (el) => { el.opacity = +$('pOpacity').value; });
bindPanel('pText', (el) => { el.text = $('pText').value; });
bindPanel('pFont', (el) => { el.fontFamily = $('pFont').value; });
bindPanel('pFontSize', (el) => { el.fontSize = Math.max(8, +$('pFontSize').value); });
bindPanel('pColor', (el) => { el.color = $('pColor').value; });
bindPanel('pAlign', (el) => { el.align = $('pAlign').value; });
bindPanel('pBold', (el) => { el.bold = $('pBold').checked; });
bindPanel('pFill', (el) => { el.fill = $('pFill').value; });
bindPanel('pShape', (el) => { el.shape = $('pShape').value; });

// ---------- 工具栏 ----------
$('colsSelect').value = String(state.cols);
$('colsSelect').addEventListener('change', () => {
  const newCols = +$('colsSelect').value;
  const { changed, warnings } = reflowColumns(state, newCols);
  if (!changed) return;
  commit();
  const issues = checkAndAlert({ allowUndo: true });
  if (warnings.length && !issues.length) {
    showAlerts(warnings.map((msg) => ({ level: 'warn', msg, fix: '可撤销(Ctrl+Z)恢复旧版式' })), { allowUndo: true });
  }
});

$('addText').onclick = () => { state.elements.push(makeText()); state.selectedId = state.elements.at(-1).id; commit(); };
$('addImage').onclick = () => { state.elements.push(makeImage()); state.selectedId = state.elements.at(-1).id; commit(); };
$('addShape').onclick = () => { state.elements.push(makeShape()); state.selectedId = state.elements.at(-1).id; commit(); };

$('deleteBtn').onclick = () => {
  const i = state.elements.findIndex((e) => e.id === state.selectedId);
  if (i >= 0) { state.elements.splice(i, 1); state.selectedId = null; commit(); }
};

$('addKfBtn').onclick = () => {
  const el = selected();
  if (!el) return;
  const t = +(prompt('关键帧时间(秒)', String((el.keyframes?.length || 0))) || '0');
  el.keyframes = el.keyframes || [];
  el.keyframes.push({ t, props: { x: el.x, y: el.y, opacity: el.opacity ?? 1 } });
  commit();
};

function doUndo() {
  if (undo(hist, state)) { lastSnapshot = snapshotOf(state); $('colsSelect').value = String(state.cols); autosave(); render(); showAlerts([]); }
}
function doRedo() {
  if (redo(hist, state)) { lastSnapshot = snapshotOf(state); $('colsSelect').value = String(state.cols); autosave(); render(); showAlerts([]); }
}
$('undoBtn').onclick = doUndo;
$('redoBtn').onclick = doRedo;

window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
  if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const i = state.elements.findIndex((el) => el.id === state.selectedId);
    if (i >= 0) { state.elements.splice(i, 1); state.selectedId = null; commit(); }
  }
});

// ---------- 保存 / 载入 ----------
function autosave() {
  try { localStorage.setItem(SAVE_KEY, serialize(state)); } catch { /* 存储满时忽略 */ }
}

$('saveBtn').onclick = () => {
  autosave();
  showAlerts([{ level: 'warn', msg: '已保存到浏览器本地存储', fix: '点击"重新载入"可恢复;也可导出 JSON 备份' }]);
};

$('loadBtn').onclick = () => {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) { showAlerts([{ level: 'warn', msg: '没有找到已保存的版式', fix: '先点击"保存"' }]); return; }
  try {
    state = deserialize(raw);
    $('colsSelect').value = String(state.cols);
    loadImagesFromState();
    commit();
    showAlerts([]);
  } catch (err) {
    showAlerts([{ level: 'error', msg: `载入失败:${err.message}`, fix: '检查本地存储数据或改用导入 JSON' }]);
  }
};

$('exportJsonBtn').onclick = () => downloadJSON(state);
$('importJsonBtn').onclick = () => $('jsonInput').click();
$('jsonInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    state = deserialize(await file.text());
    $('colsSelect').value = String(state.cols);
    loadImagesFromState();
    commit();
    showAlerts([]);
  } catch (err) {
    showAlerts([{ level: 'error', msg: `导入失败:${err.message}`, fix: '确认文件是本工具导出的版式 JSON' }]);
  }
  e.target.value = '';
});

// ---------- 图片上传 ----------
$('uploadImgBtn').onclick = () => $('fileInput').click();
$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  const el = selected();
  if (!file || !el || el.type !== 'image') return;
  const reader = new FileReader();
  reader.onload = () => {
    el.src = reader.result; // dataURL,随 JSON 一起保存,恢复后一致
    commit();
    loadImagesFromState();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

function loadImagesFromState() {
  for (const el of state.elements) {
    if (el.type === 'image' && el.src && !images[el.id]) {
      const img = new Image();
      img.onload = render;
      img.src = el.src;
      images[el.id] = img;
    }
  }
  render();
}

// ---------- 导出(先校验,保留参数) ----------
async function guardExport() {
  autosave(); // 导出前保留当前参数
  const issues = validate(state, measureLines);
  const errors = issues.filter((i) => i.level === 'error');
  if (issues.length) {
    showAlerts(issues, { allowUndo: true });
    const detail = issues.map((i) => `• ${i.msg} → ${i.fix}`).join('\n');
    if (errors.length) {
      alert(`发现 ${errors.length} 个错误,导出已取消:\n${detail}`);
      return false;
    }
    return confirm(`存在 ${issues.length} 个警告:\n${detail}\n\n仍要导出吗?`);
  }
  return true;
}

$('exportPngBtn').onclick = async () => {
  if (!(await guardExport())) return;
  const blob = await exportPNG(state, images, 2);
  downloadBlob(blob, `${state.name || 'poster'}.png`);
};

$('exportSvgBtn').onclick = async () => {
  if (!(await guardExport())) return;
  const measureCtx = document.createElement('canvas').getContext('2d');
  const svg = exportSVG(state, measureCtx);
  downloadBlob(new Blob([svg], { type: 'image/svg+xml' }), `${state.name || 'poster'}.svg`);
};

// ---------- 预设与动画 ----------
$('presetDefault').onclick = () => { state = defaultCase(); $('colsSelect').value = '3'; loadImagesFromState(); commit(); showAlerts([]); };
$('presetBoundary').onclick = () => {
  state = boundaryCase();
  $('colsSelect').value = '4';
  loadImagesFromState();
  commit();
  checkAndAlert({ allowUndo: true });
};

$('playBtn').onclick = () => {
  if (playTime != null) { cancelAnimationFrame(playRaf); playTime = null; $('playBtn').textContent = '▶ 预览动画'; render(); return; }
  const start = performance.now();
  $('playBtn').textContent = '■ 停止';
  const tick = (now) => {
    playTime = ((now - start) / 1000) % 3;
    render();
    playRaf = requestAnimationFrame(tick);
  };
  playRaf = requestAnimationFrame(tick);
};

// ---------- 初始化 ----------
const saved = localStorage.getItem(SAVE_KEY);
if (saved) {
  try { state = deserialize(saved); $('colsSelect').value = String(state.cols); } catch { /* 用默认案例 */ }
}
loadImagesFromState();
autosave();
render();
