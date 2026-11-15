import { formatClock } from "./data.js";

const STATUS_COLORS = {
  normal: null,
  duplicate: "#7857d8",
  missing: "#d97706",
  anomaly: "#d44747"
};

export const STATUS_LABELS = {
  normal: "正常",
  duplicate: "重复（已去重）",
  missing: "存在缺失",
  anomaly: "异常间隔"
};

export const STATUS_SHORT_LABELS = {
  normal: "正常",
  duplicate: "重复",
  missing: "缺失",
  anomaly: "异常"
};

function hexToRgba(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawHatch(ctx, x, y, width, height, radius, color) {
  if (width < 3 || height < 3) return;
  ctx.save();
  roundedRect(ctx, x, y, width, height, radius);
  ctx.clip();
  ctx.strokeStyle = hexToRgba(color, 0.3);
  ctx.lineWidth = 1;
  for (let offset = -height; offset < width + height; offset += 7) {
    ctx.beginPath();
    ctx.moveTo(x + offset, y + height);
    ctx.lineTo(x + offset + height, y);
    ctx.stroke();
  }
  ctx.restore();
}

function chooseTickMinutes(span) {
  if (span <= 80) return 10;
  if (span <= 125) return 15;
  if (span <= 200) return 30;
  return 60;
}

function drawTimeAxis(ctx, layout, scale) {
  const { plot, startMinute, endMinute } = layout;
  const span = endMinute - startMinute;
  const tick = chooseTickMinutes(span);
  const firstTick = Math.ceil(startMinute / tick) * tick;
  ctx.save();
  ctx.font = `600 ${Math.round(9 * scale)}px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let minute = firstTick; minute <= endMinute; minute += tick) {
    const x = layout.xScale(minute);
    ctx.beginPath();
    ctx.moveTo(x, plot.top);
    ctx.lineTo(x, plot.bottom);
    ctx.strokeStyle = minute % 60 === 0 ? "#e2e8f1" : "#edf1f6";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = minute % 60 === 0 ? "#697991" : "#8f9bad";
    ctx.fillText(formatClock(minute), x, plot.bottom + 12 * scale);
  }
  ctx.restore();
}

function drawLane(ctx, line, layout, scale, index) {
  const { plot } = layout;
  const centerY = plot.top + (index + 0.5) * layout.rowHeight;
  const laneHeight = layout.rowHeight - 7 * scale;
  ctx.save();
  ctx.fillStyle = index % 2 === 0 ? "rgba(247, 250, 254, 0.72)" : "rgba(251, 252, 254, 0.4)";
  roundedRect(
    ctx,
    plot.left,
    centerY - laneHeight / 2,
    plot.right - plot.left,
    laneHeight,
    8 * scale
  );
  ctx.fill();

  ctx.fillStyle = line.color;
  roundedRect(ctx, 16 * scale, centerY - 10 * scale, 3 * scale, 20 * scale, 2 * scale);
  ctx.fill();

  ctx.fillStyle = "#24334c";
  ctx.font = `700 ${Math.round(11 * scale)}px "Inter", "Noto Sans SC", sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(line.name, 29 * scale, centerY - 6 * scale);

  ctx.fillStyle = "#8794a8";
  ctx.font = `500 ${Math.round(8.5 * scale)}px "Inter", "Noto Sans SC", sans-serif`;
  ctx.fillText(`${line.station} · ${line.direction}`, 29 * scale, centerY + 8 * scale);
  ctx.restore();
}

function drawMissingMarkers(ctx, interval, x1, x2, centerY, layout, scale) {
  interval.missingSlots.forEach((slot) => {
    if (slot.minute < layout.startMinute || slot.minute > layout.endMinute) return;
    const x = layout.xScale(slot.minute);
    if (x < x1 || x > x2) return;
    ctx.save();
    ctx.translate(x, centerY);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = "#fffaf0";
    ctx.strokeStyle = STATUS_COLORS.missing;
    ctx.lineWidth = 1.2;
    ctx.fillRect(-4.2 * scale, -4.2 * scale, 8.4 * scale, 8.4 * scale);
    ctx.strokeRect(-4.2 * scale, -4.2 * scale, 8.4 * scale, 8.4 * scale);
    ctx.restore();
    ctx.fillStyle = "#a8630b";
    ctx.font = `700 ${Math.round(7.5 * scale)}px "Inter", "Noto Sans SC", sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("缺", x, centerY - 8 * scale);
  });
}

function drawDuplicateMarker(ctx, x, centerY, scale) {
  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.strokeStyle = STATUS_COLORS.duplicate;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x, centerY, 4.6 * scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, centerY, 2.2 * scale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSegment(ctx, interval, layout, scale, options) {
  const { plot } = layout;
  const rowIndex = layout.lineRowMap.get(interval.lineId);
  if (rowIndex === undefined) return;
  const centerY = plot.top + (rowIndex + 0.5) * layout.rowHeight;
  const x1 = Math.max(plot.left, layout.xScale(interval.startMinute));
  const x2 = Math.min(plot.right, layout.xScale(interval.endMinute));
  const width = Math.max(1, x2 - x1);
  const height = Math.min(25 * scale, layout.rowHeight * 0.46);
  const y = centerY - height / 2;
  const radius = Math.min(7 * scale, height / 2);
  const selected = interval.key === options.selectedKey;
  const hovered = interval.key === options.hoverKey;
  const baseColor = interval.line.color;
  const statusColor = STATUS_COLORS[interval.status];

  if (interval.status === "missing") {
    drawHatch(ctx, x1, y, width, height, radius, STATUS_COLORS.missing);
  } else if (interval.status === "anomaly") {
    drawHatch(ctx, x1, y, width, height, radius, STATUS_COLORS.anomaly);
  }

  ctx.save();
  roundedRect(ctx, x1, y, width, height, radius);
  if (interval.status === "missing") {
    ctx.fillStyle = "rgba(217, 119, 6, 0.09)";
  } else if (interval.status === "anomaly") {
    ctx.fillStyle = "rgba(212, 71, 71, 0.09)";
  } else {
    ctx.fillStyle = hexToRgba(baseColor, hovered ? 0.27 : 0.18);
  }
  ctx.fill();
  ctx.strokeStyle = selected
    ? "#0f2f60"
    : statusColor
      ? hexToRgba(statusColor, hovered ? 0.95 : 0.7)
      : hexToRgba(baseColor, hovered ? 0.9 : 0.54);
  ctx.lineWidth = selected ? 2.4 : hovered ? 1.8 : 1;
  if (interval.status === "missing") ctx.setLineDash([4 * scale, 3 * scale]);
  ctx.stroke();
  ctx.restore();

  if (width > 32 * scale) {
    const label =
      interval.status === "missing"
        ? width > 68 * scale
          ? `缺 ${interval.missingSlots.length} 班`
          : "缺"
        : interval.status === "anomaly"
          ? width > 60 * scale
            ? `异常 ${(interval.headwaySeconds / 60).toFixed(1)}′`
            : "异常"
          : `${(interval.headwaySeconds / 60).toFixed(1)}′`;
    ctx.save();
    ctx.font = `700 ${Math.round(8.5 * scale)}px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle =
      interval.status === "missing"
        ? "#9a5a09"
        : interval.status === "anomaly"
          ? "#ad3030"
          : "#34455e";
    ctx.fillText(label, (x1 + x2) / 2, centerY + 0.3 * scale);
    ctx.restore();
  }

  if (interval.duplicateCount > 0) {
    if (interval.first.duplicate !== undefined) {
      const firstX = layout.xScale(interval.startMinute);
      const secondX = layout.xScale(interval.endMinute);
      if (interval.records.some((record) => record.serviceKey === interval.first.serviceKey && record.duplicate)) {
        drawDuplicateMarker(ctx, firstX, centerY, scale);
      }
      if (interval.records.some((record) => record.serviceKey === interval.second.serviceKey && record.duplicate)) {
        drawDuplicateMarker(ctx, secondX, centerY, scale);
      }
    }
  }

  if (interval.status === "missing") {
    drawMissingMarkers(ctx, interval, x1, x2, centerY, layout, scale);
  }

  layout.segments.push({
    key: interval.key,
    x1,
    x2,
    y1: centerY - layout.rowHeight / 2,
    y2: centerY + layout.rowHeight / 2,
    centerY,
    interval
  });
}

export function drawSpaceTimeChart(ctx, width, height, view, options = {}) {
  const scale = options.scale ?? 1;
  const selectedKey = options.selectedKey ?? null;
  const hoverKey = options.hoverKey ?? null;
  const left = (options.left ?? 118) * scale;
  const rightPad = (options.rightPad ?? 24) * scale;
  const top = (options.top ?? 24) * scale;
  const bottomPad = (options.bottomPad ?? 34) * scale;
  const plot = {
    left,
    right: width - rightPad,
    top,
    bottom: height - bottomPad
  };
  const span = view.window.endMinute - view.window.startMinute;
  const xScale = (minute) =>
    plot.left + ((minute - view.window.startMinute) / span) * (plot.right - plot.left);
  const rowHeight = (plot.bottom - plot.top) / Math.max(1, view.lines.length);
  const layout = {
    width,
    height,
    plot,
    startMinute: view.window.startMinute,
    endMinute: view.window.endMinute,
    xScale,
    rowHeight,
    lineRowMap: new Map(view.lines.map((line, index) => [line.id, index])),
    segments: []
  };

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = options.background ?? "#fbfcfe";
  ctx.fillRect(0, 0, width, height);

  if (!view.lines.length) return layout;

  drawTimeAxis(ctx, layout, scale);
  view.lines.forEach((line, index) => drawLane(ctx, line, layout, scale, index));

  ctx.save();
  ctx.beginPath();
  ctx.rect(plot.left, plot.top, plot.right - plot.left, plot.bottom - plot.top);
  ctx.clip();
  view.intervals.forEach((interval) => {
    drawSegment(ctx, interval, layout, scale, { selectedKey, hoverKey });
  });
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = "#dfe6f0";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(plot.left, plot.bottom + 0.5);
  ctx.lineTo(plot.right, plot.bottom + 0.5);
  ctx.stroke();
  ctx.restore();

  return layout;
}

export function hitTestSegment(layout, x, y) {
  if (!layout) return null;
  for (let index = layout.segments.length - 1; index >= 0; index -= 1) {
    const segment = layout.segments[index];
    if (x >= segment.x1 && x <= segment.x2 && y >= segment.y1 && y <= segment.y2) {
      return segment;
    }
  }
  return null;
}
