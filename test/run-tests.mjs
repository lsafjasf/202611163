// Node tests for the tileable texture studio core logic.
import { generateTile } from '../js/textures.js';
import { expandStroke, applyRepairs } from '../js/repair.js';
import { Store, defaultState } from '../js/store.js';
import {
  validateElements, sampleKeyframes, createElement,
  DESIGN_SIZE, SAFE_MARGIN_PCT,
} from '../js/overlay.js';
import { buildSVG, preflight } from '../js/exporter.js';
import { defaultTemplate, boundaryTemplate } from '../js/templates.js';

let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log('  ok -', name); }
  else { failed++; console.error('  FAIL -', name); }
}
function section(s) { console.log('\n[' + s + ']'); }

// ---- 1. Seam continuity on all four edges, all types, rotated angles ----
section('seam continuity');
for (const type of ['stone', 'wood', 'fabric']) {
  for (const angle of [0, 33, 90, 137]) {
    const size = 128;
    const d = generateTile({ type, scale: 2.3, angle, contrast: 1.4, seed: 9 }, size);
    // Continuity criterion: seam difference must not exceed the texture's
    // own interior adjacent-pixel gradient (high-frequency patterns alias).
    let hErr = 0, vErr = 0, hInt = 0, vInt = 0;
    for (let y = 0; y < size; y++) {
      for (let k = 0; k < 3; k++) {
        hErr += Math.abs(d[(y * size + 0) * 4 + k] - d[(y * size + size - 1) * 4 + k]);
        hInt += Math.abs(d[(y * size + 1) * 4 + k] - d[(y * size + 2) * 4 + k]);
      }
    }
    for (let x = 0; x < size; x++) {
      for (let k = 0; k < 3; k++) {
        vErr += Math.abs(d[(0 * size + x) * 4 + k] - d[((size - 1) * size + x) * 4 + k]);
        vInt += Math.abs(d[(size + x) * 4 + k] - d[(2 * size + x) * 4 + k]);
      }
    }
    hErr /= size * 3; vErr /= size * 3; hInt /= size * 3; vInt /= size * 3;
    const hOk = hErr <= hInt * 1.5 + 2, vOk = vErr <= vInt * 1.5 + 2;
    assert(hOk && vOk,
      `${type} @${angle}° seam H=${hErr.toFixed(1)}/${hInt.toFixed(1)} V=${vErr.toFixed(1)}/${vInt.toFixed(1)} (seam/interior)`);
  }
}

// ---- 2. Repair stroke near edge syncs to opposite edge ----
section('repair mirroring');
{
  const size = 128;
  const base = generateTile({ type: 'fabric', scale: 4, angle: 0, contrast: 1.5, seed: 3 }, size);
  const stroke = { x: 0.03, y: 0.5, r: 0.1, strength: 0.9 };
  const expanded = expandStroke(stroke);
  assert(expanded.some(s => s.x > 1), 'stroke mirrors to opposite (right) edge');
  const out = applyRepairs(base, size, [stroke]);
  const yMid = Math.floor(0.5 * size);
  const leftChanged = Math.abs(out[(yMid * size + 2) * 4] - base[(yMid * size + 2) * 4]);
  let rightChanged = 0;
  for (let x = size - 13; x < size; x++) {
    for (let y = yMid - 12; y <= yMid + 12; y++) {
      rightChanged = Math.max(rightChanged, Math.abs(out[(y * size + x) * 4] - base[(y * size + x) * 4]));
    }
  }
  assert(leftChanged > 0, `left edge healed (delta=${leftChanged})`);
  assert(rightChanged > 0, `right edge mirrored heal (delta=${rightChanged})`);
  // seamlessness preserved after repair
  let err = 0;
  for (let y = 0; y < size; y++) {
    err += Math.abs(out[(y * size) * 4] - out[(y * size + size - 1) * 4]);
  }
  assert(err / size < 20, `post-repair seam err=${(err / size).toFixed(1)} (<20)`);
}

// ---- 3. Undo / redo ----
section('undo/redo');
{
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const st = new Store(storage);
  const before = st.state.params.scale;
  st.commit(s => { s.params.scale = 4; });
  st.commit(s => { s.params.scale = 7; });
  assert(st.state.params.scale === 7, 'commits applied');
  st.undo();
  assert(st.state.params.scale === 4, 'undo -> 4');
  st.undo();
  assert(st.state.params.scale === before, 'undo -> original');
  st.redo();
  assert(st.state.params.scale === 4, 'redo -> 4');
  st.undo();
  st.commit(s => { s.params.seed = 99; });
  assert(!st.canRedo(), 'new commit clears redo stack');
}

// ---- 4. Save / reload roundtrip (fonts, images, keyframes, params) ----
section('save/reload');
{
  const mem = new Map();
  const storage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const st = new Store(storage);
  st.commit(s => {
    Object.assign(s, defaultTemplate());
    s.elements.push(createElement('image', { src: 'data:image/png;base64,AAAA', name: 'logo.png' }));
    s.elements.push(createElement('text', {
      text: '字体测试', fontFamily: 'monospace',
      keyframes: [{ t: 0, x: 1, y: 2, opacity: 0.5 }, { t: 1, x: 9, y: 8, opacity: 1 }],
    }));
  });
  const snapshot = JSON.stringify(st.state);
  st.save();
  st.commit(s => { s.elements = []; s.params.type = 'fabric'; });
  assert(st.reload(), 'reload finds saved project');
  assert(JSON.stringify(st.state) === snapshot, 'state restored identically (template/font/image/keyframes/params)');
  const kfEl = st.state.elements.find(e => e.keyframes && e.keyframes.length === 2);
  const mid = sampleKeyframes(kfEl, 0.5);
  assert(mid.x === 5 && mid.y === 5 && Math.abs(mid.opacity - 0.75) < 1e-9, 'keyframe midpoint interpolation');
}

// ---- 5. Boundary validation ----
section('boundary validation');
{
  const def = defaultTemplate();
  const defIssues = validateElements(def.elements, DESIGN_SIZE, SAFE_MARGIN_PCT);
  assert(defIssues.length === 0, `default template passes safe-area (${defIssues.length} issues)`);

  const bnd = boundaryTemplate();
  const issues = validateElements(bnd.elements, DESIGN_SIZE, SAFE_MARGIN_PCT);
  const kinds = issues.map(i => i.kind);
  assert(kinds.includes('text-too-long'), 'extreme long text flagged with fix hint');
  assert(kinds.includes('font-too-small'), 'tiny font flagged');
  assert(kinds.includes('outside-safe-area'), 'element outside safe margin flagged');
  assert(issues.every(i => i.message.includes('请')), 'every issue explains how to fix');

  const st = new Store(null);
  st.update(s => Object.assign(s, defaultState(), bnd));
  assert(preflight(st.state).length > 0, 'preflight blocks broken export');
}

// ---- 6. SVG export keeps text editable and carries params ----
section('svg export');
{
  const st = new Store(null);
  st.update(s => Object.assign(s, defaultState(), defaultTemplate()));
  const svg = buildSVG(st.state, 'data:image/png;base64,AAAA', 512);
  assert(svg.includes('<text'), 'SVG contains editable <text> (not baked screenshot)');
  assert(svg.includes('<rect'), 'SVG contains editable <rect>');
  assert(svg.includes('天然纹理'), 'text content preserved');
  assert(svg.includes('<metadata>') && svg.includes('&quot;scale&quot;:1.5'), 'params preserved in metadata');
  assert(svg.includes('data-id='), 'elements carry stable ids for re-editing');
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
