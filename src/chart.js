import { formatClock, formatPercent, formatSigned, formatValue, palette, SENSORS } from "./config.js";

const FONT = '"Noto Sans SC", "Avenir Next", "PingFang SC", "Microsoft YaHei", sans-serif';
const MONO = '"SFMono-Regular", "Cascadia Code", "Roboto Mono", "Noto Sans SC", monospace';

function niceNumber(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const fraction = value / 10 ** exponent;
  let nice = 10;
  if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  return nice * 10 ** exponent;
}

function niceDomain(values, targetTicks = 5) {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return { min: 0, max: 1, step: 0.2 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (max - min < 0.001) {
    min -= 1;
    max += 1;
  }
  const step = niceNumber((max - min) / targetTicks);
  return {
    min: Math.floor(min / step) * step,
    max: Math.ceil(max / step) * step,
    step,
  };
}

function symmetricDomain(maxValue, minimum = 2) {
  const value = Math.max(minimum, maxValue * 1.12);
  const step = niceNumber((value * 2) / 4);
  const boundary = Math.ceil(value / step) * step;
  return { min: -boundary, max: boundary, step };
}

function axesFor(view, width, height) {
  const left = width < 680 ? 46 : 56;
  const right = 20;
  const mainTop = 28;
  const errorBottom = height - 48;
  const errorHeight = Math.max(112, Math.round(height * 0.27));
  const errorTop = errorBottom - errorHeight;
  const mainBottom = errorTop - 48;
  const main = { left, right: width - right, top: mainTop, bottom: mainBottom };
  const error = { left, right: width - right, top: errorTop, bottom: errorBottom };

  const mainValues = [];
  const errorValues = [];
  let errorMax = 0;
  for (const sensor of view.selectedSensors) {
    for (const group of view.groups[sensor]) {
      mainValues.push(group.raw, group.calibrated);
      if (Number.isFinite(group.rawError)) errorValues.push(group.rawError);
      if (Number.isFinite(group.calibratedError)) errorValues.push(group.calibratedError);
    }
    for (const anchor of view.anchors[sensor] ?? []) {
      errorMax = Math.max(errorMax, Math.abs(anchor.targetError));
    }
  }
  for (const slot of view.slots) {
    if (Number.isFinite(slot.reference)) mainValues.push(slot.reference);
  }
  errorValues.forEach((value) => { errorMax = Math.max(errorMax, Math.abs(value)); });

  const yMain = niceDomain(mainValues);
  const yError = symmetricDomain(errorMax);
  const span = Math.max(1, view.endSlot - view.startSlot);
  const x = (slot) => main.left + ((slot - view.startSlot) / span) * (main.right - main.left);
  const xToSlot = (pixel) => view.startSlot + ((pixel - main.left) / (main.right - main.left)) * span;
  const yMainPx = (value) => main.bottom - ((value - yMain.min) / (yMain.max - yMain.min)) * (main.bottom - main.top);
  const yErrorPx = (value) => error.bottom - ((value - yError.min) / (yError.max - yError.min)) * (error.bottom - error.top);
  const errPxToValue = (pixel) => yError.min + ((error.bottom - pixel) / (error.bottom - error.top)) * (yError.max - yError.min);

  return { width, height, main, error, x, xToSlot, yMainPx, yErrorPx, errPxToValue, yMain, yError };
}

function drawGrid(ctx, geometry, view) {
  const { main, error, yMain, yError, x } = geometry;
  ctx.save();
  ctx.strokeStyle = palette.grid;
  ctx.fillStyle = palette.muted;
  ctx.lineWidth = 1;
  ctx.font = `10px ${MONO}`;
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";

  for (let value = yMain.min; value <= yMain.max + yMain.step / 2; value += yMain.step) {
    const y = Math.round(geometry.yMainPx(value)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(main.left, y);
    ctx.lineTo(main.right, y);
    ctx.stroke();
    ctx.fillText(value.toFixed(yMain.step < 1 ? 1 : 0), main.left - 9, y);
  }

  for (let value = yError.min; value <= yError.max + yError.step / 2; value += yError.step) {
    const y = Math.round(geometry.yErrorPx(value)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(error.left, y);
    ctx.lineTo(error.right, y);
    ctx.stroke();
    if (Math.abs(value) > 0.00001) {
      ctx.fillText(value.toFixed(1), error.left - 9, y);
    }
  }

  const tickCount = view.width > 0 ? 5 : 5;
  const tickStep = Math.max(1, Math.ceil((view.endSlot - view.startSlot) / (tickCount - 1)));
  const slots = [];
  for (let slot = view.startSlot; slot <= view.endSlot; slot += tickStep) slots.push(slot);
  if (slots.at(-1) !== view.endSlot) slots.push(view.endSlot);

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const slot of slots) {
    const pixel = Math.round(x(slot)) + 0.5;
    ctx.strokeStyle = "rgba(208, 215, 207, .58)";
    ctx.beginPath();
    ctx.moveTo(pixel, main.top);
    ctx.lineTo(pixel, main.bottom);
    ctx.moveTo(pixel, error.top);
    ctx.lineTo(pixel, error.bottom);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.fillText(formatClock(slot * view.intervalSeconds, false), pixel, error.bottom + 11);
  }

  ctx.strokeStyle = "rgba(63, 78, 72, .66)";
  ctx.beginPath();
  ctx.moveTo(error.left, Math.round(geometry.yErrorPx(0)) + 0.5);
  ctx.lineTo(error.right, Math.round(geometry.yErrorPx(0)) + 0.5);
  ctx.stroke();
  ctx.restore();
}

function drawAxisCaptions(ctx, geometry, view) {
  const { main, error } = geometry;
  ctx.save();
  ctx.font = `600 10px ${FONT}`;
  ctx.fillStyle = palette.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("温度 °C", main.left, main.top - 10);
  ctx.fillText("误差 °C · 拖动菱形校准点", error.left, error.top - 13);
  ctx.fillStyle = "rgba(114, 128, 122, .75)";
  ctx.font = `9px ${FONT}`;
  ctx.textAlign = "right";
  ctx.fillText(`${view.startSlot}–${view.endSlot} / ${view.endSlot - view.startSlot + 1} 时槽`, error.right, error.top - 13);
  ctx.restore();
}

function segmentsFor(series, field, geometry) {
  const segments = [];
  let current = [];
  let previousSlot = null;
  for (const group of series) {
    if (!Number.isFinite(group[field])) continue;
    if (previousSlot !== null && group.slot - previousSlot > 1.1 && current.length) {
      segments.push(current);
      current = [];
    }
    current.push([geometry.x(group.slot), geometry.yMainPx(group[field])]);
    previousSlot = group.slot;
  }
  if (current.length) segments.push(current);
  return segments;
}

function strokeSegments(ctx, segments) {
  for (const segment of segments) {
    if (!segment.length) continue;
    ctx.beginPath();
    ctx.moveTo(segment[0][0], segment[0][1]);
    for (let index = 1; index < segment.length; index += 1) {
      ctx.lineTo(segment[index][0], segment[index][1]);
    }
    ctx.stroke();
  }
}

function drawReference(ctx, view, geometry) {
  ctx.save();
  ctx.strokeStyle = palette.reference;
  ctx.globalAlpha = 0.78;
  ctx.lineWidth = 1.7;
  ctx.setLineDash([5, 4]);
  const points = view.slots
    .filter((slot) => Number.isFinite(slot.reference))
    .map((slot) => [geometry.x(slot.slot), geometry.yMainPx(slot.reference)]);
  strokeSegments(ctx, points.length ? [points] : []);
  ctx.restore();
}

function drawBand(ctx, view, geometry, field, area, color, alpha) {
  const bands = [];
  let current = [];
  for (const slot of view.slots) {
    const values = view.selectedSensors
      .map((sensor) => view.groups[sensor].find((group) => group.slot === slot.slot))
      .filter((group) => group && Number.isFinite(group[field]))
      .map((group) => area === "main" ? geometry.yMainPx(group[field]) : geometry.yErrorPx(group[field]));
    if (values.length < 2) {
      if (current.length) bands.push(current);
      current = [];
      continue;
    }
    current.push({
      x: geometry.x(slot.slot),
      upper: Math.min(...values),
      lower: Math.max(...values),
    });
  }
  if (current.length) bands.push(current);

  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (const band of bands) {
    ctx.beginPath();
    ctx.moveTo(band[0].x, band[0].upper);
    for (let index = 1; index < band.length; index += 1) ctx.lineTo(band[index].x, band[index].upper);
    for (let index = band.length - 1; index >= 0; index -= 1) ctx.lineTo(band[index].x, band[index].lower);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawSensorCurves(ctx, view, geometry) {
  for (const sensor of SENSORS.filter((item) => view.selectedSensors.includes(item.id))) {
    const series = view.groups[sensor.id];
    ctx.save();
    ctx.strokeStyle = sensor.color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = 0.34;
    ctx.setLineDash([3, 4]);
    strokeSegments(ctx, segmentsFor(series, "raw", geometry));
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = sensor.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokeSegments(ctx, segmentsFor(series, "calibrated", geometry));
    ctx.restore();
  }
}

function drawErrorCurves(ctx, view, geometry) {
  for (const sensor of SENSORS.filter((item) => view.selectedSensors.includes(item.id))) {
    const series = view.groups[sensor.id];
    ctx.save();
    ctx.strokeStyle = sensor.color;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.23;
    ctx.setLineDash([3, 4]);
    strokeSegments(ctx, series.filter((group) => Number.isFinite(group.rawError)).length
      ? [series
        .filter((group) => Number.isFinite(group.rawError))
        .map((group) => [geometry.x(group.slot), geometry.yErrorPx(group.rawError)])]
      : []);
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = sensor.color;
    ctx.lineWidth = 1.7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    strokeSegments(ctx, [series
      .filter((group) => Number.isFinite(group.calibratedError))
      .map((group) => [geometry.x(group.slot), geometry.yErrorPx(group.calibratedError)])]);
    ctx.restore();
  }
}

function drawAnchors(ctx, view, geometry, selectedAnchorId) {
  const sensor = view.activeSensor;
  const meta = SENSORS.find((item) => item.id === sensor);
  if (!meta) return [];
  const points = [];
  const anchors = view.anchors[sensor] ?? [];

  ctx.save();
  ctx.strokeStyle = meta.color;
  ctx.fillStyle = meta.color;
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 4]);
  ctx.globalAlpha = 0.72;

  for (const [index, anchor] of anchors.entries()) {
    if (anchor.slot < view.startSlot || anchor.slot > view.endSlot) continue;
    const x = geometry.x(anchor.slot);
    const y = geometry.yErrorPx(anchor.targetError);
    points.push({ index, x, y, anchor, id: anchor.id });
    ctx.beginPath();
    ctx.moveTo(x, geometry.main.top);
    ctx.lineTo(x, geometry.error.bottom);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  for (const point of points) {
    const active = point.id === selectedAnchorId;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(point.x, point.y - (active ? 7 : 6));
    ctx.lineTo(point.x + (active ? 7 : 6), point.y);
    ctx.lineTo(point.x, point.y + (active ? 7 : 6));
    ctx.lineTo(point.x - (active ? 7 : 6), point.y);
    ctx.closePath();
    ctx.fillStyle = "#fffdf8";
    ctx.fill();
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = active ? 2.4 : 1.7;
    ctx.stroke();
    if (active) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, 2.2, 0, Math.PI * 2);
      ctx.fillStyle = meta.color;
      ctx.fill();
    }
  }

  const first = points.find((point) => point.id === selectedAnchorId);
  if (first) {
    const label = `目标残差 ${formatSigned(first.anchor.targetError)}`;
    ctx.font = `600 10px ${FONT}`;
    const textWidth = ctx.measureText(label).width;
    const labelX = Math.min(geometry.error.right - textWidth - 14, Math.max(geometry.error.left + 4, first.x + 11));
    const labelY = Math.max(geometry.error.top + 4, first.y - 29);
    ctx.fillStyle = "rgba(255, 253, 248, .95)";
    ctx.strokeStyle = "rgba(33, 48, 44, .12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(labelX - 5, labelY - 3, textWidth + 10, 18, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = meta.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(label, labelX, labelY + 6);
  }
  ctx.restore();
  return points;
}

function drawHover(ctx, view, geometry, hoverSlot) {
  if (!Number.isFinite(hoverSlot)) return;
  const slot = Math.max(view.startSlot, Math.min(view.endSlot, hoverSlot));
  const x = geometry.x(slot);
  ctx.save();
  ctx.strokeStyle = "rgba(33, 48, 44, .35)";
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x, geometry.main.top);
  ctx.lineTo(x, geometry.error.bottom);
  ctx.stroke();
  ctx.setLineDash([]);

  const rows = [];
  for (const sensor of view.selectedSensors) {
    const group = view.groups[sensor].find((item) => item.slot === slot);
    if (!group) continue;
    const meta = SENSORS.find((item) => item.id === sensor);
    const y = geometry.yMainPx(group.calibrated);
    ctx.beginPath();
    ctx.arc(x, y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = meta.color;
    ctx.fill();
    ctx.strokeStyle = "#fffdf8";
    ctx.lineWidth = 1.2;
    ctx.stroke();
    rows.push({ sensor, group, meta });
  }

  if (!rows.length) {
    ctx.restore();
    return;
  }
  const reference = view.slots.find((item) => item.slot === slot)?.reference;
  const width = 192;
  const height = 30 + rows.length * 27;
  const boxX = Math.min(geometry.main.right - width - 4, Math.max(geometry.main.left + 4, x + 13));
  const boxY = geometry.main.top + 8;
  ctx.fillStyle = "rgba(28, 42, 38, .95)";
  ctx.beginPath();
  ctx.roundRect(boxX, boxY, width, height, 7);
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `600 10px ${MONO}`;
  ctx.fillStyle = "rgba(255,255,255,.62)";
  ctx.fillText(formatClock(slot * view.intervalSeconds), boxX + 11, boxY + 15);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.fillText(`参考 ${formatValue(reference)}`, boxX + width - 11, boxY + 15);
  rows.forEach((row, index) => {
    const y = boxY + 38 + index * 27;
    ctx.fillStyle = row.meta.color;
    ctx.beginPath();
    ctx.arc(boxX + 15, y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `500 10px ${FONT}`;
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,.76)";
    ctx.fillText(`${row.meta.short} 原始 ${formatValue(row.group.raw)}`, boxX + 24, y);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fffdf8";
    ctx.font = `600 10px ${MONO}`;
    ctx.fillText(`${formatValue(row.group.calibrated)}`, boxX + width - 11, y);
  });
  ctx.restore();
}

export function renderChart(canvas, view, options = {}) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(320, Math.round(rect.width));
  const height = Math.max(380, Math.round(rect.height));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.paper;
  ctx.fillRect(0, 0, width, height);

  const geometry = axesFor(view, width, height);
  drawGrid(ctx, geometry, view);
  drawAxisCaptions(ctx, geometry, view);

  ctx.save();
  ctx.beginPath();
  ctx.rect(geometry.main.left, geometry.main.top - 2, geometry.main.right - geometry.main.left, geometry.main.bottom - geometry.main.top + 4);
  ctx.clip();
  drawBand(ctx, view, geometry, "calibrated", "main", "#167f86", 0.075);
  drawReference(ctx, view, geometry);
  drawSensorCurves(ctx, view, geometry);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(geometry.error.left, geometry.error.top - 2, geometry.error.right - geometry.error.left, geometry.error.bottom - geometry.error.top + 4);
  ctx.clip();
  drawBand(ctx, view, geometry, "calibratedError", "error", "#167f86", 0.12);
  drawErrorCurves(ctx, view, geometry);
  ctx.restore();

  const anchors = drawAnchors(ctx, view, geometry, options.selectedAnchorId ?? null);
  drawHover(ctx, view, geometry, options.hoverSlot);

  if (!view.rows.length) {
    ctx.fillStyle = "rgba(251, 250, 246, .82)";
    ctx.fillRect(geometry.main.left, geometry.main.top, geometry.main.right - geometry.main.left, geometry.error.bottom - geometry.main.top);
    ctx.fillStyle = palette.muted;
    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = "center";
    ctx.fillText("当前条件下没有可绘制的有效样本", (geometry.main.left + geometry.main.right) / 2, (geometry.main.top + geometry.main.bottom) / 2);
  }

  return { ...geometry, anchors };
}

function comparisonDomain(view) {
  const values = [];
  for (const sensor of view.selectedSensors) {
    for (const group of view.groups[sensor]) {
      if (Number.isFinite(group.rawError)) values.push(group.rawError);
      if (Number.isFinite(group.calibratedError)) values.push(group.calibratedError);
    }
  }
  return symmetricDomain(values.length ? Math.max(...values.map(Math.abs)) : 2, 2.2);
}

function roundedRect(ctx, x, y, width, height, radius, fill, stroke) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawExportPanel(ctx, view, options) {
  const { x, y, width, height, title, subtitle, field, domain } = options;
  const plot = { left: x + 72, right: x + width - 25, top: y + 65, bottom: y + height - 42 };
  const px = (slot) => plot.left + ((slot - view.startSlot) / Math.max(1, view.endSlot - view.startSlot)) * (plot.right - plot.left);
  const py = (value) => plot.bottom - ((value - domain.min) / (domain.max - domain.min)) * (plot.bottom - plot.top);

  roundedRect(ctx, x, y, width, height, 12, "#fffdf8", "rgba(33,48,44,.12)");
  ctx.fillStyle = palette.ink;
  ctx.font = `700 17px ${FONT}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(title, x + 24, y + 31);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 11px ${FONT}`;
  ctx.fillText(subtitle, x + 24, y + 50);

  ctx.font = `500 10px ${FONT}`;
  ctx.textAlign = "right";
  const legendY = y + 34;
  let legendX = x + width - 24;
  for (const sensor of [...SENSORS].reverse()) {
    const meta = sensor;
    ctx.fillStyle = meta.color;
    ctx.fillRect(legendX - 18, legendY - 1, 12, 2);
    ctx.fillStyle = palette.muted;
    ctx.fillText(meta.short, legendX - 23, legendY + 4);
    legendX -= 45;
  }

  ctx.strokeStyle = "#e1e6df";
  ctx.lineWidth = 1;
  for (let value = domain.min; value <= domain.max + domain.step / 2; value += domain.step) {
    const lineY = Math.round(py(value)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(plot.left, lineY);
    ctx.lineTo(plot.right, lineY);
    ctx.stroke();
    ctx.fillStyle = palette.muted;
    ctx.font = `10px ${MONO}`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(value.toFixed(1), plot.left - 13, lineY);
  }
  ctx.strokeStyle = "rgba(33, 48, 44, .46)";
  ctx.beginPath();
  ctx.moveTo(plot.left, Math.round(py(0)) + 0.5);
  ctx.lineTo(plot.right, Math.round(py(0)) + 0.5);
  ctx.stroke();

  const tickCount = 6;
  for (let index = 0; index < tickCount; index += 1) {
    const ratio = index / (tickCount - 1);
    const slot = view.startSlot + ratio * (view.endSlot - view.startSlot);
    ctx.fillStyle = palette.muted;
    ctx.font = `9px ${MONO}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatClock(Math.round(slot * view.intervalSeconds), false), px(slot), plot.bottom + 13);
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.clip();

  const bands = [];
  let current = [];
  for (const slot of view.slots) {
    const values = view.selectedSensors
      .map((sensor) => view.groups[sensor].find((group) => group.slot === slot.slot))
      .filter((group) => group && Number.isFinite(group[field]))
      .map((group) => py(group[field]));
    if (values.length < 2) {
      if (current.length) bands.push(current);
      current = [];
    } else {
      current.push({ x: px(slot.slot), upper: Math.min(...values), lower: Math.max(...values) });
    }
  }
  if (current.length) bands.push(current);
  ctx.fillStyle = "rgba(22, 127, 134, .12)";
  for (const band of bands) {
    ctx.beginPath();
    ctx.moveTo(band[0].x, band[0].upper);
    for (let index = 1; index < band.length; index += 1) ctx.lineTo(band[index].x, band[index].upper);
    for (let index = band.length - 1; index >= 0; index -= 1) ctx.lineTo(band[index].x, band[index].lower);
    ctx.closePath();
    ctx.fill();
  }

  for (const sensor of SENSORS.filter((item) => view.selectedSensors.includes(item.id))) {
    const groups = view.groups[sensor.id].filter((group) => Number.isFinite(group[field]));
    const segments = [];
    let segment = [];
    let previousSlot = null;
    for (const group of groups) {
      if (previousSlot !== null && group.slot - previousSlot > 1.1 && segment.length) {
        segments.push(segment);
        segment = [];
      }
      segment.push([px(group.slot), py(group[field])]);
      previousSlot = group.slot;
    }
    if (segment.length) segments.push(segment);
    ctx.strokeStyle = sensor.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const points of segments) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index][0], points[index][1]);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(33,48,44,.12)";
  ctx.strokeRect(plot.left + 0.5, plot.top + 0.5, plot.right - plot.left, plot.bottom - plot.top);
}

function drawComparisonStats(ctx, view) {
  const cards = [
    { label: "原始 MAE", value: formatValue(view.stats.rawMae, 3), unit: "°C", accent: "#b7c0bb" },
    { label: "校准后 MAE", value: formatValue(view.stats.calibratedMae, 3), unit: "°C", accent: "#55b7b6" },
    { label: "最大偏差", value: formatValue(view.stats.calibratedMax, 3), unit: "°C", accent: "#e2b45c" },
    { label: "MAE 改善", value: formatPercent(view.stats.improvement), unit: "", accent: "#91c7a8" },
  ];
  cards.forEach((card, index) => {
    const x = 60 + index * 370;
    roundedRect(ctx, x, 196, 354, 122, 10, "rgba(255,253,248,.97)", "rgba(33,48,44,.1)");
    ctx.fillStyle = card.accent;
    ctx.fillRect(x, 196, 4, 122);
    ctx.fillStyle = palette.muted;
    ctx.font = `600 11px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(card.label, x + 22, 222);
    ctx.fillStyle = palette.ink;
    ctx.font = `700 34px ${MONO}`;
    ctx.fillText(card.value, x + 22, 269);
    if (card.unit) {
      ctx.fillStyle = palette.muted;
      ctx.font = `500 12px ${FONT}`;
      const valueWidth = ctx.measureText(card.value).width;
      ctx.fillText(card.unit, x + 28 + Math.max(118, valueWidth * 1.3), 267);
    }
  });
}

export function renderComparisonCanvas(view) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1180;
  const ctx = canvas.getContext("2d");
  const domain = comparisonDomain(view);

  ctx.fillStyle = "#f3f0e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#17322d";
  ctx.fillRect(0, 0, canvas.width, 170);

  ctx.fillStyle = "#e9b85f";
  ctx.fillRect(60, 38, 34, 3);
  ctx.fillRect(60, 47, 25, 3);
  ctx.fillRect(60, 56, 16, 3);
  ctx.fillStyle = "rgba(255,255,255,.58)";
  ctx.font = `700 11px ${MONO}`;
  ctx.textAlign = "left";
  ctx.fillText("TRIDENT / CALIBRATION REPORT", 108, 53);
  ctx.fillStyle = "#fffdf8";
  ctx.font = `700 36px ${FONT}`;
  ctx.fillText("三源校准 · 前后对比报告", 60, 120);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,.65)";
  ctx.font = `500 12px ${FONT}`;
  ctx.fillText(`数据版本  ${view.version}`, 1540, 48);
  ctx.fillText(`窗口  ${formatClock(view.startSlot * view.intervalSeconds)}–${formatClock(view.endSlot * view.intervalSeconds)}  ·  ${view.title}`, 1540, 72);
  ctx.fillText(`生成时间  ${new Date().toLocaleString("zh-CN", { hour12: false })}`, 1540, 96);

  drawComparisonStats(ctx, view);

  const panelWidth = 1480;
  const panelHeight = 308;
  drawExportPanel(ctx, view, {
    x: 60,
    y: 348,
    width: panelWidth,
    height: panelHeight,
    title: "校准前 · 原始误差",
    subtitle: `MAE ${formatValue(view.stats.rawMae, 3)} °C  /  最大偏差 ${formatValue(view.stats.rawMax, 3)} °C  /  ${view.stats.n} 个有效配对`,
    field: "rawError",
    domain,
  });
  drawExportPanel(ctx, view, {
    x: 60,
    y: 682,
    width: panelWidth,
    height: panelHeight,
    title: "校准后 · 残差误差",
    subtitle: `MAE ${formatValue(view.stats.calibratedMae, 3)} °C  /  最大偏差 ${formatValue(view.stats.calibratedMax, 3)} °C  /  改善 ${formatPercent(view.stats.improvement)}`,
    field: "calibratedError",
    domain,
  });

  roundedRect(ctx, 60, 1016, 1480, 106, 10, "rgba(255,253,248,.82)", "rgba(33,48,44,.1)");
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = palette.ink;
  ctx.font = `700 12px ${FONT}`;
  ctx.fillText("当前筛选与统计口径", 82, 1042);
  ctx.fillStyle = palette.muted;
  ctx.font = `500 11px ${FONT}`;
  const sensors = view.selectedSensors.map((id) => SENSORS.find((item) => item.id === id)?.label).join(" / ");
  ctx.fillText(`传感器：${sensors}   异常策略：${view.excludeAnomalies ? "剔除" : "保留"}   去重 ${view.quality.duplicateRemovedInWindow} 条   窗口缺失 ${view.quality.missingInWindow} 个   窗口异常 ${view.quality.anomaliesInWindow} 个`, 82, 1066);
  ctx.fillText("重复读数取中位数；误差 = 测量值 − 参考值；MAE = Σ|误差| / 有效配对数；缺失不做插值；图形、列表与导出均由同一份清洗结果派生。", 82, 1088);
  ctx.fillStyle = "rgba(114,128,122,.72)";
  ctx.font = `9px ${MONO}`;
  ctx.fillText(`RAW SOURCE / ${view.datasetId} / slots ${view.startSlot}-${view.endSlot} / calibration is a derived transform only`, 82, 1108);

  return canvas;
}
