import {
  DRAFT_KEY,
  FONT_OPTIONS,
  PALETTES,
  PRESETS,
  SHAPE_OPTIONS,
  STORAGE_KEY,
  buildScene,
  clamp,
  cloneState,
  createDefaultState,
  hashString,
  interpolateLight,
  makeShapePoints,
  mixColor,
  normalizeState,
  pointsToPath,
  round,
  validateScene
} from "./model.js";
import { canvasPointFromEvent, renderScene } from "./renderer.js";
import {
  buildEditableSvg,
  downloadBlob,
  projectMetadata,
  safeFilename,
  svgToPngBlob
} from "./exporter.js";

const app = document.querySelector("#app");
const toastRegion = document.querySelector("#toast-region");
const measureCanvas = document.createElement("canvas");
const measureContext = measureCanvas.getContext("2d");

let state = loadDraft() || createDefaultState();
let scene;
let validation;
let selected = null;
let showSafe = true;
let zoom = 1;
let imageElement = null;
let currentImageData = "";
let animationFrame = null;
let animationStart = performance.now();
let customFontFamily = "";
const bundledFontCache = new Map();
let saveDraftTimer = null;
let transactionStart = null;
let drag = null;

const history = {
  entries: [{ state: cloneState(state), label: "打开项目" }],
  index: 0,
  limit: 70
};

function measureText(text, size, family, weight, letterSpacing = 0) {
  measureContext.font = `${weight} ${size}px ${family}`;
  const width = measureContext.measureText(text).width;
  return width + Math.max(0, Array.from(text).length - 1) * letterSpacing;
}

function shapeIcon(shape) {
  const points = makeShapePoints(shape, 13, shape === "diamond" ? 0 : 0)
    .map((point) => ({ x: point.x + 18, y: point.y + 18 }));
  return `<svg viewBox="0 0 36 36" aria-hidden="true"><path d="${pointsToPath(points)}"/></svg>`;
}

function eyeIcon(open = true) {
  return open
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6S2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="2.7"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 16 16M9.8 6.3A10.8 10.8 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.5M6.2 7.7A17.6 17.6 0 0 0 2.5 12s3.5 6 9.5 6c1 0 1.9-.2 2.7-.4"/></svg>`;
}

function appMarkup() {
  return `
    <div class="studio-shell">
      <header class="topbar">
        <div class="brand-lockup">
          <div class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="15"/><circle cx="20" cy="20" r="5"/><path d="M20 5v10M20 25v10M5 20h10M25 20h10M9.4 9.4l7.1 7.1M23.5 23.5l7.1 7.1M30.6 9.4l-7.1 7.1M16.5 23.5l-7.1 7.1"/></svg>
          </div>
          <div>
            <div class="brand-name">AURELIA</div>
            <div class="brand-sub">彩色玻璃窗工作室</div>
          </div>
        </div>
        <div class="project-identity">
          <span class="eyebrow">PROJECT</span>
          <input id="projectName" class="project-name" aria-label="项目名称" maxlength="120" value="${escapeAttribute(state.name)}" />
          <span id="templateBadge" class="template-badge"></span>
        </div>
        <div class="history-controls" aria-label="撤销与重做">
          <button id="undoButton" class="icon-button" type="button" title="撤销 (Ctrl+Z)" aria-label="撤销">
            <svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M5 12h8.5a5.5 5.5 0 1 1 0 11H11"/></svg>
          </button>
          <button id="redoButton" class="icon-button" type="button" title="重做 (Ctrl+Shift+Z)" aria-label="重做">
            <svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5M19 12h-8.5a5.5 5.5 0 1 0 0 11H13"/></svg>
          </button>
        </div>
        <div class="top-actions">
          <button id="checkButton" class="safety-pill" type="button" title="显示或隐藏安全区参考线">
            <span class="status-dot"></span>
            <span id="safetyLabel">检查中</span>
          </button>
          <button id="libraryButton" class="button quiet" type="button">
            <svg viewBox="0 0 24 24"><path d="M3 7.5h6l2 2h10v9.5H3zM3 7.5V5h7l2 2.5"/></svg>
            <span>打开</span>
          </button>
          <button id="saveButton" class="button quiet" type="button">
            <svg viewBox="0 0 24 24"><path d="M5 4h12l2 2v14H5zM8 4v6h8V4M8 20v-6h8v6"/></svg>
            <span>保存</span>
          </button>
          <button id="exportButton" class="button primary" type="button">
            <svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5M4 19h16"/></svg>
            <span>导出</span>
          </button>
        </div>
      </header>

      <main class="workspace">
        <aside class="panel left-panel" aria-label="构图与文字">
          <section class="panel-section">
            <div class="section-heading">
              <h2>构图</h2>
              <span>COMPOSITION</span>
            </div>
            <div class="field-block">
              <div class="control-label"><span>中心图形</span><span class="hint">EDITABLE</span></div>
              <div id="shapeGrid" class="shape-grid" role="group" aria-label="中心图形">
                ${SHAPE_OPTIONS.map((option) => `
                  <button class="shape-option" type="button" data-shape="${option.id}" title="${option.label}" aria-label="${option.label}">
                    ${shapeIcon(option.id)}
                    <span>${option.label}</span>
                  </button>
                `).join("")}
              </div>
            </div>
            <div class="field-block">
              <label class="control-label" for="ringsInput"><span>环带数量</span><output id="ringsOutput">5</output></label>
              <input id="ringsInput" class="range-input" type="range" min="2" max="14" step="1" value="5" />
              <div class="range-scale"><span>2 环</span><span>14 环</span></div>
            </div>
            <div class="field-block">
              <label class="control-label" for="pieceInput"><span>色片大小</span><output id="pieceOutput">中</output></label>
              <input id="pieceInput" class="range-input" type="range" min="0.18" max="1" step="0.01" value="0.62" />
              <div class="range-scale"><span>细密</span><span>舒展</span></div>
            </div>
            <div class="field-block compact-block">
              <label class="control-label" for="borderInput"><span>铅条粗细</span><output id="borderOutput">9 px</output></label>
              <input id="borderInput" class="range-input" type="range" min="1.5" max="22" step="0.5" value="9" />
            </div>
            <div class="field-block">
              <div class="control-label"><span>玻璃色谱</span><span class="hint">9 COLORS</span></div>
              <div id="paletteList" class="palette-list"></div>
            </div>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <h2>文字</h2>
              <span>TYPOGRAPHY</span>
            </div>
            <div class="field-block">
              <label class="control-label" for="titleInput">
                <span>主标题</span>
                <span id="titleCount" class="hint">0 / 3 行</span>
              </label>
              <textarea id="titleInput" class="text-input title-input" rows="2" maxlength="800" placeholder="输入窗面铭文"></textarea>
            </div>
            <div class="field-block two-fields">
              <label class="mini-field"><span>副标题</span><input id="subtitleInput" class="text-input" maxlength="240" /></label>
              <label class="mini-field"><span>页脚</span><input id="footerInput" class="text-input" maxlength="240" /></label>
            </div>
            <div class="field-block">
              <label class="control-label" for="fontSelect"><span>字体</span><span class="hint">EMBEDDABLE</span></label>
              <div class="inline-select-row">
                <select id="fontSelect" class="select-input">
                  ${FONT_OPTIONS.map((font) => `<option value="${font.id}">${font.label}</option>`).join("")}
                  <option value="custom">自定义上传字体</option>
                </select>
                <button id="fontUploadButton" class="small-icon-button" type="button" title="上传字体" aria-label="上传字体">
                  <svg viewBox="0 0 24 24"><path d="M12 16V4M8 8l4-4 4 4M5 14v5h14v-5"/></svg>
                </button>
              </div>
              <p id="customFontNote" class="micro-note">支持 WOFF2 / WOFF / TTF / OTF，小于 2 MB。</p>
            </div>
            <div class="field-block two-fields">
              <label class="mini-field">
                <span>字号 <output id="fontSizeOutput">54</output></span>
                <input id="fontSizeInput" class="range-input" type="range" min="8" max="120" step="1" value="54" />
              </label>
              <label class="mini-field">
                <span>字距 <output id="letterSpacingOutput">0</output></span>
                <input id="letterSpacingInput" class="range-input" type="range" min="-2" max="16" step="0.5" value="0" />
              </label>
            </div>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <h2>光影</h2>
              <span>GLASS LIGHT</span>
            </div>
            <div class="image-drop" id="imageDrop">
              <div id="imageThumb" class="image-thumb"></div>
              <div class="image-copy">
                <strong id="imageName">未添加光影底片</strong>
                <span>图片将嵌入项目与导出文件</span>
              </div>
              <button id="imageUploadButton" class="small-button" type="button">选择</button>
              <button id="imageRemoveButton" class="small-icon-button danger" type="button" title="移除图片" aria-label="移除图片">
                <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>
              </button>
            </div>
            <div class="field-block two-fields">
              <label class="mini-field">
                <span>光强 <output id="lightIntensityOutput">84%</output></span>
                <input id="lightIntensityInput" class="range-input" type="range" min="0" max="1" step="0.01" value="0.84" />
              </label>
              <label class="mini-field">
                <span>暖度 <output id="lightWarmthOutput">70%</output></span>
                <input id="lightWarmthInput" class="range-input" type="range" min="0" max="1" step="0.01" value="0.7" />
              </label>
            </div>
            <div class="field-block two-fields">
              <label class="mini-field">
                <span>光位 X <output id="lightXOutput">46%</output></span>
                <input id="lightXInput" class="range-input" type="range" min="0" max="1" step="0.01" value="0.46" />
              </label>
              <label class="mini-field">
                <span>光位 Y <output id="lightYOutput">31%</output></span>
                <input id="lightYInput" class="range-input" type="range" min="0" max="1" step="0.01" value="0.31" />
              </label>
            </div>
            <div class="field-block">
              <div class="control-label"><span>光照关键帧</span><button id="recordFrameButton" class="link-button" type="button">记录当前光位</button></div>
              <div id="keyframeList" class="keyframe-list"></div>
              <button id="animateButton" class="toggle-row" type="button" aria-pressed="false">
                <span><strong>透光循环</strong><small>在三个关键帧之间插值</small></span>
                <span class="switch"><span></span></span>
              </button>
            </div>
          </section>
        </aside>

        <section class="stage" aria-label="彩色玻璃窗预览">
          <div class="stage-toolbar">
            <div class="stage-title">
              <span class="live-dot"></span>
              <span>实时画布</span>
              <span class="stage-divider"></span>
              <span id="canvasDims" class="muted">900 × 1120</span>
            </div>
            <div class="stage-tools">
              <button id="safeAreaButton" class="tool-toggle active" type="button" aria-pressed="true">
                <svg viewBox="0 0 24 24"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4" stroke-dasharray="2 2"/></svg>
                安全区
              </button>
              <span class="stage-divider"></span>
              <button id="zoomOutButton" class="icon-button small" type="button" aria-label="缩小画布">−</button>
              <button id="zoomValueButton" class="zoom-value" type="button" title="恢复到适应窗口">100%</button>
              <button id="zoomInButton" class="icon-button small" type="button" aria-label="放大画布">+</button>
            </div>
          </div>
          <div id="canvasViewport" class="canvas-viewport">
            <div id="canvasFrame" class="canvas-frame">
              <canvas id="previewCanvas" aria-label="彩色玻璃窗画布预览"></canvas>
              <div class="canvas-badge">CANVAS · 2D</div>
            </div>
          </div>
          <div class="stage-footer">
            <div id="cellCount" class="stat">— 枚色片</div>
            <div class="stage-divider"></div>
            <div id="selectionHint" class="selection-hint">拖动中心图形或文字进行定位</div>
            <div class="spacer"></div>
            <div class="stage-note">所有色片均由确定性几何实时生成</div>
          </div>
        </section>

        <aside class="panel right-panel" aria-label="检查、位置与图层">
          <section class="panel-section quality-section">
            <div class="section-heading">
              <h2>导出检查</h2>
              <span>QUALITY GATE</span>
            </div>
            <div id="qualityCard" class="quality-card">
              <div class="quality-icon"></div>
              <div>
                <strong id="qualityTitle">正在检查</strong>
                <p id="qualitySummary">安全边距、外圈与文字完整性</p>
              </div>
            </div>
            <div id="checksList" class="checks-list"></div>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <h2>位置与缩放</h2>
              <span>TRANSFORM</span>
            </div>
            <div class="selection-row">
              <span id="selectedReadout" class="selection-readout">未选择元素</span>
              <button id="resetTransformButton" class="link-button" type="button">归位</button>
            </div>
            <div class="field-block compact-block">
              <label class="control-label" for="windowScaleInput"><span>窗面缩放</span><output id="windowScaleOutput">100%</output></label>
              <input id="windowScaleInput" class="range-input" type="range" min="0.55" max="1.12" step="0.01" value="1" />
            </div>
            <div class="field-block">
              <div class="control-label"><span>中心图形偏移</span><span class="hint">DRAG TO MOVE</span></div>
              <div class="two-fields">
                <label class="mini-field"><span>X <output id="centerXOutput">0</output></span><input id="centerXInput" class="range-input" type="range" min="-300" max="300" step="1" value="0" /></label>
                <label class="mini-field"><span>Y <output id="centerYOutput">0</output></span><input id="centerYInput" class="range-input" type="range" min="-300" max="300" step="1" value="0" /></label>
              </div>
            </div>
            <div class="field-block">
              <div class="control-label"><span>文字位置</span><span class="hint">SAFE-CLAMPED</span></div>
              <div class="two-fields">
                <label class="mini-field"><span>X <output id="textXOutput">0</output></span><input id="textXInput" class="range-input" type="range" min="-500" max="500" step="1" value="0" /></label>
                <label class="mini-field"><span>Y <output id="textYOutput">0</output></span><input id="textYInput" class="range-input" type="range" min="-500" max="500" step="1" value="0" /></label>
              </div>
            </div>
            <div class="field-block compact-block">
              <div class="control-label"><span>排布节奏</span></div>
              <div id="layoutOptions" class="segmented three" role="group" aria-label="排布节奏">
                <button type="button" data-layout="balanced">均衡</button>
                <button type="button" data-layout="airy">疏朗</button>
                <button type="button" data-layout="compact">紧凑</button>
              </div>
            </div>
          </section>

          <section class="panel-section">
            <div class="section-heading">
              <h2>图层</h2>
              <span>LAYERS</span>
            </div>
            <div id="layersList" class="layers-list"></div>
          </section>

          <section class="panel-section examples-section">
            <div class="section-heading">
              <h2>案例</h2>
              <span>RECIPES</span>
            </div>
            <div id="presetList" class="preset-list"></div>
          </section>
        </aside>
      </main>
    </div>
    ${modalMarkup()}
    <input id="fontFileInput" type="file" accept=".woff2,.woff,.ttf,.otf,font/woff2,font/woff,font/ttf,font/otf" hidden />
    <input id="imageFileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden />
    <input id="projectFileInput" type="file" accept="application/json,.json,.aurelia" hidden />
  `;
}

function modalMarkup() {
  return `
    <div id="exportOverlay" class="overlay" hidden>
      <section class="modal export-modal" role="dialog" aria-modal="true" aria-labelledby="exportTitle">
        <header class="modal-header">
          <div>
            <span class="modal-kicker">RENDER &amp; EXPORT</span>
            <h2 id="exportTitle">导出彩色玻璃窗</h2>
          </div>
          <button class="modal-close" data-close-overlay="exportOverlay" type="button" aria-label="关闭导出面板">×</button>
        </header>
        <div id="exportGate" class="export-gate"></div>
        <div class="export-grid">
          <article class="export-card">
            <div class="format-mark">SVG</div>
            <div>
              <h3>可编辑矢量</h3>
              <p>色片是 path，文字是 text，图片内嵌为 image。完整项目参数写入 metadata。</p>
            </div>
            <button id="exportSvgButton" class="button primary wide" type="button">导出 SVG</button>
          </article>
          <article class="export-card">
            <div class="format-mark png">PNG</div>
            <div>
              <h3>高分辨率图像</h3>
              <p>由同一份导出 SVG 栅格化，不截取预览屏幕。PNG 内嵌 iTXt 项目参数。</p>
            </div>
            <div class="png-controls">
              <label for="pngScaleSelect">倍率</label>
              <select id="pngScaleSelect">
                <option value="1">1×</option>
                <option value="2" selected>2×</option>
                <option value="3">3×</option>
              </select>
              <button id="exportPngButton" class="button dark wide" type="button">导出 PNG</button>
            </div>
          </article>
        </div>
        <details class="export-details" open>
          <summary>导出前检查与安全边距</summary>
          <div id="exportChecks"></div>
        </details>
        <p class="modal-footnote">导出前会再次按当前文字、字体与画面尺寸进行测量；任何越界、超行或外圈缺口都会阻止导出并给出修复建议。</p>
      </section>
    </div>

    <div id="libraryOverlay" class="overlay" hidden>
      <section class="modal library-modal" role="dialog" aria-modal="true" aria-labelledby="libraryTitle">
        <header class="modal-header">
          <div>
            <span class="modal-kicker">LOCAL PROJECTS</span>
            <h2 id="libraryTitle">保存与重新载入</h2>
          </div>
          <button class="modal-close" data-close-overlay="libraryOverlay" type="button" aria-label="关闭项目面板">×</button>
        </header>
        <div class="library-actions">
          <button id="saveFromLibraryButton" class="button primary" type="button">保存当前项目</button>
          <button id="importProjectButton" class="button quiet" type="button">导入项目文件</button>
          <button id="exportProjectButton" class="button quiet" type="button">下载项目 JSON</button>
        </div>
        <div class="library-note">项目包包含模板、当前字体（含上传字体数据）、图片、光照关键帧与全部参数。</div>
        <div id="savedProjects" class="saved-projects"></div>
      </section>
    </div>
  `;
}

function escapeAttribute(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeText(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function $(selector) {
  return document.querySelector(selector);
}

function loadDraft() {
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    return draft ? normalizeState(JSON.parse(draft)) : null;
  } catch {
    return null;
  }
}

function setRangeProgress(input) {
  const minimum = Number(input.min || 0);
  const maximum = Number(input.max || 100);
  const value = Number(input.value);
  const progress = ((value - minimum) / Math.max(0.0001, maximum - minimum)) * 100;
  input.style.setProperty("--range-progress", `${clamp(progress, 0, 100)}%`);
}

function currentLight() {
  if (!state.light.animate) {
    return {
      x: state.light.x,
      y: state.light.y,
      intensity: state.light.intensity,
      warmth: state.light.warmth
    };
  }
  const progress = ((performance.now() - animationStart) % state.light.cycleMs) / state.light.cycleMs;
  return interpolateLight(state.light.keyframes, progress);
}

function rebuild() {
  state = normalizeState(state);
  scene = buildScene(state, { measureText });
  validation = validateScene(scene);
  syncInterface();
  syncImageElement();
  renderPreview();
  layoutCanvas();
}

function renderPreview() {
  if (!scene) return;
  let drawScene = scene;
  if (state.light.animate) {
    const light = currentLight();
    drawScene = {
      ...scene,
      light: { ...scene.light, ...light, color: mixColor("#d8eeff", "#ffd38a", light.warmth) }
    };
  }
  renderScene($("#previewCanvas"), drawScene, {
    imageElement,
    showSafe,
    hasErrors: !validation.ok,
    selection: selected
  });
}

function syncImageElement() {
  const data = state.image.dataUrl;
  if (data === currentImageData) return;
  currentImageData = data;
  imageElement = null;
  if (!data) {
    renderPreview();
    return;
  }
  const image = new Image();
  image.onload = () => {
    if (currentImageData === data) {
      imageElement = image;
      renderPreview();
    }
  };
  image.onerror = () => {
    showToast("光影底片无法解码", {
      type: "error",
      detail: "请重新选择 PNG、JPEG 或 WebP 图片；原参数仍保留在项目中。"
    });
  };
  image.src = data;
}

function syncInterface() {
  const values = {
    projectName: state.name,
    ringsInput: state.window.rings,
    pieceInput: state.window.pieceSize,
    borderInput: state.window.border,
    titleInput: state.typography.title,
    subtitleInput: state.typography.subtitle,
    footerInput: state.typography.footer,
    fontSelect: state.typography.fontId,
    fontSizeInput: state.typography.fontSize,
    letterSpacingInput: state.typography.letterSpacing,
    lightIntensityInput: state.light.intensity,
    lightWarmthInput: state.light.warmth,
    lightXInput: state.light.x,
    lightYInput: state.light.y,
    windowScaleInput: state.window.scale,
    centerXInput: state.ornament.offsetX,
    centerYInput: state.ornament.offsetY,
    textXInput: state.typography.offsetX,
    textYInput: state.typography.offsetY
  };
  for (const [id, value] of Object.entries(values)) {
    const control = document.getElementById(id);
    if (control && document.activeElement !== control) control.value = value;
  }
  if (state.typography.fontId === "custom" && state.typography.customFont) {
    const option = $("#fontSelect").querySelector('option[value="custom"]');
    option.disabled = false;
    option.textContent = state.typography.customFont.name || "自定义字体";
  } else {
    const option = $("#fontSelect").querySelector('option[value="custom"]');
    option.disabled = true;
    option.textContent = "自定义上传字体";
  }

  for (const input of document.querySelectorAll(".range-input")) setRangeProgress(input);
  $("#ringsOutput").textContent = String(state.window.rings);
  $("#pieceOutput").textContent = pieceSizeLabel(state.window.pieceSize);
  $("#borderOutput").textContent = `${round(state.window.border, 1)} px`;
  $("#fontSizeOutput").textContent = String(Math.round(state.typography.fontSize));
  $("#letterSpacingOutput").textContent = `${round(state.typography.letterSpacing, 1)}`;
  $("#lightIntensityOutput").textContent = `${Math.round(state.light.intensity * 100)}%`;
  $("#lightWarmthOutput").textContent = `${Math.round(state.light.warmth * 100)}%`;
  $("#lightXOutput").textContent = `${Math.round(state.light.x * 100)}%`;
  $("#lightYOutput").textContent = `${Math.round(state.light.y * 100)}%`;
  $("#windowScaleOutput").textContent = `${Math.round(state.window.scale * 100)}%`;
  $("#centerXOutput").textContent = String(Math.round(state.ornament.offsetX));
  $("#centerYOutput").textContent = String(Math.round(state.ornament.offsetY));
  $("#textXOutput").textContent = String(Math.round(state.typography.offsetX));
  $("#textYOutput").textContent = String(Math.round(state.typography.offsetY));
  $("#titleCount").textContent = `${scene.typography.titleLines.length} / ${state.typography.maxLines} 行 · ${Array.from(state.typography.title).length} 字`;
  $("#canvasDims").textContent = `${state.canvas.width} × ${state.canvas.height}`;
  $("#cellCount").textContent = `${scene.stats.totalCells} 枚色片`;
  $("#templateBadge").textContent = PRESETS.find((preset) => preset.id === state.templateId)?.tag || "自定义";
  $("#customFontNote").textContent = state.typography.customFont
    ? `已嵌入：${state.typography.customFont.name} · ${Math.round(state.typography.customFont.dataUrl.length / 1024)} KB`
    : "支持 WOFF2 / WOFF / TTF / OTF，小于 2 MB。";
  $("#imageName").textContent = state.image.dataUrl ? state.image.name || "已加载光影底片" : "未添加光影底片";
  $("#imageThumb").style.backgroundImage = state.image.dataUrl
    ? `url("${state.image.dataUrl}")`
    : "";
  $("#imageRemoveButton").disabled = !state.image.dataUrl;
  $("#selectedReadout").textContent = selectedLabel();
  $("#selectionHint").textContent = selected
    ? "拖动选中的元素，位置会被限制在安全区内"
    : "拖动中心图形或文字进行定位";

  $("#shapeGrid").querySelectorAll("[data-shape]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.shape === state.window.shape);
    button.setAttribute("aria-pressed", String(button.dataset.shape === state.window.shape));
  });
  $("#layoutOptions").querySelectorAll("[data-layout]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.layout === state.typography.layout);
  });
  $("#animateButton").setAttribute("aria-pressed", String(state.light.animate));
  $("#animateButton").classList.toggle("active", state.light.animate);
  $("#undoButton").disabled = history.index <= 0;
  $("#redoButton").disabled = history.index >= history.entries.length - 1;
  $("#safeAreaButton").classList.toggle("active", showSafe);
  $("#safeAreaButton").setAttribute("aria-pressed", String(showSafe));
  $("#zoomValueButton").textContent = `${Math.round(zoom * 100)}%`;
  renderPalette();
  renderLayers();
  renderKeyframes();
  renderPresets();
  renderQuality();
  startAnimationLoop();
}

function pieceSizeLabel(value) {
  if (value < 0.34) return "极细";
  if (value < 0.5) return "细密";
  if (value < 0.72) return "中";
  if (value < 0.9) return "舒展";
  return "大块";
}

function selectedLabel() {
  return {
    center: "中心图形",
    title: "主标题",
    subtitle: "副标题"
  }[selected] || "未选择元素";
}

function renderPalette() {
  $("#paletteList").innerHTML = Object.entries(PALETTES)
    .map(([id, palette]) => `
      <button class="palette-option ${id === state.window.palette ? "selected" : ""}" type="button" data-palette="${id}" title="${palette.name}">
        <span class="palette-swatches">${palette.swatch.slice(0, 5).map((color) => `<i style="background:${color}"></i>`).join("")}</span>
        <span>${palette.name}</span>
        <svg viewBox="0 0 24 24" class="check-icon"><path d="m5 12 4 4L19 6"/></svg>
      </button>
    `).join("");
}

const LAYER_DEFINITIONS = [
  { id: "rings", name: "玻璃色片", detail: "外圈与控制点完全闭合" },
  { id: "center", name: "中心图形", detail: "可拖动，可切换形状" },
  { id: "glow", name: "透光叠加", detail: "背光与玻璃高光" },
  { id: "title", name: "主标题", detail: "SVG text · 自动换行" },
  { id: "subtitle", name: "副标题与饰线", detail: "可编辑文字" },
  { id: "footer", name: "页脚", detail: "可编辑文字" },
  { id: "image", name: "光影底片", detail: "嵌入图片" }
];

function renderLayers() {
  $("#layersList").innerHTML = LAYER_DEFINITIONS.map((layer) => {
    const visible = state.layers[layer.id] !== false;
    return `<button class="layer-row ${visible ? "" : "hidden-layer"}" type="button" data-layer="${layer.id}" aria-pressed="${visible}">
      <span class="layer-eye">${eyeIcon(visible)}</span>
      <span class="layer-copy"><strong>${layer.name}</strong><small>${layer.detail}</small></span>
      <span class="layer-index">${layer.id === "rings" ? String(scene.stats.totalCells) : ""}</span>
    </button>`;
  }).join("");
}

function renderKeyframes() {
  $("#keyframeList").innerHTML = state.light.keyframes.map((frame, index) => `
    <button class="keyframe ${index === state.light.currentFrame ? "selected" : ""}" type="button" data-keyframe="${index}">
      <span class="keyframe-letter">${escapeText(frame.label)}</span>
      <span><strong>${Math.round(frame.intensity * 100)}%</strong><small>X ${Math.round(frame.x * 100)} · Y ${Math.round(frame.y * 100)}</small></span>
    </button>
  `).join("");
}

function renderPresets() {
  $("#presetList").innerHTML = PRESETS.map((preset) => `
    <button class="preset-card ${preset.id === state.templateId ? "selected" : ""}" type="button" data-preset="${preset.id}">
      <span class="preset-preview ${preset.id}"><i></i><i></i><i></i></span>
      <span class="preset-copy"><strong>${preset.name}</strong><small>${preset.tag}</small></span>
    </button>
  `).join("");
}

function renderQuality() {
  const errors = validation.errors;
  const warnings = validation.warnings;
  const status = errors.length ? "error" : warnings.length ? "warning" : "ok";
  const title = errors.length
    ? `${errors.length} 项导出阻断`
    : warnings.length
      ? `${warnings.length} 项提示`
      : "可安全导出";
  const summary = errors.length
    ? "展开下方检查项，按建议修复后重试"
    : warnings.length
      ? "可以导出；建议查看提示"
      : "文字、图形与安全边距均已通过";
  const safetyLabel = $("#safetyLabel");
  safetyLabel.textContent = errors.length ? "需修复" : warnings.length ? "有提示" : "安全区通过";
  $("#checkButton").dataset.status = status;
  $("#qualityCard").dataset.status = status;
  $("#qualityTitle").textContent = title;
  $("#qualitySummary").textContent = summary;
  $("#checksList").innerHTML = validation.checks
    .map((check) => `<div class="check-row ${check.ok ? "pass" : "fail"}">
      <span class="check-mark">${check.ok ? "✓" : "!"}</span>
      <span><strong>${check.label}</strong><small>${check.detail}</small></span>
    </div>`)
    .join("");
}

function refresh() {
  rebuild();
  scheduleDraftSave();
  renderPreview();
}

function stateSignature() {
  return JSON.stringify(state);
}

function beginTransaction() {
  if (!transactionStart) transactionStart = stateSignature();
}

function pushHistory(label = "编辑") {
  const signature = stateSignature();
  if (signature === JSON.stringify(history.entries[history.index].state)) return;
  history.entries = history.entries.slice(0, history.index + 1);
  history.entries.push({ state: cloneState(state), label });
  if (history.entries.length > history.limit) {
    history.entries.shift();
  }
  history.index = history.entries.length - 1;
}

function endTransaction(label = "编辑") {
  if (!transactionStart) return;
  const changed = transactionStart !== stateSignature();
  transactionStart = null;
  if (changed) {
    pushHistory(label);
    scheduleDraftSave();
    syncInterface();
  }
}

function perform(label, mutate) {
  beginTransaction();
  mutate();
  refresh();
  endTransaction(label);
}

function undo() {
  if (transactionStart) endTransaction("编辑");
  if (history.index <= 0) return;
  history.index -= 1;
  state = cloneState(history.entries[history.index].state);
  selected = null;
  refresh();
  showToast(`已撤销：${history.entries[history.index + 1]?.label || "上一步"}`, { type: "info" });
}

function redo() {
  if (history.index >= history.entries.length - 1) return;
  history.index += 1;
  state = cloneState(history.entries[history.index].state);
  selected = null;
  refresh();
  showToast(`已重做：${history.entries[history.index]?.label || "编辑"}`, { type: "info" });
}

function scheduleDraftSave() {
  clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(saveDraft, 500);
}

let draftErrorShown = false;

function saveDraft() {
  try {
    state.meta.updatedAt = new Date().toISOString();
    localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    draftErrorShown = false;
  } catch {
    if (!draftErrorShown) {
      draftErrorShown = true;
      showToast("自动草稿保存失败", {
        type: "error",
        detail: "浏览器本地空间可能已满。请删除不需要的本地项目，或缩小上传字体/图片后重试；当前画布不会被清空。"
      });
    }
  }
}

function getProjects() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(value) ? value.filter((item) => item?.state) : [];
  } catch {
    showToast("本地项目索引损坏", {
      type: "error",
      detail: "可以继续导出当前项目或下载项目 JSON；需要时清理浏览器站点数据再重新保存。"
    });
    return [];
  }
}

function writeProjects(projects) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function saveProject(options = {}) {
  const nameControl = $("#projectName");
  const projectName = nameControl.value.trim() || state.name || "未命名彩窗";
  state.name = projectName;
  state.meta.updatedAt = new Date().toISOString();
  const projects = getProjects();
  const record = {
    id: state.id || `project-${hashString(projectName)}`,
    name: projectName,
    savedAt: state.meta.updatedAt,
    templateId: state.templateId,
    state: cloneState(state)
  };
  const existingIndex = projects.findIndex((project) => project.id === record.id);
  if (existingIndex >= 0) projects.splice(existingIndex, 1, record);
  else projects.unshift(record);
  projects.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  try {
    writeProjects(projects);
    refresh();
    renderSavedProjects();
    showToast(`已保存“${projectName}”`, {
      type: "success",
      detail: options.fromLibrary ? "包含字体、图片与光照关键帧。" : "可从“打开”中重新载入。"
    });
  } catch {
    showToast("项目保存失败", {
      type: "error",
      detail: "浏览器本地空间不足。请删除不需要的旧项目，或把字体/图片压缩到更小体积；当前参数尚未丢失。"
    });
  }
}

function showToast(message, options = {}) {
  const toast = document.createElement("div");
  toast.className = `toast ${options.type || "info"}`;
  const marker = document.createElement("span");
  marker.className = "toast-marker";
  marker.textContent = options.type === "error" ? "!" : options.type === "success" ? "✓" : "i";
  const body = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = message;
  body.append(title);
  if (options.detail) {
    const detail = document.createElement("p");
    detail.textContent = options.detail;
    body.append(detail);
  }
  const close = document.createElement("button");
  close.type = "button";
  close.className = "toast-close";
  close.setAttribute("aria-label", "关闭提示");
  close.textContent = "×";
  close.addEventListener("click", () => toast.remove());
  toast.append(marker, body, close);
  toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 260);
  }, options.type === "error" ? 8500 : 4200);
}

function openOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add("modal-open");
  requestAnimationFrame(() => overlay.classList.add("open"));
  const focusable = overlay.querySelector("button:not(:disabled), input, select");
  focusable?.focus({ preventScroll: true });
}

function closeOverlay(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.classList.remove("open");
  setTimeout(() => {
    overlay.hidden = true;
    if (!document.querySelector(".overlay.open")) document.body.classList.remove("modal-open");
  }, 190);
}

function frozenExportState() {
  const exported = normalizeState(cloneState(state));
  if (state.light.animate) {
    const light = currentLight();
    exported.light.x = light.x;
    exported.light.y = light.y;
    exported.light.intensity = light.intensity;
    exported.light.warmth = light.warmth;
  }
  return normalizeState(exported);
}

function exportGateMarkup(exportValidation) {
  const errors = exportValidation.errors;
  const warnings = exportValidation.warnings;
  const status = errors.length ? "error" : warnings.length ? "warning" : "success";
  const title = errors.length
    ? "导出已暂停，当前内容不会被裁切"
    : warnings.length
      ? "检查通过，另有提示"
      : "检查通过，可以导出";
  const errorList = errors.length
    ? `<div class="gate-errors">${errors.map((error) => `
        <article class="gate-error">
          <strong>${escapeText(error.title)}</strong>
          <p>${escapeText(error.message)}</p>
          <span><b>修复：</b>${escapeText(error.fix)}</span>
        </article>
      `).join("")}</div>`
    : "";
  const warningList = !errors.length && warnings.length
    ? `<div class="gate-warnings">${warnings.map((warning) => `<p><strong>${escapeText(warning.title)}</strong>：${escapeText(warning.message)} ${escapeText(warning.fix)}</p>`).join("")}</div>`
    : "";
  return `<div class="gate-status ${status}">
    <span class="gate-symbol">${errors.length ? "!" : warnings.length ? "i" : "✓"}</span>
    <div><strong>${title}</strong><p>${errors.length ? `${errors.length} 项问题需要修复` : "SVG 与 PNG 共用同一几何与文字测量"}</p></div>
  </div>${errorList}${warningList}`;
}

function populateExportDialog() {
  const exportState = frozenExportState();
  const exportScene = buildScene(exportState, { measureText });
  const exportValidation = validateScene(exportScene);
  $("#exportGate").innerHTML = exportGateMarkup(exportValidation);
  $("#exportChecks").innerHTML = exportValidation.checks.map((check) => `
    <div class="export-check ${check.ok ? "pass" : "fail"}">
      <span>${check.ok ? "✓" : "!"}</span>
      <strong>${escapeText(check.label)}</strong>
      <small>${escapeText(check.detail)}</small>
    </div>
  `).join("");
  $("#exportSvgButton").disabled = !exportValidation.ok;
  $("#exportPngButton").disabled = !exportValidation.ok;
  return { exportState, exportScene, exportValidation };
}

async function exportSvgFile() {
  const button = $("#exportSvgButton");
  const original = button.textContent;
  try {
    button.disabled = true;
    button.textContent = "正在生成…";
    await ensureCustomFont();
    const exportState = frozenExportState();
    const fontDataUrl = await bundledFontDataUrl();
    const result = buildEditableSvg(exportState, { measureText, fontDataUrl });
    downloadBlob(
      new Blob([result.svg], { type: "image/svg+xml;charset=utf-8" }),
      safeFilename(exportState.name, "svg")
    );
    showToast("SVG 已导出", {
      type: "success",
      detail: `保留 ${result.scene.stats.totalCells} 枚可编辑色片、文字与项目参数。`
    });
    closeOverlay("exportOverlay");
  } catch (error) {
    if (error.validation) {
      $("#exportGate").innerHTML = exportGateMarkup(error.validation);
      button.disabled = true;
    } else {
      showToast("SVG 导出失败", { type: "error", detail: error.message || "请重新载入项目后重试。" });
    }
  } finally {
    button.textContent = original;
    if (!validation.ok) button.disabled = true;
    else button.disabled = false;
  }
}

async function exportPngFile() {
  const button = $("#exportPngButton");
  const original = button.textContent;
  try {
    button.disabled = true;
    button.textContent = "正在栅格化…";
    await ensureCustomFont();
    const exportState = frozenExportState();
    const fontDataUrl = await bundledFontDataUrl();
    const result = buildEditableSvg(exportState, { measureText, fontDataUrl });
    const scale = Number($("#pngScaleSelect").value) || 2;
    const png = await svgToPngBlob(result.svg, result.scene.width, result.scene.height, {
      scale,
      state: exportState
    });
    downloadBlob(png, safeFilename(exportState.name, "png"));
    showToast("PNG 已导出", {
      type: "success",
      detail: `${result.scene.width * scale} × ${result.scene.height * scale}px，由同源 SVG 栅格化并内嵌参数。`
    });
    closeOverlay("exportOverlay");
  } catch (error) {
    if (error.validation) {
      $("#exportGate").innerHTML = exportGateMarkup(error.validation);
      button.disabled = true;
    } else {
      showToast("PNG 导出失败", {
        type: "error",
        detail: `${error.message || "栅格化失败"}。请确认字体可载入，或先导出 SVG 保留可编辑版本。`
      });
    }
  } finally {
    button.textContent = original;
    if (!validation.ok) button.disabled = true;
    else button.disabled = false;
  }
}

async function ensureCustomFont() {
  const custom = state.typography.customFont;
  if (!custom || state.typography.fontId !== "custom") return;
  if (customFontFamily === custom.family && document.fonts.check(`12px "${custom.family}"`)) return;
  try {
    const face = new FontFace(custom.family, `url("${custom.dataUrl}")`);
    await face.load();
    document.fonts.add(face);
    customFontFamily = custom.family;
    await document.fonts.load(`16px "${custom.family}"`);
  } catch {
    showToast("自定义字体载入失败", {
      type: "error",
      detail: "已保留项目中的字体数据。请重新上传有效的 WOFF2/TTF 字体；当前画布使用后备衬线字体。"
    });
  }
}

async function bundledFontDataUrl() {
  if (state.typography.fontId === "custom") return null;
  const paths = {
    classic: "./assets/fonts/noto-serif-sc-400.woff2",
    display: "./assets/fonts/noto-serif-sc-400.woff2",
    humanist: "./assets/fonts/noto-sans-sc-400.woff2",
    mono: "./assets/fonts/noto-sans-sc-400.woff2"
  };
  const path = paths[state.typography.fontId] || paths.classic;
  if (bundledFontCache.has(path)) return bundledFontCache.get(path);
  try {
    const response = await fetch(path);
    if (!response.ok) throw new Error("font fetch failed");
    const dataUrl = await fileToDataUrl(await response.blob());
    bundledFontCache.set(path, dataUrl);
    return dataUrl;
  } catch {
    showToast("内置字体资源无法读取", {
      type: "error",
      detail: "SVG 将使用系统后备字体，可能与本机预览略有差异。请通过本地服务器打开应用后重试。"
    });
    return null;
  }
}

function downloadProjectFile() {
  const payload = {
    format: "aurelia-project",
    version: 1,
    savedAt: new Date().toISOString(),
    state
  };
  downloadBlob(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }),
    safeFilename(state.name, "aurelia.json")
  );
  showToast("项目 JSON 已下载", {
    type: "success",
    detail: "包含当前模板、字体、图片、关键帧与全部参数。"
  });
}

async function importProjectPayload(payload) {
  const rawState = payload?.state || payload;
  if (!rawState || typeof rawState !== "object") {
    throw new Error("项目文件缺少 state 数据");
  }
  state = normalizeState(rawState);
  if (!state.id) state.id = `project-${hashString(state.name)}`;
  selected = null;
  customFontFamily = "";
  await ensureCustomFont();
  currentImageData = "__reset__";
  refresh();
  pushHistory("导入项目");
  resetPanelScroll();
  renderSavedProjects();
  closeOverlay("libraryOverlay");
  showToast("项目已载入", {
    type: "success",
    detail: "模板、字体、图片、关键帧与参数已恢复。"
  });
}

async function loadProject(project) {
  if (!project?.state) return;
  state = normalizeState(project.state);
  selected = null;
  customFontFamily = "";
  await ensureCustomFont();
  currentImageData = "__reset__";
  refresh();
  pushHistory(`载入：${project.name}`);
  resetPanelScroll();
  renderSavedProjects();
  closeOverlay("libraryOverlay");
  showToast(`已重新载入“${project.name}”`, {
    type: "success",
    detail: "字体、图片与光照关键帧已按保存时恢复。"
  });
}

function renderSavedProjects() {
  const container = $("#savedProjects");
  if (!container) return;
  const projects = getProjects();
  if (!projects.length) {
    container.innerHTML = `<div class="empty-state">
      <span class="empty-mark">◇</span>
      <strong>还没有本地项目</strong>
      <p>点击“保存当前项目”后，模板、字体、图片和关键帧会一起写入浏览器本地存储。</p>
    </div>`;
    return;
  }
  container.innerHTML = projects.map((project) => {
    const date = project.savedAt
      ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(project.savedAt))
      : "未知时间";
    return `<article class="saved-project" data-project-id="${escapeAttribute(project.id)}">
      <div class="saved-thumb"><span></span></div>
      <div class="saved-copy">
        <strong>${escapeText(project.name || "未命名彩窗")}</strong>
        <small>${escapeText(date)} · ${project.state?.window?.rings || "—"} 环 · ${project.state?.window?.shape || "—"}</small>
      </div>
      <button class="small-button load-project" type="button" data-load-project="${escapeAttribute(project.id)}">载入</button>
      <button class="small-icon-button danger" type="button" data-delete-project="${escapeAttribute(project.id)}" aria-label="删除项目">
        <svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>
      </button>
    </article>`;
  }).join("");
}

function resetSelectedTransform() {
  perform("重置位置", () => {
    if (selected === "center") {
      state.ornament.offsetX = 0;
      state.ornament.offsetY = 0;
    } else if (selected === "title" || selected === "subtitle") {
      state.typography.offsetX = 0;
      state.typography.offsetY = 0;
    } else {
      state.ornament.offsetX = 0;
      state.ornament.offsetY = 0;
      state.typography.offsetX = 0;
      state.typography.offsetY = 0;
      state.window.scale = 1;
    }
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function handleFontFile(file) {
  if (!file) return;
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["woff2", "woff", "ttf", "otf"].includes(extension)) {
    showToast("字体格式不受支持", {
      type: "error",
      detail: "请上传 WOFF2、WOFF、TTF 或 OTF 字体；当前项目没有改动。"
    });
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showToast("字体文件过大", {
      type: "error",
      detail: "请压缩到 2 MB 以内再上传，否则无法可靠写入浏览器本地存储。"
    });
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    const family = `AureliaCustom_${hashString(`${file.name}:${file.size}:${dataUrl.slice(-160)}`)}`;
    const face = new FontFace(family, `url("${dataUrl}")`);
    await face.load();
    document.fonts.add(face);
    customFontFamily = family;
    beginTransaction();
    state.typography.fontId = "custom";
    state.typography.customFont = {
      name: file.name.replace(/\.[^.]+$/, ""),
      family,
      dataUrl
    };
    refresh();
    endTransaction("上传字体");
    showToast("字体已嵌入", {
      type: "success",
      detail: "项目保存和 SVG 导出会携带字体数据。"
    });
  } catch {
    showToast("字体无法载入", {
      type: "error",
      detail: "文件可能损坏或不是有效字体。请重新导出为 WOFF2 后重试；当前字体保持不变。"
    });
  }
}

async function handleImageFile(file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    showToast("图片格式不受支持", {
      type: "error",
      detail: "请选择 PNG、JPEG、WebP 或 GIF 图片；当前光影底片保持不变。"
    });
    return;
  }
  if (file.size > 4 * 1024 * 1024) {
    showToast("图片文件过大", {
      type: "error",
      detail: "请压缩到 4 MB 以内，或先降低像素尺寸；当前项目不会被清空。"
    });
    return;
  }
  try {
    const dataUrl = await fileToDataUrl(file);
    perform("更换光影底片", () => {
      state.image.dataUrl = dataUrl;
      state.image.name = file.name;
      state.layers.image = true;
    });
    showToast("光影底片已嵌入", {
      type: "success",
      detail: "图片会随项目保存，并内嵌到 SVG 导出中。"
    });
  } catch {
    showToast("图片无法读取", {
      type: "error",
      detail: "请重新选择图片；当前项目没有改变。"
    });
  }
}

function startAnimationLoop() {
  if (!state.light.animate) {
    if (animationFrame) cancelAnimationFrame(animationFrame);
    animationFrame = null;
    return;
  }
  if (animationFrame) return;
  animationStart = performance.now();
  const tick = () => {
    if (!state.light.animate) {
      animationFrame = null;
      return;
    }
    renderPreview();
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
}

function layoutCanvas() {
  if (!scene) return;
  const viewport = $("#canvasViewport");
  const frame = $("#canvasFrame");
  if (!viewport || !frame) return;
  const availableWidth = Math.max(180, viewport.clientWidth - 64);
  const availableHeight = Math.max(220, viewport.clientHeight - 44);
  const ratio = scene.width / scene.height;
  let width = availableWidth;
  let height = width / ratio;
  if (height > availableHeight) {
    height = availableHeight;
    width = height * ratio;
  }
  width *= zoom;
  height *= zoom;
  frame.style.width = `${Math.round(width)}px`;
  frame.style.height = `${Math.round(height)}px`;
  frame.style.aspectRatio = `${scene.width} / ${scene.height}`;
}

function resetPanelScroll() {
  document.querySelector(".left-panel")?.scrollTo({ top: 0, behavior: "instant" });
  document.querySelector(".right-panel")?.scrollTo({ top: 0, behavior: "instant" });
}

function zoomBy(amount) {
  zoom = clamp(round(zoom + amount, 2), 0.55, 2.4);
  $("#zoomValueButton").textContent = `${Math.round(zoom * 100)}%`;
  layoutCanvas();
}

function hitTest(point) {
  const inside = (box, padding = 0) =>
    point.x >= box.left - padding &&
    point.x <= box.right + padding &&
    point.y >= box.top - padding &&
    point.y <= box.bottom + padding;
  if (inside(scene.central.bounds, 6)) return "center";
  if (scene.typography.titleNodes.some((node) => inside(node.bounds, 10))) return "title";
  if (scene.typography.subtitleNode && inside(scene.typography.subtitleNode.bounds, 10)) return "subtitle";
  return null;
}

function bindLiveControl(id, label, mutate) {
  const control = document.getElementById(id);
  if (!control) return;
  control.addEventListener("focus", beginTransaction);
  control.addEventListener("pointerdown", beginTransaction);
  control.addEventListener("input", () => {
    beginTransaction();
    mutate(control);
    refresh();
  });
  control.addEventListener("change", () => endTransaction(label));
  control.addEventListener("blur", () => endTransaction(label));
}

function bindCanvasInteractions() {
  const canvas = $("#previewCanvas");
  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const point = canvasPointFromEvent(event, canvas, scene);
    const hit = hitTest(point);
    if (!hit) {
      selected = null;
      syncInterface();
      renderPreview();
      return;
    }
    event.preventDefault();
    selected = hit;
    beginTransaction();
    drag = {
      kind: hit === "center" ? "center" : "text",
      start: point,
      ornamentX: state.ornament.offsetX,
      ornamentY: state.ornament.offsetY,
      textX: state.typography.offsetX,
      textY: state.typography.offsetY,
      moved: false
    };
    canvas.setPointerCapture(event.pointerId);
    syncInterface();
    renderPreview();
  });
  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPointFromEvent(event, canvas, scene);
    if (!drag) {
      canvas.style.cursor = hitTest(point) ? "grab" : "default";
      return;
    }
    const dx = point.x - drag.start.x;
    const dy = point.y - drag.start.y;
    if (Math.abs(dx) + Math.abs(dy) < 1) return;
    drag.moved = true;
    canvas.style.cursor = "grabbing";
    if (drag.kind === "center") {
      state.ornament.offsetX = drag.ornamentX + dx;
      state.ornament.offsetY = drag.ornamentY + dy;
    } else {
      state.typography.offsetX = drag.textX + dx;
      state.typography.offsetY = drag.textY + dy;
    }
    clampSelectionToSafe(drag.kind);
    rebuild();
    scheduleDraftSave();
  });
  const finishDrag = (event) => {
    if (!drag) return;
    const label = drag.kind === "center" ? "移动中心图形" : "移动文字";
    endTransaction(label);
    drag = null;
    canvas.style.cursor = "grab";
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    syncInterface();
    renderPreview();
  };
  canvas.addEventListener("pointerup", finishDrag);
  canvas.addEventListener("pointercancel", finishDrag);
  canvas.addEventListener("pointerleave", () => {
    if (!drag) $("#previewCanvas").style.cursor = "default";
  });
}

function clampSelectionToSafe(kind) {
  state = normalizeState(state);
  const preview = buildScene(state, { measureText });
  const safe = preview.safeRect;
  const box = kind === "center" ? preview.central.bounds : preview.typography.bounds;
  if (!box) return;
  let dx = 0;
  let dy = 0;
  if (box.width <= safe.width) {
    if (box.left < safe.left) dx = safe.left - box.left;
    else if (box.right > safe.right) dx = safe.right - box.right;
  }
  if (box.height <= safe.height) {
    if (box.top < safe.top) dy = safe.top - box.top;
    else if (box.bottom > safe.bottom) dy = safe.bottom - box.bottom;
  }
  if (kind === "center") {
    state.ornament.offsetX += dx;
    state.ornament.offsetY += dy;
  } else {
    state.typography.offsetX += dx;
    state.typography.offsetY += dy;
  }
  state = normalizeState(state);
}

function nudgeSelection(dx, dy) {
  if (!selected) return;
  if (selected === "center") {
    state.ornament.offsetX += dx;
    state.ornament.offsetY += dy;
    clampSelectionToSafe("center");
  } else {
    state.typography.offsetX += dx;
    state.typography.offsetY += dy;
    clampSelectionToSafe("text");
  }
}

function bindEvents() {
  $("#undoButton").addEventListener("click", undo);
  $("#redoButton").addEventListener("click", redo);
  $("#saveButton").addEventListener("click", () => saveProject());
  $("#exportButton").addEventListener("click", async () => {
    await ensureCustomFont();
    populateExportDialog();
    openOverlay("exportOverlay");
  });
  $("#checkButton").addEventListener("click", () => {
    if (!validation.ok) {
      populateExportDialog();
      openOverlay("exportOverlay");
    } else {
      showSafe = !showSafe;
      syncInterface();
      renderPreview();
    }
  });
  $("#libraryButton").addEventListener("click", () => {
    renderSavedProjects();
    openOverlay("libraryOverlay");
  });
  $("#saveFromLibraryButton").addEventListener("click", () => saveProject({ fromLibrary: true }));
  $("#importProjectButton").addEventListener("click", () => $("#projectFileInput").click());
  $("#exportProjectButton").addEventListener("click", downloadProjectFile);
  $("#exportSvgButton").addEventListener("click", exportSvgFile);
  $("#exportPngButton").addEventListener("click", exportPngFile);
  $("#pngScaleSelect").addEventListener("change", () => {
    if (!validation.ok) return;
    populateExportDialog();
  });

  const projectName = $("#projectName");
  projectName.addEventListener("focus", beginTransaction);
  projectName.addEventListener("pointerdown", beginTransaction);
  projectName.addEventListener("input", () => {
    beginTransaction();
    state.name = projectName.value;
    scheduleDraftSave();
  });
  projectName.addEventListener("blur", () => {
    state.name = projectName.value.trim() || "未命名彩窗";
    projectName.value = state.name;
    rebuild();
    endTransaction("重命名项目");
  });

  $("#shapeGrid").addEventListener("click", (event) => {
    const button = event.target.closest("[data-shape]");
    if (!button) return;
    perform("切换中心图形", () => {
      state.window.shape = button.dataset.shape;
    });
  });
  $("#paletteList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-palette]");
    if (!button) return;
    perform("切换调色板", () => {
      state.window.palette = button.dataset.palette;
    });
  });
  $("#layoutOptions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-layout]");
    if (!button) return;
    perform("调整文字排布", () => {
      state.typography.layout = button.dataset.layout;
    });
  });

  bindLiveControl("ringsInput", "调整环带", (control) => {
    state.window.rings = Number(control.value);
  });
  bindLiveControl("pieceInput", "调整色片大小", (control) => {
    state.window.pieceSize = Number(control.value);
  });
  bindLiveControl("borderInput", "调整铅条", (control) => {
    state.window.border = Number(control.value);
  });
  bindLiveControl("titleInput", "编辑标题", (control) => {
    state.typography.title = control.value;
    state.layers.title = true;
  });
  bindLiveControl("subtitleInput", "编辑副标题", (control) => {
    state.typography.subtitle = control.value;
  });
  bindLiveControl("footerInput", "编辑页脚", (control) => {
    state.typography.footer = control.value;
  });
  bindLiveControl("fontSizeInput", "调整字号", (control) => {
    state.typography.fontSize = Number(control.value);
  });
  bindLiveControl("letterSpacingInput", "调整字距", (control) => {
    state.typography.letterSpacing = Number(control.value);
  });
  bindLiveControl("lightIntensityInput", "调整光强", (control) => {
    state.light.intensity = Number(control.value);
    state.light.animate = false;
  });
  bindLiveControl("lightWarmthInput", "调整光色", (control) => {
    state.light.warmth = Number(control.value);
    state.light.animate = false;
  });
  bindLiveControl("lightXInput", "移动光源", (control) => {
    state.light.x = Number(control.value);
    state.light.animate = false;
  });
  bindLiveControl("lightYInput", "移动光源", (control) => {
    state.light.y = Number(control.value);
    state.light.animate = false;
  });
  bindLiveControl("windowScaleInput", "缩放窗面", (control) => {
    state.window.scale = Number(control.value);
  });
  bindLiveControl("centerXInput", "移动中心图形", (control) => {
    state.ornament.offsetX = Number(control.value);
    selected = "center";
  });
  bindLiveControl("centerYInput", "移动中心图形", (control) => {
    state.ornament.offsetY = Number(control.value);
    selected = "center";
  });
  bindLiveControl("textXInput", "移动文字", (control) => {
    state.typography.offsetX = Number(control.value);
    selected = "title";
  });
  bindLiveControl("textYInput", "移动文字", (control) => {
    state.typography.offsetY = Number(control.value);
    selected = "title";
  });

  $("#fontSelect").addEventListener("change", (event) => {
    const value = event.target.value;
    if (value === "custom" && !state.typography.customFont) {
      showToast("尚未上传字体", {
        type: "error",
        detail: "请点击右侧上传按钮选择 WOFF2/TTF 字体，或继续使用内置字体。"
      });
      event.target.value = state.typography.fontId;
      return;
    }
    perform("切换字体", () => {
      state.typography.fontId = value;
    });
    if (value === "custom") ensureCustomFont().then(rebuild);
    else {
      const font = FONT_OPTIONS.find((item) => item.id === value) || FONT_OPTIONS[0];
      document.fonts.load(`500 16px ${font.family}`).then(rebuild).catch(() => {});
    }
  });
  $("#fontUploadButton").addEventListener("click", () => $("#fontFileInput").click());
  $("#fontFileInput").addEventListener("change", async (event) => {
    await handleFontFile(event.target.files?.[0]);
    event.target.value = "";
  });
  $("#imageUploadButton").addEventListener("click", () => $("#imageFileInput").click());
  $("#imageDrop").addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    $("#imageFileInput").click();
  });
  $("#imageFileInput").addEventListener("change", async (event) => {
    await handleImageFile(event.target.files?.[0]);
    event.target.value = "";
  });
  $("#imageRemoveButton").addEventListener("click", () => {
    if (!state.image.dataUrl) return;
    perform("移除光影底片", () => {
      state.image = { ...createDefaultState().image };
    });
  });

  $("#recordFrameButton").addEventListener("click", () => {
    perform("记录光照关键帧", () => {
      const index = state.light.currentFrame;
      state.light.keyframes[index] = {
        ...state.light.keyframes[index],
        x: state.light.x,
        y: state.light.y,
        intensity: state.light.intensity,
        warmth: state.light.warmth
      };
    });
    showToast("已记录当前光位", {
      type: "success",
      detail: `关键帧 ${state.light.keyframes[state.light.currentFrame].label} 已更新并纳入保存与撤销。`
    });
  });
  $("#keyframeList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-keyframe]");
    if (!button) return;
    const index = Number(button.dataset.keyframe);
    perform("切换光照关键帧", () => {
      const frame = state.light.keyframes[index];
      state.light.currentFrame = index;
      state.light.x = frame.x;
      state.light.y = frame.y;
      state.light.intensity = frame.intensity;
      state.light.warmth = frame.warmth;
      state.light.animate = false;
    });
  });
  $("#animateButton").addEventListener("click", () => {
    perform(state.light.animate ? "停止透光循环" : "播放透光循环", () => {
      state.light.animate = !state.light.animate;
    });
    if (state.light.animate) animationStart = performance.now();
    startAnimationLoop();
  });

  $("#layersList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-layer]");
    if (!button) return;
    const layer = button.dataset.layer;
    perform("切换图层可见性", () => {
      state.layers[layer] = !state.layers[layer];
    });
  });
  $("#presetList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-preset]");
    if (!button) return;
    const preset = PRESETS.find((item) => item.id === button.dataset.preset);
    if (!preset) return;
    beginTransaction();
    state = preset.create();
    selected = null;
    customFontFamily = "";
    refresh();
    endTransaction(`载入案例：${preset.name}`);
    resetPanelScroll();
    showToast(`已载入“${preset.name}”`, {
      type: "success",
      detail: preset.tag === "压力案例"
        ? "这是故意超限的案例，导出面板会给出可执行的修复建议。"
        : "可通过撤销回到载入前的画布。"
    });
  });
  $("#resetTransformButton").addEventListener("click", resetSelectedTransform);
  $("#safeAreaButton").addEventListener("click", () => {
    showSafe = !showSafe;
    syncInterface();
    renderPreview();
  });
  $("#zoomOutButton").addEventListener("click", () => zoomBy(-0.12));
  $("#zoomInButton").addEventListener("click", () => zoomBy(0.12));
  $("#zoomValueButton").addEventListener("click", () => {
    zoom = 1;
    syncInterface();
    layoutCanvas();
  });

  $("#projectFileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text());
      await importProjectPayload(payload);
    } catch (error) {
      showToast("项目文件无法载入", {
        type: "error",
        detail: `${error.message || "JSON 无效"}。请确认文件由本工作室导出，当前项目未被覆盖。`
      });
    } finally {
      event.target.value = "";
    }
  });

  $("#savedProjects").addEventListener("click", (event) => {
    const loadButton = event.target.closest("[data-load-project]");
    if (loadButton) {
      const project = getProjects().find((item) => item.id === loadButton.dataset.loadProject);
      if (project) loadProject(project);
      return;
    }
    const deleteButton = event.target.closest("[data-delete-project]");
    if (!deleteButton) return;
    const id = deleteButton.dataset.deleteProject;
    const project = getProjects().find((item) => item.id === id);
    if (!project) return;
    if (!window.confirm(`删除本地项目“${project.name}”？此操作不会影响当前画布。`)) return;
    try {
      writeProjects(getProjects().filter((item) => item.id !== id));
      renderSavedProjects();
      showToast("本地项目已删除", { type: "info" });
    } catch {
      showToast("删除失败", {
        type: "error",
        detail: "浏览器本地存储不可写，请检查站点存储权限后重试。"
      });
    }
  });

  for (const overlay of document.querySelectorAll(".overlay")) {
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeOverlay(overlay.id);
    });
    overlay.querySelectorAll("[data-close-overlay]").forEach((button) => {
      button.addEventListener("click", () => closeOverlay(button.dataset.closeOverlay));
    });
  }

  document.addEventListener("keydown", handleKeyboard);
  window.addEventListener("beforeunload", () => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
    } catch {
      // The explicit save flow reports quota failures; unload cannot show UI.
    }
  });

  bindCanvasInteractions();
  const resizeObserver = new ResizeObserver(layoutCanvas);
  resizeObserver.observe($("#canvasViewport"));
}

function handleKeyboard(event) {
  const command = event.metaKey || event.ctrlKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }
  if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    redo();
    return;
  }
  if (command && event.key.toLowerCase() === "s") {
    event.preventDefault();
    saveProject();
    return;
  }
  if (command && event.key.toLowerCase() === "o") {
    event.preventDefault();
    renderSavedProjects();
    openOverlay("libraryOverlay");
    return;
  }
  if (event.key === "Escape") {
    const open = [...document.querySelectorAll(".overlay.open")].pop();
    if (open) closeOverlay(open.id);
    return;
  }
  if (document.querySelector(".overlay.open")) return;
  const activeTag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(activeTag)) return;
  if (selected && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
    event.preventDefault();
    const step = event.shiftKey ? 10 : 2;
    beginTransaction();
    if (event.key === "ArrowLeft") nudgeSelection(-step, 0);
    if (event.key === "ArrowRight") nudgeSelection(step, 0);
    if (event.key === "ArrowUp") nudgeSelection(0, -step);
    if (event.key === "ArrowDown") nudgeSelection(0, step);
    rebuild();
    endTransaction("键盘微调位置");
  }
}

async function init() {
  app.innerHTML = appMarkup();
  bindEvents();
  await document.fonts.load('500 16px "Aurelia Serif SC"');
  await document.fonts.load('400 12px "Aurelia Sans SC"');
  await document.fonts.ready;
  await ensureCustomFont();
  rebuild();
  syncImageElement();
  layoutCanvas();
  startAnimationLoop();
}

init();
