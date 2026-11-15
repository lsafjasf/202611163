export const SCHEMA_VERSION = 1;

export const STORAGE_KEYS = {
  current: "fieldnote.current.v1",
  templates: "fieldnote.templates.v1",
  keyframes: "fieldnote.keyframes.v1",
};

export const FONT_FAMILY_VALUES = [
  "Georgia, 'DejaVu Serif', 'Songti SC', serif",
  "'Trebuchet MS', 'DejaVu Sans', 'PingFang SC', sans-serif",
  "'DejaVu Sans Mono', 'Courier New', monospace",
  "'Palatino Linotype', 'Book Antiqua', 'STSong', serif",
  "system-ui, -apple-system, 'PingFang SC', sans-serif",
];

const DEFAULT_TEXT = `城市总在两种速度之间生长。一种是地图上的速度：道路延伸、桥梁合拢、河岸被重新命名；另一种是身体的速度，是清晨买豆浆时绕过一摊积水，是傍晚沿旧墙根走回家，是在陌生路口的短暂迟疑。排版要让这两种速度同时可见。

河流从来不只是一条蓝线。它把仓房、码头、市场和住宅缝在一起，也把一代人的口音带到另一处。我们在岸边读到的并不是风景说明书，而是一份仍在修改的草稿：涨水时字句变得拥挤，退潮后留下空白，旧桥拆去，新的倒影又覆盖上来。

于是这组文章选择在三个形状之间流动。左边的圆角框收拢细致的观察，中间的椭圆让句子逐渐变窄，像河道在转弯处失去一部分宽度；右边的直框重新给出秩序。文字不是被塞进容器，而是在容器之间寻找自己的呼吸。

真正困难的不是把每一行排满，而是知道哪里应该留下空处。一个段落被固定之后，它周围的空间会改变，后面的句子必须重算行宽与落点。被固定的是阅读的锚点，不是整个版面。其余文字绕开它，继续寻找最短而清楚的路径。

我们把孤字、越界与重叠当作可以看见的排版事故。一个落单的字会让整段的节奏变得仓促；一行越过边界，意味着内容在未被察觉时丢失；两个对象互相覆盖，则让编辑失去可靠的坐标。检查不是最后的装饰，而是编辑过程的一部分。

如果画布太小，文字不会凭空消失。系统会记录溢出的行数，指出需要扩大的区域，并阻止带缺陷的导出。增加绕排框、放大画布、缩小字号，都是明确的修复方式。好的工具应该说出问题在哪里，而不是把所有内容压进一张无法再编辑的图片。`;

function photoDataUrl() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#b9542f"/>
      <stop offset=".55" stop-color="#dcc08b"/>
      <stop offset="1" stop-color="#31433d"/>
    </linearGradient>
    <clipPath id="c"><circle cx="120" cy="120" r="112"/></clipPath>
  </defs>
  <g clip-path="url(#c)">
    <rect width="240" height="240" fill="url(#g)"/>
    <path d="M-10 164 C48 120 79 188 132 142 S208 112 258 142 L258 250 L-10 250Z" fill="#f0e5cf" opacity=".86"/>
    <path d="M-10 184 C48 142 88 206 139 164 S214 140 258 168 L258 250 L-10 250Z" fill="#21352f" opacity=".82"/>
    <circle cx="176" cy="64" r="25" fill="#f2c373" opacity=".92"/>
    <path d="M50 48h78M50 61h46" stroke="#fff8e9" stroke-width="3" opacity=".8"/>
  </g>
  <circle cx="120" cy="120" r="111" fill="none" stroke="#f8f1e4" stroke-width="2" opacity=".55"/>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function uid(prefix = "obj") {
  const random =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${random}`;
}

export function clone(value) {
  return typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

export function createDefaultDocument() {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid("doc"),
    name: "在水线与街角之间",
    caseName: "default",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    content: {
      kicker: "FIELDNOTE 026 / 城市观察",
      title: "在水线与街角之间",
      subtitle: "一份关于河流、路径与版面的田野笔记",
      footer: "INK & CURRENT · 可编辑排版研究 / 01",
      text: DEFAULT_TEXT,
    },
    canvas: {
      width: 1220,
      height: 780,
      margin: 46,
      background: "#f2ecdf",
    },
    theme: {
      ink: "#23322e",
      muted: "#6d756e",
      accent: "#b9542f",
      paper: "#fbf7ee",
      line: "#d8cfbf",
    },
    header: {
      kickerSize: 10,
      titleSize: 52,
      subtitleSize: 13,
      footerSize: 9,
    },
    font: {
      family: FONT_FAMILY_VALUES[0],
      size: 16,
      lineHeight: 1.68,
      weight: 400,
      color: "#26332f",
    },
    paragraph: {
      spacing: 9,
      indent: 1.8,
    },
    shapes: [
      {
        id: "flow-left",
        name: "左栏 · 圆角框",
        type: "rounded",
        x: 64,
        y: 210,
        w: 340,
        h: 478,
        padding: 25,
        radius: 22,
        textFlow: true,
        flowOrder: 0,
        fill: "#fbf7ee",
        stroke: "#d5cbbc",
        strokeWidth: 1,
        opacity: 1,
        locked: false,
      },
      {
        id: "flow-middle",
        name: "中栏 · 椭圆",
        type: "ellipse",
        x: 440,
        y: 212,
        w: 354,
        h: 474,
        padding: 34,
        radius: 0,
        textFlow: true,
        flowOrder: 1,
        fill: "#e9e0cf",
        stroke: "#c9bda9",
        strokeWidth: 1,
        opacity: 1,
        locked: false,
      },
      {
        id: "flow-right",
        name: "右栏 · 直框",
        type: "rect",
        x: 830,
        y: 210,
        w: 326,
        h: 478,
        padding: 25,
        radius: 0,
        textFlow: true,
        flowOrder: 2,
        fill: "#fbf7ee",
        stroke: "#d5cbbc",
        strokeWidth: 1,
        opacity: 1,
        locked: false,
      },
      {
        id: "rule-top",
        name: "页眉分隔线",
        type: "rect",
        x: 64,
        y: 184,
        w: 1092,
        h: 2,
        padding: 0,
        radius: 0,
        textFlow: false,
        flowOrder: 9,
        fill: "#b9542f",
        stroke: "#b9542f",
        strokeWidth: 0,
        opacity: 0.8,
        locked: true,
      },
      {
        id: "photo-mark",
        name: "刊头图片",
        type: "image",
        x: 1050,
        y: 48,
        w: 104,
        h: 104,
        padding: 0,
        radius: 52,
        textFlow: false,
        flowOrder: 10,
        fill: "#ffffff",
        stroke: "#d6cbbb",
        strokeWidth: 1,
        opacity: 1,
        locked: false,
        src: photoDataUrl(),
        fit: "cover",
      },
    ],
    pinned: [],
  };
}

function boundaryText() {
  const passage =
    "极小的画布迫使每一个字都参与协商。河道收窄，边框逼近安全线，标题与页脚争夺仅有的呼吸空间；如果内容继续增加，它必须被报告、被安放，而不能在导出时悄悄消失。";
  return Array.from({ length: 14 }, (_, index) => `${passage}第 ${index + 1} 次压力测试。`).join("\n\n");
}

export function createBoundaryDocument() {
  const doc = createDefaultDocument();
  doc.id = uid("doc");
  doc.name = "边界压力测试 · 极小画布";
  doc.caseName = "boundary";
  doc.content.kicker = "BOUNDARY TEST / 14× ";
  doc.content.title = "窄河道";
  doc.content.subtitle = "极小画布上的极端长文本";
  doc.content.footer = "内容不得静默丢失 · 请检查溢出与安全边距";
  doc.content.text = boundaryText();
  doc.canvas = {
    width: 520,
    height: 360,
    margin: 34,
    background: "#f2ecdf",
  };
  doc.header = {
    kickerSize: 7,
    titleSize: 30,
    subtitleSize: 8,
    footerSize: 6,
  };
  doc.font.size = 12;
  doc.font.lineHeight = 1.55;
  doc.paragraph.spacing = 5;
  doc.paragraph.indent = 1;
  doc.shapes = [
    {
      id: "flow-tiny-a",
      name: "边界框 A",
      type: "rounded",
      x: 20,
      y: 114,
      w: 214,
      h: 122,
      padding: 12,
      radius: 12,
      textFlow: true,
      flowOrder: 0,
      fill: "#fbf7ee",
      stroke: "#cbbda9",
      strokeWidth: 1,
      opacity: 1,
      locked: false,
    },
    {
      id: "flow-tiny-b",
      name: "边界框 B",
      type: "ellipse",
      x: 250,
      y: 114,
      w: 230,
      h: 122,
      padding: 18,
      radius: 0,
      textFlow: true,
      flowOrder: 1,
      fill: "#e7ddca",
      stroke: "#cbbda9",
      strokeWidth: 1,
      opacity: 1,
      locked: false,
    },
    {
      id: "boundary-image",
      name: "越界图片",
      type: "image",
      x: 474,
      y: 30,
      w: 62,
      h: 62,
      padding: 0,
      radius: 31,
      textFlow: false,
      flowOrder: 8,
      fill: "#ffffff",
      stroke: "#d6cbbb",
      strokeWidth: 1,
      opacity: 1,
      locked: false,
      src: photoDataUrl(),
      fit: "cover",
    },
  ];
  doc.pinned = [];
  return doc;
}

export function createScenario(name) {
  return name === "boundary" ? createBoundaryDocument() : createDefaultDocument();
}

function finiteNumber(value, fallback, min = -100000, max = 100000) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function cleanString(value, fallback = "", maxLength = 2000) {
  return typeof value === "string" ? value.slice(0, maxLength) : fallback;
}

function cleanColor(value, fallback) {
  return typeof value === "string" && /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(value)
    ? value
    : fallback;
}

export function sanitizeDocument(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("项目数据必须是 JSON 对象。");
  }
  const base = createDefaultDocument();
  const content = input.content && typeof input.content === "object" ? input.content : {};
  const canvas = input.canvas && typeof input.canvas === "object" ? input.canvas : {};
  const theme = input.theme && typeof input.theme === "object" ? input.theme : {};
  const header = input.header && typeof input.header === "object" ? input.header : {};
  const font = input.font && typeof input.font === "object" ? input.font : {};
  const paragraph = input.paragraph && typeof input.paragraph === "object" ? input.paragraph : {};

  const doc = {
    schemaVersion: SCHEMA_VERSION,
    id: cleanString(input.id, uid("doc"), 100),
    name: cleanString(input.name, "未命名项目", 160),
    caseName: input.caseName === "boundary" ? "boundary" : "default",
    createdAt: cleanString(input.createdAt, new Date().toISOString(), 40),
    updatedAt: new Date().toISOString(),
    content: {
      kicker: cleanString(content.kicker, base.content.kicker),
      title: cleanString(content.title, base.content.title, 400),
      subtitle: cleanString(content.subtitle, base.content.subtitle, 600),
      footer: cleanString(content.footer, base.content.footer, 600),
      text: cleanString(content.text, "", 2_000_000),
    },
    canvas: {
      width: Math.round(finiteNumber(canvas.width, base.canvas.width, 180, 8000)),
      height: Math.round(finiteNumber(canvas.height, base.canvas.height, 140, 8000)),
      margin: Math.round(finiteNumber(canvas.margin, base.canvas.margin, 0, 400)),
      background: cleanColor(canvas.background, base.canvas.background),
    },
    theme: {
      ink: cleanColor(theme.ink, base.theme.ink),
      muted: cleanColor(theme.muted, base.theme.muted),
      accent: cleanColor(theme.accent, base.theme.accent),
      paper: cleanColor(theme.paper, base.theme.paper),
      line: cleanColor(theme.line, base.theme.line),
    },
    header: {
      kickerSize: finiteNumber(header.kickerSize, base.header.kickerSize, 5, 40),
      titleSize: finiteNumber(header.titleSize, base.header.titleSize, 12, 160),
      subtitleSize: finiteNumber(header.subtitleSize, base.header.subtitleSize, 5, 60),
      footerSize: finiteNumber(header.footerSize, base.header.footerSize, 5, 30),
    },
    font: {
      family: cleanString(font.family, base.font.family, 300),
      size: finiteNumber(font.size, base.font.size, 5, 120),
      lineHeight: finiteNumber(font.lineHeight, base.font.lineHeight, 1, 3),
      weight: [400, 500, 600, 700].includes(Number(font.weight)) ? Number(font.weight) : 400,
      color: cleanColor(font.color, base.font.color),
    },
    paragraph: {
      spacing: finiteNumber(paragraph.spacing, base.paragraph.spacing, 0, 100),
      indent: finiteNumber(paragraph.indent, base.paragraph.indent, 0, 10),
    },
    shapes: [],
    pinned: [],
  };

  if (!doc.font.family.trim() || /url\s*\(|@import|<script/i.test(doc.font.family)) {
    doc.font.family = base.font.family;
  }

  const usedIds = new Set();
  const sourceShapes = Array.isArray(input.shapes) ? input.shapes : [];
  for (const source of sourceShapes) {
    if (!source || typeof source !== "object") continue;
    let id = cleanString(source.id, uid("shape"), 100);
    if (usedIds.has(id)) id = uid("shape");
    usedIds.add(id);
    const type = ["rect", "rounded", "ellipse", "image"].includes(source.type)
      ? source.type
      : "rect";
    const src = typeof source.src === "string" && /^data:image\//i.test(source.src)
      ? source.src
      : "";
    doc.shapes.push({
      id,
      name: cleanString(source.name, type === "image" ? "图片" : "绕排框", 120),
      type,
      x: finiteNumber(source.x, 40),
      y: finiteNumber(source.y, 40),
      w: finiteNumber(source.w, 240, 1),
      h: finiteNumber(source.h, 180, 1),
      padding: finiteNumber(source.padding, 18, 0, 500),
      radius: finiteNumber(source.radius, type === "rounded" ? 16 : 0, 0, 1000),
      textFlow: Boolean(source.textFlow) && type !== "image",
      flowOrder: finiteNumber(source.flowOrder, doc.shapes.length, -1000, 1000),
      fill: cleanColor(source.fill, "#fbf7ee"),
      stroke: cleanColor(source.stroke, "#d5cbbc"),
      strokeWidth: finiteNumber(source.strokeWidth, 1, 0, 50),
      opacity: finiteNumber(source.opacity, 1, 0.01, 1),
      locked: Boolean(source.locked),
      ...(type === "image" ? { src, fit: source.fit === "contain" ? "contain" : "cover" } : {}),
    });
  }

  if (doc.shapes.length === 0) {
    doc.shapes = clone(base.shapes);
  }

  const flowIds = new Set(
    doc.shapes
      .filter((shape) => shape.textFlow)
      .sort((a, b) => a.flowOrder - b.flowOrder)
      .map((shape) => shape.id),
  );
  const seenPinned = new Set();
  const sourcePinned = Array.isArray(input.pinned) ? input.pinned : [];
  for (const source of sourcePinned) {
    if (!source || !Number.isInteger(Number(source.paragraphIndex))) continue;
    const paragraphIndex = Number(source.paragraphIndex);
    if (paragraphIndex < 0 || seenPinned.has(paragraphIndex) || !flowIds.has(source.shapeId)) continue;
    seenPinned.add(paragraphIndex);
    doc.pinned.push({
      paragraphIndex,
      shapeId: source.shapeId,
      x: finiteNumber(source.x, 0),
      y: finiteNumber(source.y, 0),
      width: finiteNumber(source.width, 0, 0),
    });
  }

  return doc;
}

export function paragraphTexts(text) {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}
