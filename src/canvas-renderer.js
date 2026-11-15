import { COLORS } from "./scene.js";
import { mm as formatMm } from "./geometry.js";

export const HANDLE_SIZE = 8;

export function roundRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function polygon(ctx, points) {
  if (!points.length) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  points.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
}

function drawDots(ctx, scene) {
  const { width, height } = scene;
  ctx.fillStyle = "rgba(31, 67, 57, 0.105)";
  for (let y = 18; y < height; y += 22) {
    for (let x = 18; x < width; x += 22) {
      ctx.beginPath();
      ctx.arc(x, y, 1, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function label(ctx, text, x, y, options = {}) {
  ctx.save();
  ctx.font = `${options.weight || 600} ${options.size || 10}px ${
    options.mono ? '"DejaVu Sans Mono", monospace' : '"DejaVu Sans", sans-serif'
  }`;
  ctx.fillStyle = options.color || COLORS.muted;
  ctx.textAlign = options.align || "left";
  ctx.textBaseline = options.baseline || "middle";
  if (options.tracking) {
    ctx.letterSpacing = `${options.tracking}px`;
  }
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawFlatCard(ctx, scene) {
  const { frame } = scene.flat;
  ctx.save();
  ctx.shadowColor = "rgba(24, 50, 43, 0.08)";
  ctx.shadowBlur = 20;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = COLORS.paperCard;
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 16);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(47, 72, 63, 0.13)";
  ctx.lineWidth = 1;
  roundRect(ctx, frame.x + 0.5, frame.y + 0.5, frame.w - 1, frame.h - 1, 16);
  ctx.stroke();
  ctx.restore();

  label(ctx, "FLAT DIELINE", frame.x + 18, frame.y + 25, {
    size: 11,
    weight: 800,
    color: COLORS.ink,
    tracking: 0.8,
  });
  label(ctx, "PRODUCTION NET · MM · 1:1 MODEL", frame.x + 18, frame.y + 40, {
    size: 8,
    mono: true,
    color: COLORS.faint,
    tracking: 0.4,
  });
  const d = scene.flat.dieline;
  if (frame.w >= 400) {
    label(
      ctx,
      `L ${d.length} × W ${d.width} × H ${d.height}`,
      frame.x + frame.w - 18,
      frame.y + 26,
      { size: 9, mono: true, color: COLORS.muted, align: "right" },
    );
    label(ctx, "4 PANELS / 8 FLAPS", frame.x + frame.w - 18, frame.y + 40, {
      size: 8,
      mono: true,
      color: COLORS.faint,
      align: "right",
    });
  }
}

function drawPaper(ctx, scene, showSafeAreas) {
  const { dieline, outline, panels, topFlaps, bottomFlaps, transform } = scene.flat;
  if (!outline.length) return;

  ctx.save();
  ctx.shadowColor = "rgba(75, 57, 26, 0.16)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 7;
  polygon(ctx, outline);
  ctx.fillStyle = COLORS.paper;
  ctx.fill();
  ctx.restore();

  panels.forEach((panel, index) => {
    ctx.save();
    ctx.globalAlpha = index % 2 === 0 ? 0.13 : 0.03;
    ctx.fillStyle = index % 2 === 0 ? "#fff6df" : "#705827";
    ctx.fillRect(panel.screen.x, panel.screen.y, panel.screen.w, panel.screen.h);
    ctx.restore();
  });

  [...topFlaps, ...bottomFlaps].forEach((flap, index) => {
    const alternate = index % 2 === 0;
    ctx.save();
    ctx.globalAlpha = alternate ? 0.06 : 0.12;
    ctx.fillStyle = "#fff5df";
    ctx.fillRect(flap.x, flap.y, flap.w, flap.h);
    ctx.restore();
  });

  if (showSafeAreas) {
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(58, 125, 140, 0.5)";
    ctx.lineWidth = 1;
    panels.forEach((panel) => {
      ctx.strokeRect(
        panel.safeScreen.x,
        panel.safeScreen.y,
        panel.safeScreen.w,
        panel.safeScreen.h,
      );
    });
    ctx.restore();
  }

  ctx.save();
  polygon(ctx, outline);
  ctx.strokeStyle = COLORS.cut;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();

  ctx.save();
  scene.flat.cuts.forEach((line) => {
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.strokeStyle = "rgba(32, 70, 59, 0.8)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  ctx.restore();

  ctx.save();
  ctx.setLineDash(scene.state.structure.foldStyle === "solid" ? [] : [5, 4]);
  scene.flat.folds.forEach((line) => {
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.strokeStyle = line.kind === "glue" ? COLORS.accent : COLORS.fold;
    ctx.lineWidth = Math.max(1, dieline.foldWidth * transform.scale * 1.55);
    ctx.stroke();
  });
  ctx.restore();

  drawPanelLabels(ctx, scene);
  drawDimensions(ctx, scene);
  drawFoldPlan(ctx, scene);
}

function drawFoldPlan(ctx, scene) {
  const { frame } = scene.flat;
  if (frame.h < 300) return;
  const frames = [...stateKeyframes(scene)].sort((a, b) => a.progress - b.progress);
  if (!frames.length) return;
  const x = frame.x + 24;
  const width = frame.w - 48;
  const compact = frame.w < 360;
  const y = frame.y + frame.h - 35;
  label(ctx, "FOLD KEYFRAMES", x, y - 27, {
    size: 8,
    weight: 800,
    color: COLORS.muted,
    tracking: 0.6,
  });
  if (!compact) {
    label(ctx, "CUT  ·  FOLD  ·  SAFE AREA", x + width, y - 27, {
      size: 7,
      mono: true,
      color: COLORS.faint,
      align: "right",
      tracking: 0.3,
    });
  }
  ctx.save();
  ctx.strokeStyle = "rgba(47, 72, 63, 0.25)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.stroke();
  frames.forEach((frameItem) => {
    const pointX = x + (clampNumber(frameItem.progress) / 100) * width;
    ctx.save();
    ctx.translate(pointX, y);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle =
      frameItem.id === scene.state.preview.activeKeyframe ? COLORS.accent : COLORS.yellow;
    ctx.fillRect(-3.5, -3.5, 7, 7);
    ctx.strokeStyle = COLORS.paperCard;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-3.5, -3.5, 7, 7);
    ctx.restore();
    ctx.save();
    ctx.fillStyle = "rgba(23, 59, 50, 0.64)";
    ctx.font = '600 7px "DejaVu Sans Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(compact ? `${Math.round(frameItem.progress)}%` : frameItem.label, pointX, y + 9);
    ctx.restore();
  });
  ctx.restore();
}

function stateKeyframes(scene) {
  return scene.state.foldKeyframes || [];
}

function clampNumber(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

function drawPanelLabels(ctx, scene) {
  scene.flat.panels.forEach((panel) => {
    const small = Math.min(panel.screen.w, panel.screen.h) < 52;
    if (small) return;
    const x = panel.screen.x + panel.screen.w / 2;
    const y = panel.screen.y + panel.screen.h - 9;
    ctx.save();
    ctx.fillStyle = "rgba(23, 59, 50, 0.72)";
    ctx.font = '700 7px "DejaVu Sans Mono", monospace';
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.letterSpacing = "0.4px";
    ctx.fillText(panel.label, x, y);
    ctx.restore();
  });
}

function dimensionLine(ctx, x1, y1, x2, y2, text) {
  ctx.save();
  ctx.strokeStyle = "rgba(43, 72, 62, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  ctx.fillStyle = COLORS.paperCard;
  ctx.font = '600 8px "DejaVu Sans Mono", monospace';
  const width = ctx.measureText(text).width + 8;
  roundRect(ctx, midX - width / 2, midY - 7, width, 14, 4);
  ctx.fill();
  ctx.fillStyle = COLORS.muted;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, midX, midY + 1);
  ctx.restore();
}

function drawDimensions(ctx, scene) {
  const { print, dieline } = scene.flat;
  dimensionLine(
    ctx,
    print.x,
    print.y - 16,
    print.x + print.w,
    print.y - 16,
    formatMm(dieline.netWidth),
  );
  dimensionLine(
    ctx,
    print.x - 17,
    print.y,
    print.x - 17,
    print.y + print.h,
    `${formatMm(dieline.netHeight)}`,
  );
}

function drawElement(ctx, element, images, selected) {
  if (element.visible === false) return;
  const box = element.box;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(((Number(element.rotation) || 0) * Math.PI) / 180);
  ctx.globalAlpha = element.opacity ?? 1;
  ctx.translate(-cx, -cy);

  if (element.type === "text") {
    ctx.beginPath();
    ctx.rect(element.safe.x, element.safe.y, element.safe.w, element.safe.h);
    ctx.clip();
    const scale = sceneSafeScale(element);
    const wordWidth = ctx.measureText ? 0 : 0;
    void wordWidth;
    ctx.font = `${element.fontWeight || 500} ${
      (element.fontSize || 12) * scale
    }px "${element.fontFamily || "DejaVu Sans"}", sans-serif`;
    ctx.fillStyle = element.color || COLORS.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if ("letterSpacing" in ctx) {
      ctx.letterSpacing = `${(element.letterSpacing || 0) * scale}px`;
    }
    const lineHeight = element.lineHeight;
    const startY = cy - element.totalHeight / 2 + lineHeight / 2;
    element.lines.forEach((line, index) => {
      ctx.fillText(line, cx, startY + index * lineHeight);
    });
  } else if (element.type === "image") {
    const image = images.get(element.src);
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    if (image && image.complete && image.naturalWidth) {
      const ratio = Math.min(box.w / image.naturalWidth, box.h / image.naturalHeight);
      const w = image.naturalWidth * ratio;
      const h = image.naturalHeight * ratio;
      ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
    } else {
      ctx.fillStyle = "rgba(23, 59, 50, 0.07)";
      ctx.fillRect(box.x, box.y, box.w, box.h);
      ctx.fillStyle = COLORS.muted;
      ctx.font = '10px "DejaVu Sans Mono", monospace';
      ctx.textAlign = "center";
      ctx.fillText("IMAGE", cx, cy);
    }
  } else {
    drawShape(ctx, element, box);
  }
  ctx.restore();

  if (selected) drawSelection(ctx, element);
}

function sceneSafeScale(element) {
  return element.box.w / Math.max(0.01, element.rawBox?.w || element.box.w);
}

function drawShape(ctx, element, box) {
  const color = element.color || COLORS.accent;
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  if (element.type === "circle") {
    ctx.beginPath();
    ctx.ellipse(box.x + box.w / 2, box.y + box.h / 2, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (element.type === "diamond") {
    ctx.beginPath();
    ctx.moveTo(box.x + box.w / 2, box.y);
    ctx.lineTo(box.x + box.w, box.y + box.h / 2);
    ctx.lineTo(box.x + box.w / 2, box.y + box.h);
    ctx.lineTo(box.x, box.y + box.h / 2);
    ctx.closePath();
    ctx.fill();
  } else if (element.type === "rule") {
    roundRect(ctx, box.x, box.y + box.h / 2 - 1.5, box.w, 3, 2);
    ctx.fill();
  } else {
    const radius = Math.min((element.radius || 0) * box.w, box.w / 2, box.h / 2);
    roundRect(ctx, box.x, box.y, box.w, box.h, radius);
    ctx.fill();
  }
}

function drawSelection(ctx, element) {
  const box = element.box;
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = "#287f91";
  ctx.lineWidth = 1.25;
  ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
  ctx.setLineDash([]);
  ctx.fillStyle = COLORS.white;
  ctx.strokeStyle = "#287f91";
  const handles = elementHandles(element);
  Object.values(handles).forEach((point) => {
    ctx.beginPath();
    ctx.rect(point.x - HANDLE_SIZE / 2, point.y - HANDLE_SIZE / 2, HANDLE_SIZE, HANDLE_SIZE);
    ctx.fill();
    ctx.stroke();
  });
  ctx.restore();
}

export function elementHandles(element) {
  const { x, y, w, h } = element.box;
  return {
    nw: { x, y },
    ne: { x: x + w, y },
    sw: { x, y: y + h },
    se: { x: x + w, y: y + h },
    n: { x: x + w / 2, y },
    s: { x: x + w / 2, y: y + h },
    w: { x, y: y + h / 2 },
    e: { x: x + w, y: y + h / 2 },
  };
}

function drawFoldCard(ctx, scene) {
  const { frame } = scene.fold;
  ctx.save();
  ctx.shadowColor = "rgba(14, 38, 31, 0.2)";
  ctx.shadowBlur = 22;
  ctx.shadowOffsetY = 7;
  ctx.fillStyle = COLORS.dark;
  roundRect(ctx, frame.x, frame.y, frame.w, frame.h, 16);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#b5d7c5";
  ctx.lineWidth = 1;
  for (let x = frame.x + 16; x < frame.x + frame.w - 8; x += 22) {
    ctx.beginPath();
    ctx.moveTo(x, frame.y + 50);
    ctx.lineTo(x, frame.y + frame.h - 12);
    ctx.stroke();
  }
  for (let y = frame.y + 56; y < frame.y + frame.h - 8; y += 22) {
    ctx.beginPath();
    ctx.moveTo(frame.x + 10, y);
    ctx.lineTo(frame.x + frame.w - 10, y);
    ctx.stroke();
  }
  ctx.restore();

  label(ctx, "LIVE FOLD", frame.x + 18, frame.y + 25, {
    size: 11,
    weight: 800,
    color: "#f6f0df",
    tracking: 0.8,
  });
  if (frame.w >= 210) {
    label(ctx, "ISOMETRIC · GLUE SEAM", frame.x + 18, frame.y + 40, {
      size: 8,
      mono: true,
      color: "rgba(224, 238, 229, 0.6)",
    });
  }
  const pill = `${Math.round(scene.fold.progress)}%`;
  ctx.save();
  ctx.font = '700 9px "DejaVu Sans Mono", monospace';
  const pillW = Math.max(44, ctx.measureText(pill).width + 18);
  roundRect(ctx, frame.x + frame.w - pillW - 16, frame.y + 16, pillW, 22, 11);
  ctx.fillStyle = scene.fold.progress >= 99 ? COLORS.yellow : "rgba(255,255,255,0.14)";
  ctx.fill();
  ctx.fillStyle = scene.fold.progress >= 99 ? COLORS.dark : "#f6f0df";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(pill, frame.x + frame.w - pillW / 2 - 16, frame.y + 27);
  ctx.restore();
}

function drawShadow(ctx, scene) {
  const { quads, transform } = scene.fold;
  const bottom = quads[0]?.points;
  if (!bottom) return;
  ctx.save();
  ctx.globalAlpha = 0.24;
  ctx.fillStyle = "#071a15";
  ctx.beginPath();
  const pts = bottom.map((point) => ({ x: point.x, y: point.y + 13 }));
  ctx.moveTo(pts[0].x, pts[0].y);
  pts.slice(1).forEach((point) => ctx.lineTo(point.x, point.y));
  ctx.closePath();
  ctx.filter = "blur(7px)";
  ctx.fill();
  ctx.restore();
  void transform;
}

function drawClosedTop(ctx, scene) {
  if (scene.fold.progress < 99.5) return;
  const top = scene.fold.top.front;
  polygon(ctx, top);
  ctx.fillStyle = "#e5c98c";
  ctx.fill();
  ctx.strokeStyle = "#b9895e";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.save();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = COLORS.accent;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(scene.fold.seamLine.x1, scene.fold.seamLine.y1);
  ctx.lineTo(scene.fold.seamLine.x2, scene.fold.seamLine.y2);
  ctx.stroke();
  ctx.restore();
}

function drawFoldGeometry(ctx, scene) {
  const { quads, flaps } = scene.fold;
  drawShadow(ctx, scene);
  ctx.save();
  quads.forEach((quad) => {
    polygon(ctx, quad.points);
    ctx.globalAlpha = quad.opacity;
    ctx.fillStyle = quad.fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = quad.stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  });
  ctx.restore();
  drawClosedTop(ctx, scene);

  flaps.forEach((flap) => {
    ctx.save();
    ctx.globalAlpha = flap.opacity;
    polygon(ctx, flap.points);
    ctx.fillStyle = flap.fill;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = flap.stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
  });

  ctx.save();
  ctx.strokeStyle = "#f0a366";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(scene.fold.glueLine.x1, scene.fold.glueLine.y1);
  ctx.lineTo(scene.fold.glueLine.x2, scene.fold.glueLine.y2);
  ctx.stroke();
  ctx.restore();
}

function drawFoldAnnotations(ctx, scene) {
  const { frame, dimensions, progress } = scene.fold;
  const d = scene.flat.dieline;
  if (frame.w < 235) {
    label(
      ctx,
      `${dimensions.length} × ${dimensions.width} × ${dimensions.height} mm`,
      frame.x + 18,
      frame.y + frame.h - 35,
      { size: 8, mono: true, color: "rgba(229,239,232,0.62)" },
    );
  } else {
    label(
      ctx,
      `L ${formatMm(dimensions.length)}  ·  W ${formatMm(dimensions.width)}`,
      frame.x + 18,
      frame.y + frame.h - 35,
      { size: 8, mono: true, color: "rgba(229,239,232,0.62)" },
    );
    label(ctx, `H ${formatMm(dimensions.height)}`, frame.x + frame.w - 18, frame.y + frame.h - 35, {
      size: 8,
      mono: true,
      color: "rgba(229,239,232,0.62)",
      align: "right",
    });
  }
  const closed = progress >= 99.5;
  ctx.save();
  ctx.font = '700 8px "DejaVu Sans Mono", monospace';
  const text = closed ? "✓  SEAM CLOSED" : "FOLD IN PROGRESS";
  const width = ctx.measureText(text).width + 22;
  roundRect(ctx, frame.x + 16, frame.y + frame.h - 24, width, 16, 8);
  ctx.fillStyle = closed ? "rgba(244,201,93,0.2)" : "rgba(255,255,255,0.08)";
  ctx.fill();
  ctx.fillStyle = closed ? COLORS.yellow : "rgba(229,239,232,0.72)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, frame.x + 16 + width / 2, frame.y + frame.h - 15.5);
  ctx.restore();
  void d;
}

function drawOverflowBadge(ctx, scene) {
  if (!scene.flat.textIssues.length) return;
  const box = scene.flat.frame;
  const text = `${scene.flat.textIssues.length} TEXT OVERFLOW`;
  ctx.save();
  ctx.font = '700 8px "DejaVu Sans Mono", monospace';
  const width = ctx.measureText(text).width + 18;
  roundRect(ctx, box.x + box.w - width - 16, box.y + box.h - 29, width, 17, 8);
  ctx.fillStyle = "rgba(228, 87, 46, 0.14)";
  ctx.fill();
  ctx.fillStyle = COLORS.accent;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, box.x + box.w - width / 2 - 16, box.y + box.h - 20.5);
  ctx.restore();
}

export function renderScene(canvas, scene, options = {}) {
  const ctx = canvas.getContext("2d");
  const dpr = options.dpr || 1;
  if (!options.skipResize) {
    canvas.width = Math.max(1, Math.round(scene.width * dpr));
    canvas.height = Math.max(1, Math.round(scene.height * dpr));
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  ctx.fillStyle = COLORS.canvas;
  ctx.fillRect(0, 0, scene.width, scene.height);
  drawDots(ctx, scene);
  drawFlatCard(ctx, scene);
  drawFoldCard(ctx, scene);
  drawPaper(ctx, scene, scene.state.view.showSafeAreas);
  scene.flat.elements.forEach((element) => {
    drawElement(ctx, element, options.images || new Map(), element.id === options.selectedId);
  });
  drawFoldGeometry(ctx, scene);
  drawFoldAnnotations(ctx, scene);
  drawOverflowBadge(ctx, scene);
  return ctx;
}
