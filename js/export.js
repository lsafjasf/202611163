import { drawSpaceTimeChart } from "./chart.js";

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

function drawMetricCard(ctx, x, y, width, height, label, value, detail, tone) {
  ctx.save();
  roundedRect(ctx, x, y, width, height, 12);
  ctx.fillStyle = tone === "warn" ? "#fffaf0" : tone === "danger" ? "#fff8f8" : "#f8faff";
  ctx.fill();
  ctx.strokeStyle = tone === "warn" ? "#f0dcac" : tone === "danger" ? "#f0cccc" : "#e0e9f8";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#7b889b";
  ctx.font = '600 14px "Inter", "Noto Sans SC", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(label, x + 17, y + 14);

  ctx.fillStyle = tone === "warn" ? "#9a5b08" : tone === "danger" ? "#ad3434" : "#1d3c6d";
  ctx.font = '700 30px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace';
  ctx.fillText(value, x + 17, y + 35);

  ctx.fillStyle = "#8d99aa";
  ctx.font = '500 11px "Inter", "Noto Sans SC", sans-serif';
  ctx.textAlign = "right";
  ctx.fillText(detail, x + width - 17, y + height - 25);
  ctx.restore();
}

function drawLegendItem(ctx, x, y, item, width) {
  ctx.save();
  roundedRect(ctx, x, y, width, 34, 9);
  ctx.fillStyle = "#fbfcfe";
  ctx.fill();
  ctx.strokeStyle = "#e8edf4";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = item.color;
  roundedRect(ctx, x + 12, y + 14, 18, 6, 3);
  ctx.fill();

  ctx.fillStyle = "#44546d";
  ctx.font = '650 12px "Inter", "Noto Sans SC", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(item.name, x + 39, y + 17);

  ctx.fillStyle = "#25354e";
  ctx.font = '700 12px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace';
  ctx.textAlign = "right";
  ctx.fillText(item.average, x + width - 13, y + 17);
  ctx.restore();
}

function drawFooterText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 2) {
  const words = text.split("");
  const lines = [];
  let line = "";
  words.forEach((character) => {
    const test = line + character;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = character;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((item, index) => {
    ctx.fillText(item, x, y + index * lineHeight);
  });
}

export function renderExportSheet(view, snapshot, options = {}) {
  const width = options.width ?? 1600;
  const height = options.height ?? 1080;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#f1f5fb";
  ctx.fillRect(0, 0, width, height);

  roundedRect(ctx, 40, 28, 1520, 1024, 26);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "#dde5f0";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = "#8a97aa";
  ctx.font = '700 12px "SFMono-Regular", "Roboto Mono", monospace';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("HEADWAY SPACE–TIME  /  OPERATIONS REPORT", 70, 59);

  ctx.fillStyle = "#15243e";
  ctx.font = '720 38px "Inter", "Noto Sans SC", sans-serif';
  ctx.fillText(snapshot.title, 70, 82);

  ctx.fillStyle = "#192943";
  roundedRect(ctx, 1328, 61, 198, 48, 10);
  ctx.fill();
  ctx.fillStyle = "#91a6c9";
  ctx.font = '600 11px "Inter", "Noto Sans SC", sans-serif';
  ctx.textAlign = "right";
  ctx.fillText("数据版本", 1507, 71);
  ctx.fillStyle = "#ffffff";
  ctx.font = '700 13px "SFMono-Regular", "Roboto Mono", monospace';
  ctx.fillText(snapshot.dataVersion, 1507, 88);

  ctx.strokeStyle = "#e6ebf2";
  ctx.beginPath();
  ctx.moveTo(70, 137);
  ctx.lineTo(1530, 137);
  ctx.stroke();

  ctx.fillStyle = "#7f8ca0";
  ctx.font = '600 13px "Inter", "Noto Sans SC", sans-serif';
  ctx.textAlign = "left";
  ctx.fillText("筛选线路", 70, 156);
  ctx.fillStyle = "#2e405a";
  ctx.font = '650 14px "Inter", "Noto Sans SC", sans-serif';
  ctx.fillText(snapshot.filterLineShort, 143, 155);

  ctx.fillStyle = "#7f8ca0";
  ctx.font = '600 13px "Inter", "Noto Sans SC", sans-serif';
  ctx.fillText("时间窗口", 818, 156);
  ctx.fillStyle = "#1e4fbd";
  ctx.font = '700 14px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace';
  ctx.fillText(snapshot.timeWindow, 891, 155);

  ctx.fillStyle = "#7f8ca0";
  ctx.font = '600 13px "Inter", "Noto Sans SC", sans-serif';
  ctx.fillText("完整率", 1254, 156);
  ctx.fillStyle = "#18795f";
  ctx.font = '700 14px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace';
  ctx.fillText(snapshot.completeness, 1315, 155);

  const cardY = 184;
  const cardWidth = 287;
  const gap = 11;
  drawMetricCard(ctx, 70, cardY, cardWidth, 82, "当前窗口平均间隔", snapshot.average,
    `${snapshot.validCount} 段有效`, "normal");
  drawMetricCard(ctx, 70 + (cardWidth + gap), cardY, cardWidth, 82, "有效间隔段", String(snapshot.validCount),
    `共 ${snapshot.observedCount} 段`, "normal");
  drawMetricCard(ctx, 70 + (cardWidth + gap) * 2, cardY, cardWidth, 82, "重复记录", String(snapshot.duplicateCount),
    "已去重", "warn");
  drawMetricCard(ctx, 70 + (cardWidth + gap) * 3, cardY, cardWidth, 82, "缺失班次", String(snapshot.missingCount),
    "无原始行", "warn");
  drawMetricCard(ctx, 70 + (cardWidth + gap) * 4, cardY, cardWidth, 82, "异常间隔", String(snapshot.anomalyCount),
    "阈值 6–20 分", "danger");

  const legendWidth = 216;
  const legendGap = 8;
  const legendY = 286;
  snapshot.legend.forEach((item, index) => {
    drawLegendItem(ctx, 70 + (legendWidth + legendGap) * index, legendY, item, legendWidth);
  });

  roundedRect(ctx, 64, 338, 1472, 586, 16);
  ctx.fillStyle = "#fbfcfe";
  ctx.fill();
  ctx.strokeStyle = "#e2e9f2";
  ctx.stroke();

  ctx.save();
  ctx.translate(72, 347);
  drawSpaceTimeChart(ctx, 1456, 568, view, {
    scale: 1.08,
    left: 126,
    top: 25,
    bottomPad: 38,
    selectedKey: options.selectedKey ?? null,
    background: "#fbfcfe"
  });
  ctx.restore();

  ctx.fillStyle = "#718098";
  ctx.font = '600 13px "Inter", "Noto Sans SC", sans-serif';
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("统计口径", 70, 944);
  ctx.fillStyle = "#78869b";
  ctx.font = '500 12px "Inter", "Noto Sans SC", sans-serif';
  drawFooterText(ctx, snapshot.methodology, 70, 967, 1080, 17, 2);
  ctx.fillStyle = "#9aa6b7";
  ctx.font = '500 11px "Inter", "Noto Sans SC", sans-serif';
  ctx.fillText(snapshot.thresholds, 70, 1006);

  ctx.fillStyle = "#8d9aab";
  ctx.font = '600 11px "SFMono-Regular", "Roboto Mono", "Noto Sans SC", monospace';
  ctx.textAlign = "right";
  ctx.fillText(`${snapshot.dataVersion} · ${snapshot.timeWindow}`, 1528, 965);
  ctx.fillText("由原始到站记录实时重算", 1528, 984);

  return canvas;
}
