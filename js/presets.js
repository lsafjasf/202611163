// 预设案例:一组默认案例 + 一组边界案例(超长文本 / 极小元素 / 贴近安全区)。
import { createState, makeText, makeImage, makeShape, PAGE, gridFor } from './model.js';

export function defaultCase() {
  const state = createState(3);
  state.name = '默认案例-三栏海报';
  const g = gridFor(3);
  const colX = (i) => PAGE.margin + i * (g.colW + PAGE.gutter);
  state.elements = [
    makeText({
      x: PAGE.margin, y: 70, w: g.contentW, h: 110,
      text: '2026 春季新品发布会', fontSize: 64, align: 'center', color: '#111827',
      keyframes: [
        { t: 0, props: { opacity: 0, y: 40 } },
        { t: 1, props: { opacity: 1, y: 70 } },
      ],
    }),
    makeText({
      x: PAGE.margin, y: 190, w: g.contentW, h: 40,
      text: '3 月 20 日 · 上海西岸艺术中心', fontSize: 26, bold: false, align: 'center', color: '#6b7280',
    }),
    makeImage({ x: colX(0), y: 280, w: g.colW, h: 320 }),
    makeImage({ x: colX(1), y: 280, w: g.colW, h: 320 }),
    makeImage({ x: colX(2), y: 280, w: g.colW, h: 320 }),
    makeText({ x: colX(0), y: 620, w: g.colW, h: 70, text: '极简设计', fontSize: 30, align: 'center' }),
    makeText({ x: colX(1), y: 620, w: g.colW, h: 70, text: '匠心工艺', fontSize: 30, align: 'center' }),
    makeText({ x: colX(2), y: 620, w: g.colW, h: 70, text: '环保材质', fontSize: 30, align: 'center' }),
    makeShape({ x: PAGE.margin, y: 740, w: g.contentW, h: 6, fill: '#4f6df5' }),
    makeText({
      x: PAGE.margin, y: 790, w: g.contentW, h: 90,
      text: '扫码预约限量席位,现场体验全系新品。', fontSize: 28, bold: false, align: 'center', color: '#374151',
    }),
    makeShape({ shape: 'ellipse', x: PAGE.w - PAGE.margin - 140, y: PAGE.h - PAGE.margin - 140, w: 140, h: 140, fill: '#f59e0b' }),
    makeText({
      x: PAGE.w - PAGE.margin - 140, y: PAGE.h - PAGE.margin - 92, w: 140, h: 40,
      text: '预约', fontSize: 30, align: 'center', color: '#ffffff',
    }),
  ];
  return state;
}

export function boundaryCase() {
  const state = createState(4);
  state.name = '边界案例-压力测试';
  const g = gridFor(4);
  state.elements = [
    makeText({
      x: PAGE.margin, y: 60, w: g.contentW, h: 80,
      text: '这是一个 deliberately 超长的标题,用来验证文字换行与裁切校验:当标题长度远远超过文本框可以容纳的范围时,系统必须明确提示如何修复,而不是静默丢弃内容。',
      fontSize: 34, align: 'left',
    }),
    makeText({ x: PAGE.margin, y: 1130, w: 200, h: 30, text: '贴边小字', fontSize: 18, bold: false }),
    makeShape({ x: PAGE.w - PAGE.margin - 20, y: 300, w: 26, h: 26, fill: '#ef4444' }),
    makeShape({ x: 120, y: 500, w: 10, h: 10, fill: '#10b981' }),
    makeImage({ x: PAGE.margin, y: 400, w: g.colW, h: 200 }),
    makeText({
      x: PAGE.margin + g.colW + PAGE.gutter, y: 400, w: g.colW * 2 + PAGE.gutter, h: 60,
      text: 'Tiny', fontSize: 12, bold: false,
    }),
  ];
  return state;
}
