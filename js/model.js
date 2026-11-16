// 数据模型与纯逻辑:状态、历史、重排、校验、序列化。浏览器与 node 均可加载。
export const PAGE = { w: 900, h: 1200, margin: 48, gutter: 24 };
export const COLS_OPTIONS = [3, 4];

let uidCounter = 1;
export function uid(prefix = 'el') {
  return `${prefix}_${Date.now().toString(36)}_${uidCounter++}`;
}

export function gridFor(cols) {
  const contentW = PAGE.w - PAGE.margin * 2;
  const colW = (contentW - (cols - 1) * PAGE.gutter) / cols;
  const vGuides = [];
  for (let i = 0; i <= cols; i++) {
    vGuides.push(PAGE.margin + i * (colW + PAGE.gutter) - (i === cols ? PAGE.gutter : 0));
  }
  const safe = {
    x: PAGE.margin,
    y: PAGE.margin,
    w: contentW,
    h: PAGE.h - PAGE.margin * 2,
  };
  return {
    cols, colW, contentW,
    vGuides,
    hGuides: [PAGE.margin, PAGE.h / 2, PAGE.h - PAGE.margin, safe.y, safe.y + safe.h],
    safe,
  };
}

export function createState(cols = 3) {
  return { version: 1, name: '未命名海报', cols, elements: [], selectedId: null };
}

export function makeText(props = {}) {
  return {
    id: uid('txt'), type: 'text',
    x: 60, y: 60, w: 320, h: 90,
    text: '双击编辑标题', fontFamily: 'sans-serif', fontSize: 40,
    color: '#1a1a2e', align: 'left', bold: true, opacity: 1,
    keyframes: [], ...props,
  };
}

export function makeImage(props = {}) {
  return {
    id: uid('img'), type: 'image',
    x: 60, y: 200, w: 320, h: 240,
    src: null, fit: 'cover', opacity: 1, keyframes: [], ...props,
  };
}

export function makeShape(props = {}) {
  return {
    id: uid('shp'), type: 'shape',
    x: 60, y: 500, w: 200, h: 120,
    shape: 'rect', fill: '#4f6df5', stroke: null, opacity: 1,
    keyframes: [], ...props,
  };
}

// ---------- 历史(撤销/重做) ----------
export function snapshotOf(state) {
  return JSON.stringify({ cols: state.cols, name: state.name, elements: state.elements });
}

export function createHistory(limit = 100) {
  return { undoStack: [], redoStack: [], limit };
}

export function pushHistory(hist, state) {
  hist.undoStack.push(snapshotOf(state));
  if (hist.undoStack.length > hist.limit) hist.undoStack.shift();
  hist.redoStack.length = 0;
}

export function applySnapshot(state, snap) {
  const data = JSON.parse(snap);
  state.cols = data.cols;
  state.name = data.name;
  state.elements = data.elements;
  state.selectedId = null;
}

export function undo(hist, state) {
  if (!hist.undoStack.length) return false;
  hist.redoStack.push(snapshotOf(state));
  applySnapshot(state, hist.undoStack.pop());
  return true;
}

export function redo(hist, state) {
  if (!hist.redoStack.length) return false;
  hist.undoStack.push(snapshotOf(state));
  applySnapshot(state, hist.redoStack.pop());
  return true;
}

// ---------- 栏数切换重排 ----------
// 以"列单位"描述元素水平位置,换新栏数后重新映射;内容不删除,放不下的等比收缩并告警。
export function reflowColumns(state, newCols) {
  if (!COLS_OPTIONS.includes(newCols) || newCols === state.cols) {
    return { changed: false, warnings: [] };
  }
  const oldGrid = gridFor(state.cols);
  const newGrid = gridFor(newCols);
  const warnings = [];
  const oldContentW = oldGrid.contentW;
  const newContentW = newGrid.contentW;
  for (const el of state.elements) {
    const fx = (el.x - PAGE.margin) / oldContentW;
    const fw = el.w / oldContentW;
    let nx = PAGE.margin + fx * newContentW;
    let nw = fw * newContentW;
    if (nx + nw > PAGE.w - PAGE.margin) {
      const scale = (PAGE.w - PAGE.margin - nx) / nw;
      nw = Math.max(24, nw * scale);
      el.h = Math.max(24, el.h * scale);
      warnings.push(`元素「${labelOf(el)}」超出新版面,已等比缩小以保留内容`);
    }
    el.x = Math.round(nx);
    el.w = Math.round(nw);
    if (el.x < PAGE.margin) el.x = PAGE.margin;
  }
  state.cols = newCols;
  return { changed: true, warnings };
}

export function labelOf(el) {
  if (el.type === 'text') return (el.text || '').slice(0, 12) || '文本';
  return el.type === 'image' ? '图片' : '图形';
}

// ---------- 校验:越界 / 安全区 / 文字裁切 ----------
// measurer(text, fontSize, fontFamily, bold, maxWidth) -> 行数(可选注入,默认估算)
export function validate(state, measurer) {
  const grid = gridFor(state.cols);
  const issues = [];
  for (const el of state.elements) {
    const label = labelOf(el);
    if (el.x < 0 || el.y < 0 || el.x + el.w > PAGE.w || el.y + el.h > PAGE.h) {
      issues.push({
        level: 'error', id: el.id,
        msg: `「${label}」超出画布边界`,
        fix: '使用撤销(Ctrl+Z)回退上一步,或在属性面板把 x/y 改为 0 并缩小尺寸',
      });
      continue;
    }
    const s = grid.safe;
    if (el.x < s.x || el.y < s.y || el.x + el.w > s.x + s.w || el.y + el.h > s.y + s.h) {
      issues.push({
        level: 'warn', id: el.id,
        msg: `「${label}」超出安全边距,导出印刷时可能被裁切`,
        fix: '将元素拖入虚线安全框内,或缩小元素尺寸',
      });
    }
    if (el.w < 16 && el.h < 16) {
      issues.push({
        level: 'warn', id: el.id,
        msg: `「${label}」尺寸过小(${Math.round(el.w)}×${Math.round(el.h)}),导出后难以辨认`,
        fix: '在属性面板把宽高至少调到 24 以上',
      });
    }
    if (el.type === 'text') {
      const lines = (measurer || estimateLines)(el);
      const lineH = el.fontSize * 1.25;
      if (lines * lineH > el.h + 1) {
        issues.push({
          level: 'error', id: el.id,
          msg: `「${label}」文字将被裁切(约 ${lines} 行,文本框仅容 ${Math.floor(el.h / lineH)} 行)`,
          fix: '增大文本框高度、减小字号,或精简文字内容',
        });
      }
    }
  }
  return issues;
}

export function estimateLines(el) {
  const perChar = (ch) => (/[⺀-鿿豈-﫿＀-￯　-〿]/.test(ch) ? 1 : 0.55);
  const maxW = el.w;
  let lines = 1, cur = 0;
  for (const ch of String(el.text || '')) {
    if (ch === '\n') { lines++; cur = 0; continue; }
    cur += perChar(ch) * el.fontSize;
    if (cur > maxW) { lines++; cur = perChar(ch) * el.fontSize; }
  }
  return lines;
}

// ---------- 序列化:保存 / 恢复 ----------
export function serialize(state) {
  return JSON.stringify({
    version: state.version, name: state.name, cols: state.cols,
    savedAt: new Date().toISOString(),
    elements: state.elements,
  }, null, 2);
}

export function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (!data || !Array.isArray(data.elements) || !COLS_OPTIONS.includes(data.cols)) {
    throw new Error('版式 JSON 格式不正确:缺少 elements 或 cols 非法');
  }
  const state = createState(data.cols);
  state.name = data.name || state.name;
  state.elements = data.elements.map((el) => ({ keyframes: [], opacity: 1, ...el }));
  return state;
}
