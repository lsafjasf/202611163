import { drawSceneFrame } from "./scenes.js";
import {
  computeLayout,
  formatSeconds,
  sceneDuration,
  timelineSnapshot,
} from "./project.js";

const TRANSITION_LABELS = {
  cut: "硬切 / CUT",
  dissolve: "叠化 / DISSOLVE",
  wipe: "擦除 / WIPE",
  flash: "闪白 / FLASH",
};

function rounded(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}

function text(context, value, x, y, font, color, align = "left") {
  context.font = font;
  context.fillStyle = color;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(String(value), x, y);
}

export function validateTimelineIntegrity(project) {
  const layout = computeLayout(project);
  const durationSum = Math.round(
    layout.scenes.reduce((sum, item) => sum + item.duration, 0) * 1000,
  ) / 1000;
  const expectedEnd = layout.scenes.length
    ? layout.scenes[layout.scenes.length - 1].end
    : 0;
  const checks = {
    totalMatches: Math.abs(layout.total - durationSum) < 0.001,
    endMatches: Math.abs(expectedEnd - layout.total) < 0.001,
    inOutValid: layout.scenes.every(
      (item) =>
        item.scene.sourceIn >= 0 &&
        item.scene.sourceOut <= 8 &&
        Math.abs(sceneDuration(item.scene) - item.duration) < 0.001,
    ),
    keyframesPresent: layout.scenes.every((item) => item.scene.keyframes.length > 0),
    captionsPresent: layout.scenes.every((item) => Boolean(item.scene.subtitle.text)),
    audioStartValid:
      project.audio.start >= 0 && project.audio.start < Math.max(0.01, layout.total),
  };
  return {
    ok: Object.values(checks).every(Boolean),
    checks,
    total: layout.total,
    durationSum,
    snapshot: timelineSnapshot(project),
  };
}

export function buildStoryboardCsv(project) {
  const layout = computeLayout(project);
  const header = [
    "序号",
    "镜头",
    "英文名",
    "入点(s)",
    "出点(s)",
    "时长(s)",
    "时间线起点(s)",
    "时间线终点(s)",
    "字幕",
    "字幕入点(s)",
    "字幕出点(s)",
    "转场",
    "转场时长(s)",
    "关键帧数",
  ];
  const rows = layout.scenes.map((item) => [
    item.scene.no,
    item.scene.name,
    item.scene.english,
    item.scene.sourceIn.toFixed(2),
    item.scene.sourceOut.toFixed(2),
    item.duration.toFixed(2),
    item.start.toFixed(2),
    item.end.toFixed(2),
    item.scene.subtitle.text,
    item.scene.subtitle.in.toFixed(2),
    item.scene.subtitle.out.toFixed(2),
    TRANSITION_LABELS[item.scene.transition.type],
    item.scene.transition.duration.toFixed(2),
    String(item.scene.keyframes.length),
  ]);
  const totalRow = [
    "TOTAL",
    project.title,
    "",
    "",
    "",
    layout.total.toFixed(2),
    "0.00",
    layout.total.toFixed(2),
    `${project.audio.bpm} BPM`,
    "",
    "",
    "",
    "",
    String(layout.scenes.reduce((sum, item) => sum + item.scene.keyframes.length, 0)),
  ];
  const escape = (value) => {
    const source = String(value ?? "");
    return /[",\n]/.test(source) ? `"${source.replaceAll('"', '""')}"` : source;
  };
  return `\uFEFF${[header, ...rows, totalRow]
    .map((row) => row.map(escape).join(","))
    .join("\r\n")}\r\n`;
}

export function buildExportManifest(project, extra = {}) {
  const layout = computeLayout(project);
  const validation = validateTimelineIntegrity(project);
  return {
    format: "beatboard.export-manifest",
    version: 1,
    title: project.title,
    exportedAt: new Date().toISOString(),
    fps: project.fps,
    bpm: project.audio.bpm,
    audioStart: project.audio.start,
    totalDuration: layout.total,
    scenes: layout.scenes.map((item) => ({
      no: item.scene.no,
      name: item.scene.name,
      inPoint: item.scene.sourceIn,
      outPoint: item.scene.sourceOut,
      duration: item.duration,
      timelineStart: item.start,
      timelineEnd: item.end,
      subtitle: { ...item.scene.subtitle },
      transition: { ...item.scene.transition },
      keyframeCount: item.scene.keyframes.length,
    })),
    validation,
    ...extra,
  };
}

export function drawStoryboardSheet(project) {
  const layout = computeLayout(project);
  const canvas = document.createElement("canvas");
  canvas.width = 2400;
  canvas.height = 1700;
  const context = canvas.getContext("2d");

  context.fillStyle = "#080b0e";
  context.fillRect(0, 0, canvas.width, canvas.height);
  const glow = context.createRadialGradient(330, -120, 0, 330, -120, 900);
  glow.addColorStop(0, "rgba(70, 109, 103, 0.2)");
  glow.addColorStop(1, "rgba(70, 109, 103, 0)");
  context.fillStyle = glow;
  context.fillRect(0, 0, canvas.width, 620);

  context.fillStyle = "#f4b643";
  context.fillRect(54, 53, 4, 52);
  text(context, "BEATBOARD / CONTACT SHEET", 74, 62, '500 15px "DM Mono", monospace', "#788489");
  text(context, project.title, 54, 115, '600 48px "Noto Sans SC", sans-serif', "#eef1ec");
  text(
    context,
    "六格分镜 · 合成鼓点 · 共用主时钟",
    54,
    158,
    '400 19px "Noto Sans SC", sans-serif',
    "#7b8785",
  );

  const metadata = [
    ["TOTAL", `${layout.total.toFixed(2)}s`],
    ["BPM", String(project.audio.bpm)],
    ["FPS", String(project.fps).padStart(2, "0")],
    ["AUDIO IN", `${project.audio.start.toFixed(2)}s`],
    ["SHOTS", String(layout.scenes.length).padStart(2, "0")],
  ];
  metadata.forEach(([label, value], index) => {
    const x = canvas.width - 54 - (metadata.length - index - 1) * 180;
    text(context, label, x, 77, '500 11px "DM Mono", monospace', "#586469", "right");
    text(context, value, x, 112, '500 24px "DM Mono", monospace', "#d8dfda", "right");
  });

  context.strokeStyle = "#293136";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(54, 186.5);
  context.lineTo(2346, 186.5);
  context.stroke();

  const margin = 54;
  const gutter = 22;
  const cardWidth = (2400 - margin * 2 - gutter * 2) / 3;
  const cardHeight = 673;
  const rowGap = 25;
  const firstRow = 212;
  const imageHeight = 386;

  layout.scenes.forEach((item, index) => {
    const column = index % 3;
    const row = Math.floor(index / 3);
    const x = margin + column * (cardWidth + gutter);
    const y = firstRow + row * (cardHeight + rowGap);

    context.save();
    rounded(context, x, y, cardWidth, cardHeight, 7);
    context.clip();
    context.fillStyle = "#101518";
    context.fillRect(x, y, cardWidth, cardHeight);
    context.save();
    context.beginPath();
    context.rect(x, y, cardWidth, imageHeight);
    context.clip();
    context.translate(x, y);
    drawSceneFrame(
      context,
      cardWidth,
      imageHeight,
      item.scene,
      Math.min(item.duration * 0.46, item.scene.sourceOut),
    );
    context.restore();

    const imageShade = context.createLinearGradient(0, y + imageHeight * 0.55, 0, y + imageHeight);
    imageShade.addColorStop(0, "rgba(5,8,9,0)");
    imageShade.addColorStop(1, "rgba(5,8,9,0.68)");
    context.fillStyle = imageShade;
    context.fillRect(x, y + imageHeight * 0.55, cardWidth, imageHeight * 0.45);
    context.fillStyle = item.scene.palette[2];
    context.fillRect(x, y, 4, imageHeight);

    text(context, item.scene.no, x + 22, y + 28, '500 14px "DM Mono", monospace', "#f4b643");
    text(context, item.scene.english, x + 22, y + 51, '500 11px "DM Mono", monospace', "rgba(241,245,240,0.62)");
    text(
      context,
      `${formatSeconds(item.start)}  →  ${formatSeconds(item.end)}`,
      x + cardWidth - 22,
      y + 30,
      '500 12px "DM Mono", monospace',
      "rgba(241,245,240,0.7)",
      "right",
    );
    text(
      context,
      item.scene.name,
      x + 20,
      y + imageHeight - 30,
      '600 30px "Noto Sans SC", sans-serif',
      "#f3f5f0",
    );
    text(
      context,
      item.scene.subtitle.text,
      x + cardWidth - 20,
      y + imageHeight - 30,
      '400 13px "Noto Sans SC", sans-serif',
      "rgba(241,245,240,0.68)",
      "right",
    );

    const infoY = y + imageHeight;
    context.fillStyle = "#0d1215";
    context.fillRect(x, infoY, cardWidth, cardHeight - imageHeight);
    context.strokeStyle = "#283136";
    context.beginPath();
    context.moveTo(x, infoY + 0.5);
    context.lineTo(x + cardWidth, infoY + 0.5);
    context.stroke();

    const columns = [
      ["IN POINT", `${item.scene.sourceIn.toFixed(2)}s`],
      ["OUT POINT", `${item.scene.sourceOut.toFixed(2)}s`],
      ["DURATION", `${item.duration.toFixed(2)}s`],
    ];
    columns.forEach(([label, value], columnIndex) => {
      const columnX = x + 22 + columnIndex * (cardWidth - 44) / 3;
      text(context, label, columnX, infoY + 33, '500 9px "DM Mono", monospace', "#586469");
      text(context, value, columnX, infoY + 63, '500 22px "DM Mono", monospace', "#d8dfda");
    });

    context.strokeStyle = "#222a2f";
    context.beginPath();
    context.moveTo(x + 22, infoY + 89.5);
    context.lineTo(x + cardWidth - 22, infoY + 89.5);
    context.stroke();

    text(
      context,
      "TRANSITION",
      x + 22,
      infoY + 116,
      '500 9px "DM Mono", monospace',
      "#586469",
    );
    text(
      context,
      `${TRANSITION_LABELS[item.scene.transition.type]} · ${item.scene.transition.duration.toFixed(2)}s`,
      x + 22,
      infoY + 142,
      '400 13px "Noto Sans SC", sans-serif',
      "#aeb8b4",
    );
    text(
      context,
      "KEYFRAMES",
      x + cardWidth - 22,
      infoY + 116,
      '500 9px "DM Mono", monospace',
      "#586469",
      "right",
    );
    text(
      context,
      String(item.scene.keyframes.length).padStart(2, "0"),
      x + cardWidth - 22,
      infoY + 142,
      '500 15px "DM Mono", monospace',
      "#f4b643",
      "right",
    );

    const beats = [];
    const beatDuration = 60 / project.audio.bpm;
    for (let beat = Math.ceil(item.start / beatDuration); beat * beatDuration < item.end; beat += 1) {
      beats.push(beat * beatDuration);
    }
    beats.forEach((beat) => {
      const beatX = x + 22 + (beat - item.start) * (cardWidth - 44) / Math.max(0.001, item.duration);
      context.fillStyle = "rgba(73,197,182,0.55)";
      context.fillRect(beatX, infoY + 190, 1.5, 9);
    });
    text(context, "BEATS", x + 22, infoY + 220, '500 8px "DM Mono", monospace', "#3f5d58");
    text(
      context,
      `${String(beats.length).padStart(2, "0")} EVENTS`,
      x + cardWidth - 22,
      infoY + 220,
      '500 8px "DM Mono", monospace',
      "#3f5d58",
      "right",
    );
    context.restore();

    context.strokeStyle = "#2a3338";
    context.lineWidth = 1;
    rounded(context, x + 0.5, y + 0.5, cardWidth - 1, cardHeight - 1, 7);
    context.stroke();
  });

  const validation = validateTimelineIntegrity(project);
  context.strokeStyle = "#222a2f";
  context.beginPath();
  context.moveTo(54, 1620.5);
  context.lineTo(2346, 1620.5);
  context.stroke();
  text(
    context,
    `TIMELINE INTEGRITY ${validation.ok ? "PASS" : "CHECK"} · Σ SHOTS ${validation.durationSum.toFixed(2)}s · TOTAL ${validation.total.toFixed(2)}s`,
    54,
    1654,
    '500 11px "DM Mono", monospace',
    validation.ok ? "#49c5b6" : "#ee715f",
  );
  text(
    context,
    `${project.audio.bpm} BPM / ${project.fps} FPS / SYNTHETIC DRUMS`,
    2346,
    1654,
    '500 10px "DM Mono", monospace',
    "#596469",
    "right",
  );
  return { canvas, layout, validation };
}
