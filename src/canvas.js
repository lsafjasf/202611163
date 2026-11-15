import { LINE_BY_ID, LINES, STATION_BY_ID } from "./data.js";

const WORLD = { width: 1000, height: 600 };
const FONT = '"Noto Sans SC Local", "Ubuntu Sans", "Microsoft YaHei", sans-serif';

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function drawBackground(ctx, width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0c192a");
  gradient.addColorStop(0.55, "#0a1423");
  gradient.addColorStop(1, "#08111d");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  const halo = ctx.createRadialGradient(
    width * 0.72,
    height * 0.22,
    10,
    width * 0.72,
    height * 0.22,
    width * 0.6
  );
  halo.addColorStop(0, "rgba(48, 147, 190, 0.12)");
  halo.addColorStop(1, "rgba(6, 14, 25, 0)");
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(156, 192, 220, 0.13)";
  for (let x = 24; x < width; x += 32) {
    for (let y = 24; y < height; y += 32) {
      ctx.beginPath();
      ctx.arc(x, y, 0.8, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function fitWorld(canvas, ctx) {
  const width = canvas.width;
  const height = canvas.height;
  const scale = Math.min(width / WORLD.width, height / WORLD.height);
  const offsetX = (width - WORLD.width * scale) / 2;
  const offsetY = (height - WORLD.height * scale) / 2;
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  return { scale, offsetX, offsetY };
}

function segmentPoints(fromId, toId) {
  const from = STATION_BY_ID.get(fromId);
  const to = STATION_BY_ID.get(toId);
  return { from, to };
}

function lineWidthForStatus(status) {
  if (status === "suspended") return 4;
  if (status === "missing") return 3;
  return 10;
}

function drawBaseSegments(ctx, model) {
  model.lineRows.forEach((segment) => {
    const { from, to } = segmentPoints(segment.from, segment.to);
    const line = LINE_BY_ID.get(segment.lineId);
    const status = segment.status;

    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    if (status === "operating") {
      ctx.strokeStyle = "rgba(2, 8, 16, 0.86)";
      ctx.lineWidth = 17;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      ctx.strokeStyle = line.color;
      ctx.globalAlpha = 0.94;
      ctx.lineWidth = 10;
      ctx.shadowColor = line.color;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else if (status === "suspended") {
      ctx.strokeStyle = "rgba(255, 100, 113, 0.2)";
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();

      ctx.strokeStyle = "#ff6677";
      ctx.lineWidth = lineWidthForStatus(status);
      ctx.setLineDash([8, 9]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } else {
      ctx.strokeStyle = "rgba(155, 176, 194, 0.28)";
      ctx.lineWidth = lineWidthForStatus(status);
      ctx.setLineDash([3, 8]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.restore();
  });
}

function drawOffsetEdge(ctx, from, to, offset, color, dashed = false) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * offset;
  const ny = (dx / length) * offset;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = 3.2;
  ctx.strokeStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  if (dashed) ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x + nx, from.y + ny);
  ctx.lineTo(to.x + nx, to.y + ny);
  ctx.stroke();
  ctx.restore();
}

function drawRouteHighlights(ctx, model) {
  const shortest = model.routes.shortest;
  const fewest = model.routes.fewest;
  const samePath = model.routes.samePath;

  if (shortest) {
    shortest.segments.forEach((segment) => {
      const { from, to } = segmentPoints(segment.from, segment.to);
      drawOffsetEdge(ctx, from, to, samePath ? -2.5 : 0, "#53e7ff");
    });
  }

  if (fewest) {
    fewest.segments.forEach((segment) => {
      const { from, to } = segmentPoints(segment.from, segment.to);
      drawOffsetEdge(ctx, from, to, samePath ? 2.5 : 0, "#ffbf66", true);
    });
  }
}

function drawStationNodes(ctx, model) {
  const originId = model.state.originId;
  const destinationId = model.state.destinationId;
  const disconnected = new Set(model.routes.disconnected);

  model.stationRows.forEach((station) => {
    const lines = station.lines;
    const interchange = lines.length > 1;
    const isOrigin = station.id === originId;
    const isDestination = station.id === destinationId;
    const isDisconnected = disconnected.has(station.id);

    if (isDisconnected) {
      ctx.save();
      ctx.strokeStyle = "rgba(255, 102, 119, 0.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(station.x, station.y, interchange ? 15 : 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (isOrigin || isDestination) {
      ctx.save();
      ctx.strokeStyle = isOrigin ? "#53e7ff" : "#ffbf66";
      ctx.lineWidth = 2.5;
      ctx.shadowColor = isOrigin ? "#53e7ff" : "#ffbf66";
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(station.x, station.y, interchange ? 15 : 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "#f6fbff";
    ctx.strokeStyle = isDisconnected ? "#ff6677" : "#0a1423";
    ctx.lineWidth = interchange ? 4 : 3;
    ctx.beginPath();
    ctx.arc(station.x, station.y, interchange ? 8 : 6.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (interchange) {
      ctx.fillStyle = "#0a1423";
      ctx.beginPath();
      ctx.arc(station.x, station.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

function intersects(a, b, gap = 4) {
  return !(
    a.x + a.width + gap < b.x ||
    b.x + b.width + gap < a.x ||
    a.y + a.height + gap < b.y ||
    b.y + b.height + gap < a.y
  );
}

function stationLabelCandidates(station, width, height) {
  const preferred = {
    left: { x: station.x - width - 17, y: station.y - height / 2 },
    right: { x: station.x + 17, y: station.y - height / 2 },
    top: { x: station.x - width / 2, y: station.y - height - 17 },
    bottom: { x: station.x - width / 2, y: station.y + 17 }
  };
  const order = [station.label, "right", "left", "top", "bottom"];
  const seen = new Set();
  return order
    .filter((side) => {
      if (seen.has(side)) return false;
      seen.add(side);
      return true;
    })
    .map((side) => ({ ...preferred[side], side }));
}

function chooseLabelPlacement(candidates, occupied, width, height) {
  const inBounds = candidates.filter(
    (box) =>
      box.x >= 8 &&
      box.y >= 8 &&
      box.x + width <= WORLD.width - 8 &&
      box.y + height <= WORLD.height - 8
  );
  const choices = inBounds.length ? inBounds : candidates;
  return (
    choices.find((box) => occupied.every((other) => !intersects(box, other))) ||
    choices[0]
  );
}

function drawStationLabels(ctx, model) {
  const occupied = [];
  const disconnected = new Set(model.routes.disconnected);
  const terminal =
    model.state.originId === model.state.destinationId
      ? new Map([[model.state.originId, "起终"]])
      : new Map([
          [model.state.originId, "起"],
          [model.state.destinationId, "终"]
        ]);

  ctx.save();
  ctx.font = `600 13px ${FONT}`;
  model.stationRows.forEach((station) => {
    const nameWidth = ctx.measureText(station.name).width;
    const terminalText = terminal.get(station.id);
    const isDisconnected = disconnected.has(station.id);
    const prefixWidth = terminalText ? 24 : 0;
    const suffixWidth = isDisconnected ? 35 : 0;
    const width = Math.ceil(nameWidth + 18 + prefixWidth + suffixWidth);
    const height = 25;
    const options = stationLabelCandidates(station, width, height);
    const box = chooseLabelPlacement(options, occupied, width, height);
    occupied.push(box);

    const borderColor = terminalText
      ? terminalText.startsWith("起")
        ? "#53e7ff"
        : "#ffbf66"
      : isDisconnected
        ? "#ff6677"
        : "rgba(187, 211, 230, 0.16)";

    ctx.save();
    roundedRect(ctx, box.x, box.y, width, height, 7);
    ctx.fillStyle = isDisconnected ? "rgba(66, 22, 32, 0.94)" : "rgba(9, 20, 34, 0.94)";
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.stroke();

    let textX = box.x + 9;
    const centerY = box.y + height / 2 + 0.5;
    if (terminalText) {
      const badgeWidth = terminalText.length > 1 ? 21 : 15;
      roundedRect(ctx, textX, box.y + 5, badgeWidth, 15, 4);
      ctx.fillStyle = terminalText.startsWith("起") ? "#53e7ff" : "#ffbf66";
      ctx.fill();
      ctx.fillStyle = "#07111f";
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(terminalText, textX + badgeWidth / 2, centerY);
      textX += badgeWidth + 6;
    }

    ctx.font = `600 13px ${FONT}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isDisconnected ? "#ffd8dc" : "#eef7ff";
    ctx.fillText(station.name, textX, centerY);

    if (isDisconnected) {
      ctx.font = `600 10px ${FONT}`;
      ctx.fillStyle = "#ff8c98";
      ctx.fillText("断开", box.x + width - 31, centerY);
    }
    ctx.restore();
  });
  ctx.restore();
  return occupied;
}

function drawClosureLabels(ctx, model, occupied) {
  model.lineRows
    .filter((segment) => segment.status === "suspended")
    .forEach((segment) => {
      const { from, to } = segmentPoints(segment.from, segment.to);
      const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      const width = 57;
      const height = 21;
      const candidates = [
        { x: midpoint.x - width / 2, y: midpoint.y - 34 },
        { x: midpoint.x - width / 2, y: midpoint.y + 15 },
        { x: midpoint.x + 12, y: midpoint.y - height / 2 },
        { x: midpoint.x - width - 12, y: midpoint.y - height / 2 }
      ];
      const box = chooseLabelPlacement(candidates, occupied, width, height);
      occupied.push(box);

      ctx.save();
      roundedRect(ctx, box.x, box.y, width, height, 5);
      ctx.fillStyle = "rgba(102, 25, 37, 0.95)";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 102, 119, 0.75)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = "#ffdce0";
      ctx.font = `700 10px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("区间停运", box.x + width / 2, box.y + height / 2 + 0.5);
      ctx.restore();
    });
}

function drawMapCaption(ctx, model) {
  ctx.save();
  ctx.fillStyle = "rgba(165, 194, 217, 0.42)";
  ctx.font = `600 10px ${FONT}`;
  ctx.textAlign = "left";
  ctx.fillText("SCHEMATIC NETWORK · NOT TO SCALE", 24, 580);
  ctx.textAlign = "right";
  ctx.fillText(
    `${model.window.label} ${model.window.shortRange} / ${model.dataset.version}`,
    WORLD.width - 24,
    580
  );
  ctx.restore();
}

export function drawScene(canvas, model, options = {}) {
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height);

  ctx.save();
  const view = fitWorld(canvas, ctx);
  drawBaseSegments(ctx, model);
  drawRouteHighlights(ctx, model);
  drawStationNodes(ctx, model);
  const occupied = drawStationLabels(ctx, model);
  drawClosureLabels(ctx, model, occupied);
  drawMapCaption(ctx, model);
  ctx.restore();

  if (options.frame) {
    ctx.save();
    ctx.strokeStyle = "rgba(173, 207, 232, 0.12)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
    ctx.restore();
  }
  return view;
}

export function renderCanvas(canvas, model) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  return drawScene(canvas, model, { frame: true });
}

export function nearestStation(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return null;
  const deviceX = ((clientX - rect.left) / rect.width) * canvas.width;
  const deviceY = ((clientY - rect.top) / rect.height) * canvas.height;
  const scale = Math.min(canvas.width / WORLD.width, canvas.height / WORLD.height);
  const offsetX = (canvas.width - WORLD.width * scale) / 2;
  const offsetY = (canvas.height - WORLD.height * scale) / 2;
  const worldX = (deviceX - offsetX) / scale;
  const worldY = (deviceY - offsetY) / scale;
  let closest = null;
  let closestDistance = 24;

  STATION_BY_ID.forEach((station) => {
    const distance = Math.hypot(station.x - worldX, station.y - worldY);
    if (distance < closestDistance) {
      closest = station;
      closestDistance = distance;
    }
  });
  return closest;
}

function drawText(ctx, text, x, y, font, color, align = "left") {
  ctx.save();
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawExportPill(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.font = `600 20px ${FONT}`;
  const width = ctx.measureText(text).width + (options.padX || 28);
  roundedRect(ctx, x, y, width, options.height || 38, 9);
  ctx.fillStyle = options.fill || "rgba(26, 45, 65, 0.9)";
  ctx.fill();
  ctx.strokeStyle = options.stroke || "rgba(174, 208, 233, 0.15)";
  ctx.lineWidth = 1;
  ctx.stroke();
  drawText(
    ctx,
    text,
    x + width / 2,
    y + (options.height || 38) / 2 + 1,
    `600 20px ${FONT}`,
    options.color || "#dcefff",
    "center"
  );
  ctx.restore();
  return width;
}

function routeExportSummary(route, model) {
  if (!route) {
    const names = model.routes.disconnected
      .map((id) => STATION_BY_ID.get(id)?.name)
      .filter(Boolean);
    return names.length
      ? `不可达 · 断开站点：${names.join("、")}`
      : "不可达 · 当前筛选下无可用路径";
  }
  const lineNames = route.legs.map((leg) => LINE_BY_ID.get(leg.lineId).shortName);
  return `${route.totalMinutes} 分钟 / ${route.transfers} 次换乘 · ${lineNames.join(" → ")}`;
}

function routeExportStations(route) {
  if (!route) return "";
  return route.stationIds.map((id) => STATION_BY_ID.get(id).name).join(" → ");
}

function truncateCanvasText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let result = text;
  while (result.length && ctx.measureText(result + ellipsis).width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + ellipsis;
}

export function createExportCanvas(model) {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 1200;
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, 1600, 1200);
  background.addColorStop(0, "#0b1828");
  background.addColorStop(1, "#07101c");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  roundedRect(ctx, 44, 32, 52, 52, 13);
  ctx.fillStyle = "#53e7ff";
  ctx.fill();
  drawText(ctx, "轨", 70, 59, `700 25px ${FONT}`, "#07111f", "center");
  drawText(ctx, "轨脉 · 抽象线网路线图", 112, 50, `700 30px ${FONT}`, "#f2f8ff");
  drawText(
    ctx,
    "ROUTE MAP / DETERMINISTIC DATA MODEL",
    112,
    76,
    `600 13px ${FONT}`,
    "rgba(159, 194, 219, 0.7)"
  );
  drawText(
    ctx,
    `数据版本 ${model.dataset.version}`,
    1544,
    49,
    `600 17px ${FONT}`,
    "#53e7ff",
    "right"
  );
  drawText(
    ctx,
    `导出快照 ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    1544,
    76,
    `500 14px ${FONT}`,
    "rgba(159, 194, 219, 0.62)",
    "right"
  );

  ctx.strokeStyle = "rgba(174, 208, 233, 0.13)";
  ctx.beginPath();
  ctx.moveTo(44, 104);
  ctx.lineTo(1556, 104);
  ctx.stroke();

  let pillX = 44;
  [
    `${model.window.label} ${model.window.shortRange}`,
    model.dataset.label,
    `${STATION_BY_ID.get(model.state.originId).name} → ${STATION_BY_ID.get(model.state.destinationId).name}`
  ].forEach((text, index) => {
    const width = drawExportPill(ctx, text, pillX, 124, {
      fill: index === 0 ? "rgba(36, 104, 120, 0.36)" : "rgba(24, 42, 61, 0.88)",
      stroke: index === 0 ? "rgba(83, 231, 255, 0.42)" : "rgba(174, 208, 233, 0.15)",
      color: index === 0 ? "#9ff3ff" : "#dcefff"
    });
    pillX += width + 12;
  });
  drawText(
    ctx,
    `统计口径：${model.statistics.scope}`,
    1544,
    144,
    `500 14px ${FONT}`,
    "rgba(177, 204, 224, 0.75)",
    "right"
  );

  const mapCanvas = document.createElement("canvas");
  mapCanvas.width = 1520;
  mapCanvas.height = 760;
  drawScene(mapCanvas, model, { frame: true });
  ctx.save();
  roundedRect(ctx, 40, 180, 1520, 760, 18);
  ctx.clip();
  ctx.drawImage(mapCanvas, 40, 180);
  ctx.restore();
  ctx.save();
  roundedRect(ctx, 40, 180, 1520, 760, 18);
  ctx.strokeStyle = "rgba(174, 208, 233, 0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  drawText(ctx, "路径比较", 48, 982, `700 20px ${FONT}`, "#f2f8ff");
  const routeRows = [
    ["最短时间", model.routes.shortest, "#53e7ff", 1017],
    ["最少换乘", model.routes.fewest, "#ffbf66", 1070]
  ];
  routeRows.forEach(([label, route, color, y]) => {
    drawText(ctx, label, 48, y, `700 16px ${FONT}`, color);
    drawText(
      ctx,
      routeExportSummary(route, model),
      132,
      y,
      `600 15px ${FONT}`,
      "#d4e4f0"
    );
    if (route) {
      ctx.save();
      ctx.font = `500 12px ${FONT}`;
      drawText(
        ctx,
        truncateCanvasText(ctx, routeExportStations(route), 640),
        132,
        y + 21,
        `500 12px ${FONT}`,
        "#839eb1"
      );
      ctx.restore();
    }
  });
  drawText(
    ctx,
    `换乘等待口径：每次 ${model.window.transferMinutes} 分钟，已计入总分钟数`,
    48,
    1124,
    `500 14px ${FONT}`,
    "rgba(151, 185, 210, 0.75)"
  );

  ctx.strokeStyle = "rgba(174, 208, 233, 0.13)";
  ctx.beginPath();
  ctx.moveTo(800, 970);
  ctx.lineTo(800, 1132);
  ctx.stroke();

  drawText(ctx, "数据质量摘要", 832, 982, `700 20px ${FONT}`, "#f2f8ff");
  drawText(
    ctx,
    `${model.quality.rateLabel} 有效`,
    1544,
    982,
    `700 19px ${FONT}`,
    "#70e3a4",
    "right"
  );
  drawText(ctx, model.quality.equation, 832, 1020, `500 16px ${FONT}`, "#c8dbea");
  const qualityItems = [
    ["去重", model.statistics.duplicate],
    ["缺失", model.statistics.missing],
    ["异常", model.statistics.anomaly],
    ["有效站点", model.statistics.stationCount],
    ["有效区间", model.statistics.operatingSegments]
  ];
  let itemX = 832;
  qualityItems.forEach(([label, value]) => {
    const width = drawExportPill(ctx, `${label} ${value}`, itemX, 1050, {
      padX: 22,
      height: 34,
      fill: "rgba(23, 42, 58, 0.9)",
      color: "#e0effa"
    });
    itemX += width + 9;
  });
  drawText(
    ctx,
    `去重键 = 线路 + 起终站；缺失、重复、异常记录不参与路径计算`,
    832,
    1107,
    `500 14px ${FONT}`,
    "rgba(151, 185, 210, 0.75)"
  );

  drawText(
    ctx,
    "该路线图由当前画布模型直接生成；屏幕、表格、CSV 与本图共用同一组派生数值。",
    48,
    1162,
    `500 13px ${FONT}`,
    "rgba(130, 166, 193, 0.68)"
  );
  return canvas;
}
