import { QUALITY_CALIBER, buildCsv, fmt } from "./data.js";

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function exportFrame(canvases, state, filterText, qualityTotals) {
  const headerH = 118;
  const gap = 12;
  const width = Math.max(canvases.map.width, canvases.wave.width, canvases.timeline.width) + 24;
  const height = headerH + canvases.map.height + canvases.wave.height +
    canvases.timeline.height + gap * 3 + 20;

  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#0f1622";
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#dce4f0";
  ctx.font = "bold 18px sans-serif";
  ctx.fillText("地震波形与震源扩散圈同步回放 — 当前帧", 14, 30);
  ctx.font = "12px sans-serif";
  ctx.fillStyle = "#9fc0e8";
  ctx.fillText(`数据版本：${state.version}`, 14, 52);
  ctx.fillText(
    `播放时间：${fmt(state.currentTime, 3)}s　数据集：${state.datasetLabel}　速度：${state.speed}×`,
    14, 70,
  );
  ctx.fillStyle = "#7fd1a8";
  ctx.fillText(filterText, 14, 88, width - 28);
  ctx.fillStyle = "#ffd479";
  ctx.fillText(
    `质量摘要：去重删除=${qualityTotals.duplicatesRemoved}，缺失样例=${qualityTotals.missingSamples}，` +
    `异常样例=${qualityTotals.anomalySamples}（${QUALITY_CALIBER}）`,
    14, 106, width - 28,
  );

  let y = headerH;
  for (const canvas of [canvases.map, canvases.wave, canvases.timeline]) {
    ctx.drawImage(canvas, 12, y);
    y += canvas.height + gap;
  }

  out.toBlob((blob) => {
    download(blob, `frame_${state.datasetId}_t${fmt(state.currentTime, 2)}.png`);
  }, "image/png");
}

export function exportCsv(filteredBins, filter, totals) {
  const csv = buildCsv(filteredBins, filter, totals);
  download(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `bins_${filter.datasetId}_${filter.windowStart}-${filter.windowEnd}s.csv`,
  );
}
