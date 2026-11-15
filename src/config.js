export const WORLD = Object.freeze({ width: 1600, height: 1000 });

export const TARGETS = Object.freeze([
  { id: "A01", x: 310, y: 646, elevation: 42 },
  { id: "B02", x: 586, y: 438, elevation: 68 },
  { id: "C03", x: 906, y: 556, elevation: 51 },
  { id: "D04", x: 1184, y: 316, elevation: 84 },
]);

export const ROUTE_EDGES = Object.freeze([
  { id: "A01-B02", pair: ["A01", "B02"], label: "岸线主路" },
  { id: "B02-C03", pair: ["B02", "C03"], label: "中部脊线" },
  { id: "C03-D04", pair: ["C03", "D04"], label: "北坡联络线" },
]);

export const RISK_ZONES = Object.freeze([
  {
    id: "R01",
    x: 758,
    y: 494,
    routeId: "B02-C03",
    label: "岸坡侵蚀",
    code: "EROSION",
  },
  {
    id: "R02",
    x: 1054,
    y: 432,
    routeId: "C03-D04",
    label: "落石带",
    code: "ROCKFALL",
  },
]);

export const ROLES = Object.freeze({
  surveyor: {
    name: "测量员",
    short: "测量",
    symbol: "◎",
    description: "在靶区内布设四个测量点，为路线提供地理锚点。",
    personalTotal: 4,
    personalLabel: "测量点",
    hint: "靠近闪烁靶区，按 F 布设测量点",
  },
  cartographer: {
    name: "制图员",
    short: "制图",
    symbol: "⌁",
    description: "连接测量点形成主路线，并在指定区段标注风险。",
    personalTotal: 5,
    personalLabel: "编排标记",
    hint: "靠近测量点按 Enter 选点，再到相邻点按 Enter 连线",
  },
});

export const SIDE_KEYS = Object.freeze({
  left: {
    up: "KeyW",
    down: "KeyS",
    left: "KeyA",
    right: "KeyD",
    action: "KeyF",
    risk: "KeyG",
    undo: "KeyZ",
    label: "WASD / F / G / Z",
  },
  right: {
    up: "ArrowUp",
    down: "ArrowDown",
    left: "ArrowLeft",
    right: "ArrowRight",
    action: "Enter",
    risk: "KeyR",
    undo: "Backspace",
    label: "方向键 / Enter / R / ⌫",
  },
});

export const SIDE_COLORS = Object.freeze({
  left: "#a9cd31",
  right: "#168a7b",
  debug: "#315d7a",
});

export const SESSION_SECONDS = 150;
export const INITIAL_SCORE = 100;
export const MOVE_SPEED = 245;
export const ACTION_RADIUS = 68;
export const RISK_RADIUS = 72;
