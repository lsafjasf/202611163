export const SCHEMA_VERSION = 3;
export const BASE_WIDTH = 1280;
export const BASE_HEIGHT = 720;

export const FONT_STACKS = [
  { label: "黑体 / 内置 Noto Sans SC", value: '"Noto Sans SC Bundled", "Noto Sans SC", "Microsoft YaHei", sans-serif' },
  { label: "衬线 / Serif", value: '"Noto Serif SC", "Songti SC", "DejaVu Serif", "Noto Sans SC Bundled", serif' },
  { label: "等宽 / Mono", value: '"JetBrains Mono", "SFMono-Regular", "DejaVu Sans Mono", "Noto Sans SC Bundled", monospace' },
  { label: "人文无衬线 / Sans", value: '"Ubuntu Sans", "Helvetica Neue", "Noto Sans SC Bundled", sans-serif' }
];

export const DEFAULT_COPY = {
  kicker: "城市观察 · 第 18 期",
  headline: "城市醒来之前：\n一群人的清晨正在发生",
  caption: "记者 / 林序　摄像 / 周野　所有元素均可继续编辑"
};

export const EDGE_COPY = {
  kicker: "边界压力测试 · 320 × 180 · 请勿忽略安全区",
  headline:
    "凌晨四点十七分，最后一班夜车驶离站台，便利店的热气贴着玻璃缓慢上升；配送员在路口核对地址，清洁工把第一片落叶扫进晨光里。城市还没有完全醒来，但每一个细小的动作，都已经成为这一天不可省略的开场。",
  caption:
    "这是一段故意超长的边界案例文本，用于检查文字是否被裁切、元素是否越过安全区，以及导出失败时是否给出可执行的修复提示。"
};

export const ENTRANCE_PRESETS = {
  rise: {
    label: "上浮淡入",
    keyframes: [
      { at: 0, x: 0, y: 28, scale: 0.985, opacity: 0 },
      { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }
    ]
  },
  fade: {
    label: "柔和淡入",
    keyframes: [
      { at: 0, x: 0, y: 0, scale: 1, opacity: 0 },
      { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }
    ]
  },
  slide: {
    label: "侧滑进入",
    keyframes: [
      { at: 0, x: -48, y: 0, scale: 1, opacity: 0 },
      { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }
    ]
  },
  scale: {
    label: "缩放聚焦",
    keyframes: [
      { at: 0, x: 0, y: 0, scale: 0.9, opacity: 0 },
      { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }
    ]
  },
  none: {
    label: "无动画",
    keyframes: [
      { at: 0, x: 0, y: 0, scale: 1, opacity: 1 },
      { at: 1, x: 0, y: 0, scale: 1, opacity: 1 }
    ]
  }
};

export const TEMPLATE_META = {
  news: {
    label: "新闻",
    tagline: "快讯 · 下三分之一",
    background: { type: "linear", from: "#182a42", to: "#070d16", angle: 125 },
    safeMargin: 72
  },
  story: {
    label: "剧情",
    tagline: "独白 · 居中式卡片",
    background: { type: "linear", from: "#1c2637", to: "#080b11", angle: 160 },
    safeMargin: 72
  },
  prompt: {
    label: "提示卡",
    tagline: "说明 · 顶部信息卡",
    background: { type: "linear", from: "#e8dfd1", to: "#c7d6cb", angle: 135 },
    safeMargin: 72
  }
};

const textStyle = (overrides = {}) => ({
  fontFamily: FONT_STACKS[0].value,
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.35,
  letterSpacing: 0,
  color: "#f4f2ec",
  align: "left",
  valign: "middle",
  background: "transparent",
  borderColor: "transparent",
  borderWidth: 0,
  radius: 0,
  paddingX: 0,
  paddingY: 0,
  ...overrides
});

const shapeStyle = (overrides = {}) => ({
  fill: "#0c1725",
  stroke: "transparent",
  strokeWidth: 0,
  radius: 8,
  ...overrides
});

const textElement = (id, name, text, layout, style) => ({
  id,
  type: "text",
  name,
  text,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  entrance: {
    preset: "rise",
    duration: 680,
    delay: id === "headline" ? 90 : id === "caption" ? 210 : 0,
    easing: "easeOutCubic",
    keyframes: ENTRANCE_PRESETS.rise.keyframes.map((frame) => ({ ...frame }))
  },
  ...layout,
  style: textStyle(style)
});

const shapeElement = (id, name, shape, layout, style, delay = 0) => ({
  id,
  type: "shape",
  shape,
  name,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  entrance: {
    preset: "fade",
    duration: 520,
    delay,
    easing: "easeOutCubic",
    keyframes: ENTRANCE_PRESETS.fade.keyframes.map((frame) => ({ ...frame }))
  },
  ...layout,
  style: shapeStyle(style)
});

export const TEMPLATE_LAYOUTS = {
  news: {
    panel: {
      x: 80, y: 412, w: 1120, h: 230,
      style: shapeStyle({
        fill: "rgba(7, 13, 21, 0.92)",
        stroke: "rgba(184, 205, 228, 0.16)",
        strokeWidth: 1,
        radius: 9
      })
    },
    accent: {
      x: 104, y: 436, w: 78, h: 5,
      style: shapeStyle({ fill: "#ff5a45", radius: 2 })
    },
    kicker: {
      x: 104, y: 452, w: 760, h: 28,
      style: {
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 1.3,
        letterSpacing: 2.4,
        color: "#ff9b8e",
        valign: "middle"
      }
    },
    headline: {
      x: 102, y: 488, w: 1074, h: 132,
      style: {
        fontSize: 55,
        fontWeight: 750,
        lineHeight: 1.16,
        letterSpacing: -0.3,
        color: "#fbf7ef",
        valign: "middle"
      }
    },
    caption: {
      x: 104, y: 620, w: 1050, h: 22,
      style: {
        fontSize: 15,
        fontWeight: 500,
        lineHeight: 1.3,
        letterSpacing: 0.45,
        color: "#9dafc3",
        valign: "middle"
      }
    }
  },
  story: {
    panel: {
      x: 188, y: 212, w: 904, h: 330,
      style: shapeStyle({
        fill: "rgba(8, 14, 23, 0.84)",
        stroke: "rgba(106, 209, 205, 0.32)",
        strokeWidth: 1,
        radius: 18
      })
    },
    accent: {
      x: 612, y: 236, w: 56, h: 4,
      style: shapeStyle({ fill: "#ff5a45", radius: 2 })
    },
    kicker: {
      x: 252, y: 252, w: 776, h: 28,
      style: {
        fontSize: 15,
        fontWeight: 650,
        lineHeight: 1.4,
        letterSpacing: 3.8,
        color: "#76ddd8",
        align: "center",
        valign: "middle"
      }
    },
    headline: {
      x: 246, y: 292, w: 788, h: 150,
      style: {
        fontSize: 48,
        fontWeight: 650,
        lineHeight: 1.24,
        letterSpacing: 0.2,
        color: "#fffaf0",
        align: "center",
        valign: "middle"
      }
    },
    caption: {
      x: 282, y: 474, w: 716, h: 28,
      style: {
        fontSize: 14,
        fontWeight: 450,
        lineHeight: 1.4,
        letterSpacing: 0.8,
        color: "#91a4ba",
        align: "center",
        valign: "middle"
      }
    }
  },
  prompt: {
    panel: {
      x: 76, y: 74, w: 912, h: 278,
      style: shapeStyle({
        fill: "rgba(249, 245, 236, 0.96)",
        stroke: "rgba(63, 50, 37, 0.16)",
        strokeWidth: 1,
        radius: 14
      })
    },
    accent: {
      x: 100, y: 94, w: 48, h: 5,
      style: shapeStyle({ fill: "#d84f3f", radius: 2 })
    },
    kicker: {
      x: 160, y: 84, w: 770, h: 26,
      style: {
        fontSize: 15,
        fontWeight: 750,
        lineHeight: 1.35,
        letterSpacing: 1.8,
        color: "#c34b3d",
        valign: "middle"
      }
    },
    headline: {
      x: 98, y: 136, w: 842, h: 136,
      style: {
        fontSize: 42,
        fontWeight: 700,
        lineHeight: 1.3,
        letterSpacing: -0.15,
        color: "#27313a",
        valign: "middle"
      }
    },
    caption: {
      x: 100, y: 290, w: 830, h: 36,
      style: {
        fontSize: 15,
        fontWeight: 500,
        lineHeight: 1.5,
        letterSpacing: 0.2,
        color: "#68736f",
        valign: "middle"
      }
    }
  }
};

export function createBaseElements(copy = DEFAULT_COPY) {
  return [
    {
      ...shapeElement("panel", "背景底板", "rect", { x: 80, y: 412, w: 1120, h: 230 }, {}),
      entrance: { ...shapeElement("panel", "背景底板", "rect", {}, {}).entrance, preset: "fade", delay: 0 }
    },
    {
      ...shapeElement("accent", "强调线", "rect", { x: 104, y: 436, w: 78, h: 5 }, {}, 40)
    },
    textElement("kicker", "上标 / 栏目名", copy.kicker, { x: 104, y: 452, w: 760, h: 28 }, {}),
    textElement("headline", "主字幕", copy.headline, { x: 102, y: 488, w: 1074, h: 132 }, {
      fontSize: 55,
      fontWeight: 750,
      lineHeight: 1.16
    }),
    textElement("caption", "辅助信息", copy.caption, { x: 104, y: 620, w: 1050, h: 22 }, {
      fontSize: 15,
      color: "#9dafc3"
    })
  ];
}


