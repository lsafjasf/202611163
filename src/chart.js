import {
  SERIES_META,
  THRESHOLDS,
} from "./data.js";
import { formatOne, formatTwo } from "./analytics.js";

const FONT =
  '"Noto Sans SC", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif';

function setupCanvas(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  if (canvas.width !== Math.round(width * dpr)) {
    canvas.width = Math.round(width * dpr);
  }
  if (canvas.height !== Math.round(height * dpr)) {
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return { ctx, width, height };
}

function niceStep(range, count = 4) {
  const raw = range / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

function smoothPath(ctx, points) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const previous = points[index - 1] || current;
    const after = points[index + 2] || next;
    const control1X = current.x + (next.x - previous.x) / 6;
    const control1Y = current.y + (next.y - previous.y) / 6;
    const control2X = next.x - (after.x - current.x) / 6;
    const control2Y = next.y - (after.y - current.y) / 6;
    ctx.bezierCurveTo(
      control1X,
      control1Y,
      control2X,
      control2Y,
      next.x,
      next.y,
    );
  }
}

function timeLabel(timestamp, includeDay = false) {
  const date = new Date(timestamp);
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
  if (!includeDay) return time;
  const monthDay = new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Shanghai",
  })
    .format(date)
    .replaceAll("/", ".");
  return `${monthDay} ${time}`;
}

export class HydroChart {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.data = null;
    this.hoverPoints = [];
    this.hoveredIndex = -1;
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas.parentElement);
    this.onPointerMove = this.handlePointerMove.bind(this);
    this.onPointerLeave = this.handlePointerLeave.bind(this);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerleave", this.onPointerLeave);
  }

  setData(data) {
    this.data = data;
    this.hoveredIndex = -1;
    this.tooltip.style.display = "none";
    this.draw();
  }

  draw() {
    if (!this.data?.rows?.length) return;
    const { ctx, width, height } = setupCanvas(this.canvas);
    const rows = this.data.rows;
    const scenario = this.data.scenario;
    const previewActive = this.data.previewActive;
    const forecast = previewActive ? scenario.forecast.slice(1) : [];
    const allLevels = rows.map((row) => row.level);
    if (previewActive) {
      allLevels.push(...forecast.map((row) => row.level));
    }
    const allFlows = rows.flatMap((row) => [row.inflow, row.outflow]);
    if (previewActive) {
      allFlows.push(...forecast.flatMap((row) => [row.outflow]));
    }

    const warning = THRESHOLDS.warningLevel;
    const levelMin = Math.min(
      Math.floor(Math.min(...allLevels) * 2 - 1) / 2,
      warning - 1.2,
    );
    const levelMax = Math.max(
      Math.ceil(Math.max(...allLevels, warning + 0.2) * 2 + 1) / 2,
      warning + 0.35,
    );
    const flowMin = 0;
    const flowMax = Math.max(20, Math.ceil(Math.max(...allFlows) / 20) * 20);
    const padding = { left: 42, right: 42, top: 16, bottom: 24 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const xStart = rows[0].timestamp;
    const xEnd = previewActive ? scenario.forecast.at(-1).timestamp : rows.at(-1).timestamp;
    const xOf = (timestamp) =>
      padding.left + ((timestamp - xStart) / (xEnd - xStart || 1)) * plotWidth;
    const yFlow = (value) =>
      padding.top + plotHeight - ((value - flowMin) / (flowMax - flowMin)) * plotHeight;
    const yLevel = (value) =>
      padding.top + plotHeight - ((value - levelMin) / (levelMax - levelMin)) * plotHeight;

    this.drawBackground(ctx, {
      width,
      height,
      padding,
      plotWidth,
      plotHeight,
      flowMax,
      levelMin,
      levelMax,
      warning,
      yFlow,
      yLevel,
    });

    if (previewActive) {
      const startX = xOf(rows.at(-1).timestamp);
      const gradient = ctx.createLinearGradient(startX, 0, width - padding.right, 0);
      gradient.addColorStop(0, "rgba(28, 119, 118, 0.035)");
      gradient.addColorStop(1, "rgba(28, 119, 118, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(startX, padding.top, width - padding.right - startX, plotHeight);
      ctx.save();
      ctx.fillStyle = "#6f918c";
      ctx.font = `500 8px ${FONT}`;
      ctx.textAlign = "right";
      ctx.fillText("闸门推演 +6h", width - padding.right - 6, padding.top + 11);
      ctx.restore();
    }

    this.drawXAxis(ctx, {
      rows,
      forecast,
      xOf,
      padding,
      plotHeight,
      width,
    });
    this.drawFlowArea(ctx, rows, xOf, yFlow, padding, plotHeight);
    this.drawSeries(ctx, rows, "inflow", xOf, yFlow, SERIES_META.inflow.color);
    this.drawSeries(ctx, rows, "outflow", xOf, yFlow, SERIES_META.outflow.color);
    this.drawSeries(ctx, rows, "level", xOf, yLevel, SERIES_META.level.color);

    if (previewActive) {
      const start = rows.at(-1);
      const forecastOutflow = [
        { ...start, x: xOf(start.timestamp) },
        ...forecast.map((row) => ({ ...row, x: xOf(row.timestamp) })),
      ];
      ctx.save();
      ctx.strokeStyle = "rgba(229, 160, 68, 0.9)";
      ctx.lineWidth = 1.35;
      ctx.setLineDash([4, 4]);
      smoothPath(
        ctx,
        forecastOutflow.map((row) => ({ x: row.x, y: yFlow(row.outflow) })),
      );
      ctx.stroke();
      ctx.strokeStyle = "rgba(53, 104, 205, 0.88)";
      smoothPath(
        ctx,
        [
          { x: xOf(start.timestamp), y: yLevel(start.level) },
          ...forecast.map((row) => ({
            x: xOf(row.timestamp),
            y: yLevel(row.level),
          })),
        ],
      );
      ctx.stroke();
      ctx.restore();
    }

    this.hoverPoints = [
      ...rows.map((row) => ({
        ...row,
        x: xOf(row.timestamp),
        flowY: yFlow(row.outflow),
        levelY: yLevel(row.level),
        kind: "actual",
      })),
      ...forecast.map((row) => ({
        ...row,
        x: xOf(row.timestamp),
        flowY: yFlow(row.outflow),
        levelY: yLevel(row.level),
        kind: "forecast",
      })),
    ];
    this.drawHover(ctx, height);
  }

  drawBackground(ctx, options) {
    const {
      width,
      padding,
      plotWidth,
      plotHeight,
      flowMax,
      levelMin,
      levelMax,
      warning,
      yFlow,
      yLevel,
    } = options;
    ctx.save();

    const step = niceStep(flowMax, 4);
    const tickMax = Math.ceil(flowMax / step) * step;
    ctx.font = `400 8px ${FONT}`;
    ctx.textBaseline = "middle";
    for (let value = 0; value <= tickMax + 0.1; value += step) {
      const y = yFlow(value);
      if (y < padding.top - 1 || y > padding.top + plotHeight + 1) continue;
      ctx.strokeStyle = value === 0 ? "#dce7e5" : "#edf2f1";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(width - padding.right, y);
      ctx.stroke();
      ctx.fillStyle = "#8ca09d";
      ctx.textAlign = "right";
      ctx.fillText(String(Math.round(value)), padding.left - 7, y);
    }

    ctx.fillStyle = "#8ca09d";
    ctx.textAlign = "left";
    ctx.font = `500 7px ${FONT}`;
    ctx.fillText("m³/s", 10, padding.top - 5);
    ctx.textAlign = "right";
    ctx.fillText("水位 m", width - 7, padding.top - 5);

    const levelStep = (levelMax - levelMin) / 3;
    ctx.font = `400 8px ${FONT}`;
    for (let index = 0; index <= 3; index += 1) {
      const value = levelMin + levelStep * index;
      const y = yLevel(value);
      if (y < padding.top - 1 || y > padding.top + plotHeight + 1) continue;
      ctx.fillStyle = "#8ca09d";
      ctx.textAlign = "left";
      ctx.fillText(formatTwo(value), width - padding.right + 7, y);
    }

    const warningY = yLevel(warning);
    ctx.strokeStyle = "rgba(216, 89, 75, 0.52)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(padding.left, warningY);
    ctx.lineTo(width - padding.right, warningY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#b05b4f";
    ctx.font = `500 7px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(`警戒 ${formatTwo(warning)}m`, padding.left + 5, warningY - 5);

    const lastX = width - padding.right;
    ctx.strokeStyle = "rgba(95, 125, 121, 0.35)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(lastX, padding.top);
    ctx.lineTo(lastX, padding.top + plotHeight);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  drawXAxis(ctx, { rows, forecast, xOf, padding, plotHeight }) {
    const all = [...rows, ...forecast];
    const tickCount = Math.min(6, Math.max(3, Math.floor(rows.length / 3)));
    const tickIndexes = new Set();
    for (let index = 0; index < tickCount; index += 1) {
      tickIndexes.add(
        Math.round((index / (tickCount - 1)) * (all.length - 1)),
      );
    }
    ctx.save();
    ctx.font = `400 8px ${FONT}`;
    ctx.fillStyle = "#8ca09d";
    ctx.textBaseline = "top";
    [...tickIndexes].forEach((index) => {
      const row = all[index];
      const x = xOf(row.timestamp);
      const includeDay = index === 0 || index === all.length - 1;
      ctx.textAlign =
        index === 0 ? "left" : index === all.length - 1 ? "right" : "center";
      ctx.fillText(
        timeLabel(row.timestamp, includeDay),
        x,
        padding.top + plotHeight + 8,
      );
    });
    ctx.restore();
  }

  drawFlowArea(ctx, rows, xOf, yFlow, padding, plotHeight) {
    const points = rows.map((row) => ({
      x: xOf(row.timestamp),
      y: yFlow(row.inflow),
    }));
    if (points.length < 2) return;
    const baseline = padding.top + plotHeight;
    const gradient = ctx.createLinearGradient(0, padding.top, 0, baseline);
    gradient.addColorStop(0, "rgba(27, 139, 139, 0.13)");
    gradient.addColorStop(1, "rgba(27, 139, 139, 0.01)");
    ctx.save();
    smoothPath(ctx, points);
    ctx.lineTo(points.at(-1).x, baseline);
    ctx.lineTo(points[0].x, baseline);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();
  }

  drawSeries(ctx, rows, field, xOf, yOf, color) {
    const points = rows.map((row) => ({
      x: xOf(row.timestamp),
      y: yOf(row[field]),
    }));
    if (points.length < 2) return;
    ctx.save();
    smoothPath(ctx, points);
    ctx.strokeStyle = color;
    ctx.lineWidth = field === "level" ? 1.65 : 1.55;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
    ctx.restore();
  }

  handlePointerMove(event) {
    if (!this.hoverPoints.length) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    let nearest = 0;
    let distance = Infinity;
    this.hoverPoints.forEach((point, index) => {
      const pointDistance = Math.abs(point.x - x);
      if (pointDistance < distance) {
        nearest = index;
        distance = pointDistance;
      }
    });
    this.hoveredIndex = nearest;
    this.draw();
    const point = this.hoverPoints[nearest];
    const isForecast = point.kind === "forecast";
    const date = new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "Asia/Shanghai",
    })
      .format(new Date(point.timestamp))
      .replaceAll("/", ".");
    this.tooltip.innerHTML = `
      <strong>${date}${isForecast ? " · 推演" : ""}</strong>
      <div class="tooltip-row"><span class="tooltip-key"><i class="tooltip-dot" style="background:${SERIES_META.inflow.color}"></i>入库</span><span>${formatOne(point.inflow)}</span></div>
      <div class="tooltip-row"><span class="tooltip-key"><i class="tooltip-dot" style="background:${SERIES_META.outflow.color}"></i>出库</span><span>${formatOne(point.outflow)}</span></div>
      <div class="tooltip-row"><span class="tooltip-key"><i class="tooltip-dot" style="background:${SERIES_META.level.color}"></i>水位</span><span>${formatTwo(point.level)} m</span></div>
      <div class="tooltip-row"><span class="tooltip-key"><i class="tooltip-dot" style="background:#d8594b"></i>下游</span><span>${formatOne(point.downstream)}</span></div>
    `;
    const tooltipWidth = 134;
    const maxLeft = rect.width - tooltipWidth - 8;
    this.tooltip.style.left = `${Math.max(8, Math.min(point.x + 12, maxLeft))}px`;
    this.tooltip.style.top = `${Math.max(6, point.flowY - 40)}px`;
    this.tooltip.style.display = "block";
  }

  handlePointerLeave() {
    this.hoveredIndex = -1;
    this.tooltip.style.display = "none";
    this.draw();
  }

  drawHover(ctx, height) {
    if (this.hoveredIndex < 0 || !this.hoverPoints[this.hoveredIndex]) return;
    const point = this.hoverPoints[this.hoveredIndex];
    ctx.save();
    ctx.strokeStyle = "rgba(42, 83, 79, 0.24)";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(point.x, 14);
    ctx.lineTo(point.x, height - 24);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#fff";
    ctx.strokeStyle = SERIES_META.level.color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(point.x, point.levelY, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

export class DamRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.data = null;
    this.time = 0;
    this.lastFrame = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.draw());
    this.resizeObserver.observe(canvas.parentElement);
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  setData(data) {
    this.data = data;
  }

  frame(now) {
    const delta = Math.min(50, now - this.lastFrame);
    this.lastFrame = now;
    this.time += delta / 1000;
    this.draw();
    this.raf = requestAnimationFrame(this.frame);
  }

  draw() {
    if (!this.data?.rows?.length) return;
    const { ctx, width, height } = setupCanvas(this.canvas);
    const { scenario } = this.data;
    const last = this.data.rows.at(-1);
    const gate = scenario.gateOpening;
    const waterLevel = last.level;
    const mapLevelToY = (level) =>
      112 - ((level - 83.55) / 1.85) * 58;
    const waterY = Math.max(48, Math.min(112, mapLevelToY(waterLevel)));
    const damCenter = width * 0.57;
    const baseY = height - 18;

    ctx.save();
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#f6fbfa");
    sky.addColorStop(1, "#eef6f4");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = "rgba(83, 143, 128, 0.1)";
    ctx.beginPath();
    ctx.moveTo(0, 48);
    ctx.quadraticCurveTo(width * 0.16, 18, width * 0.33, 47);
    ctx.quadraticCurveTo(width * 0.42, 56, width * 0.5, 45);
    ctx.lineTo(width * 0.55, 73);
    ctx.lineTo(0, 88);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(74, 135, 119, 0.08)";
    ctx.beginPath();
    ctx.moveTo(width * 0.64, 47);
    ctx.quadraticCurveTo(width * 0.76, 20, width, 42);
    ctx.lineTo(width, 90);
    ctx.lineTo(width * 0.68, 72);
    ctx.closePath();
    ctx.fill();

    const reservoirGradient = ctx.createLinearGradient(
      0,
      waterY,
      0,
      baseY,
    );
    reservoirGradient.addColorStop(0, "rgba(57, 173, 176, 0.66)");
    reservoirGradient.addColorStop(1, "rgba(28, 118, 135, 0.72)");
    ctx.fillStyle = reservoirGradient;
    ctx.beginPath();
    ctx.moveTo(0, waterY);
    for (let x = 0; x <= damCenter - 15; x += 5) {
      const wave =
        Math.sin(x / 19 + this.time * 1.25) * (gate > 20 ? 1.5 : 0.9);
      ctx.lineTo(x, waterY + wave);
    }
    ctx.lineTo(damCenter - 15, baseY);
    ctx.lineTo(0, baseY);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = "rgba(164, 235, 231, 0.66)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= damCenter - 16; x += 4) {
      const y = waterY + Math.sin(x / 18 + this.time * 1.4) * 1.4;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();

    const warningY = mapLevelToY(THRESHOLDS.warningLevel);
    ctx.save();
    ctx.strokeStyle = "rgba(209, 91, 77, 0.62)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(8, warningY);
    ctx.lineTo(damCenter - 18, warningY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ad5a4d";
    ctx.font = `500 7px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(`警戒 ${formatTwo(THRESHOLDS.warningLevel)}`, 9, warningY - 4);
    ctx.restore();

    const damTop = 34;
    const damPath = new Path2D();
    damPath.moveTo(damCenter - 26, damTop);
    damPath.lineTo(damCenter + 31, damTop);
    damPath.lineTo(damCenter + 53, baseY);
    damPath.lineTo(damCenter - 52, baseY);
    damPath.closePath();
    const concrete = ctx.createLinearGradient(
      damCenter - 50,
      damTop,
      damCenter + 50,
      baseY,
    );
    concrete.addColorStop(0, "#9eb1ad");
    concrete.addColorStop(0.45, "#c6d2cf");
    concrete.addColorStop(1, "#839b97");
    ctx.fillStyle = concrete;
    ctx.fill(damPath);
    ctx.strokeStyle = "rgba(74, 100, 96, 0.32)";
    ctx.lineWidth = 1;
    ctx.stroke(damPath);

    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 0.7;
    for (let y = damTop + 12; y < baseY; y += 13) {
      ctx.beginPath();
      ctx.moveTo(damCenter - 21, y);
      ctx.lineTo(damCenter + 36, y);
      ctx.stroke();
    }
    ctx.fillStyle = "#5b7772";
    ctx.font = `500 7px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("坝顶 88.60m", damCenter + 3, damTop - 5);

    const gateHeight = 7 + gate * 0.19;
    const gateWidth = 16;
    const gateX = damCenter + 2;
    const gateBottom = baseY - 16;
    const gateTop = gateBottom - gateHeight;
    ctx.fillStyle = "#183e42";
    ctx.fillRect(gateX - gateWidth / 2, gateTop, gateWidth, gateHeight);
    ctx.fillStyle = "rgba(47, 134, 139, 0.55)";
    ctx.fillRect(gateX - gateWidth / 2 + 2, gateTop + 2, gateWidth - 4, gateHeight - 4);
    ctx.fillStyle = "#eff8f6";
    ctx.fillRect(gateX - 10, gateTop - 2, 20, 4);
    ctx.fillStyle = "#375e5b";
    ctx.font = `500 7px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText(`开度 ${formatOne(gate)}%`, gateX, gateBottom + 10);

    const downstreamGradient = ctx.createLinearGradient(0, 112, 0, baseY);
    downstreamGradient.addColorStop(0, "rgba(72, 172, 177, 0.58)");
    downstreamGradient.addColorStop(1, "rgba(35, 124, 143, 0.58)");
    ctx.fillStyle = downstreamGradient;
    ctx.beginPath();
    ctx.moveTo(damCenter + 38, 112);
    for (let x = damCenter + 38; x <= width; x += 5) {
      ctx.lineTo(
        x,
        112 + Math.sin(x / 14 + this.time * 2.2) * (1 + gate / 45),
      );
    }
    ctx.lineTo(width, baseY);
    ctx.lineTo(damCenter + 38, baseY);
    ctx.closePath();
    ctx.fill();

    const flow = Math.min(1, 0.15 + gate / 90);
    for (let index = 0; index < 7; index += 1) {
      const progress = (this.time * (0.28 + flow * 0.33) + index / 7) % 1;
      const x = damCenter + 26 + progress * (width - damCenter - 38);
      const y = 118 + Math.sin(index * 2.1 + this.time * 3) * 4;
      ctx.fillStyle = `rgba(224, 253, 250, ${0.25 + flow * 0.45})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.2 + flow * 0.8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = "#6f8c87";
    ctx.font = `400 7px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillText("库区", 10, height - 6);
    ctx.textAlign = "right";
    ctx.fillText("下游河道", width - 10, height - 6);

    ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
    ctx.fillRect(width - 91, 8, 82, 18);
    ctx.fillStyle = "#4b6d67";
    ctx.font = `500 7px ${FONT}`;
    ctx.textAlign = "right";
    ctx.fillText(`水位 ${formatTwo(waterLevel)}m`, width - 14, 20);
    ctx.restore();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
  }
}
