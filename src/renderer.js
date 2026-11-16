import { clamp, createRng, shadeColor } from "./model.js";

function path2d(path) {
  return new Path2D(path);
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function glassGradient(ctx, color, bounds) {
  const gradient = ctx.createLinearGradient(
    bounds.left,
    bounds.top,
    bounds.right,
    bounds.bottom
  );
  gradient.addColorStop(0, shadeColor(color, 0.28));
  gradient.addColorStop(0.44, color);
  gradient.addColorStop(1, shadeColor(color, -0.24));
  return gradient;
}

function radialGlow(ctx, scene, radius) {
  const { center, light } = scene;
  const x = center.x + (light.x - 0.5) * radius * 1.5;
  const y = center.y + (light.y - 0.44) * radius * 1.5;
  const gradient = ctx.createRadialGradient(x, y, radius * 0.03, x, y, radius * 1.15);
  gradient.addColorStop(0, `${light.color}dd`);
  gradient.addColorStop(0.38, `${light.color}70`);
  gradient.addColorStop(0.78, "#27304426");
  gradient.addColorStop(1, "#080b1200");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, scene.width, scene.height);
}

function drawBoard(ctx, scene) {
  const background = ctx.createLinearGradient(0, 0, scene.width, scene.height);
  background.addColorStop(0, "#1b1e26");
  background.addColorStop(0.5, "#13161d");
  background.addColorStop(1, "#0f1117");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, scene.width, scene.height);

  ctx.save();
  const vignette = ctx.createRadialGradient(
    scene.width * 0.5,
    scene.height * 0.36,
    scene.width * 0.08,
    scene.width * 0.5,
    scene.height * 0.45,
    scene.width * 0.85
  );
  vignette.addColorStop(0, "rgba(78,83,95,.22)");
  vignette.addColorStop(0.52, "rgba(31,34,43,.08)");
  vignette.addColorStop(1, "rgba(0,0,0,.36)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, scene.width, scene.height);

  const rng = createRng(scene.state.seed ^ 0x9e3779b9);
  for (let index = 0; index < 360; index += 1) {
    const x = rng() * scene.width;
    const y = rng() * scene.height;
    const alpha = 0.025 + rng() * 0.03;
    ctx.fillStyle = `rgba(235,221,188,${alpha})`;
    ctx.fillRect(x, y, rng() > 0.7 ? 1.6 : 0.8, 0.8);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(207,184,135,.09)";
  ctx.lineWidth = 1;
  ctx.strokeRect(18.5, 18.5, scene.width - 37, scene.height - 37);
  ctx.strokeStyle = "rgba(207,184,135,.035)";
  ctx.strokeRect(26.5, 26.5, scene.width - 53, scene.height - 53);
}

function drawBacklight(ctx, scene) {
  ctx.save();
  radialGlow(ctx, scene, scene.radius);
  ctx.restore();
}

function drawCoverImage(ctx, image, scene) {
  if (!image || !image.naturalWidth) return;
  const { x, y, width, height } = scene.image;
  const state = scene.image;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  const targetRatio = width / height;
  let sourceWidth = image.naturalWidth;
  let sourceHeight = image.naturalHeight;
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio;
  } else {
    sourceHeight = image.naturalWidth / targetRatio;
  }
  const scale = state.scale;
  sourceWidth /= scale;
  sourceHeight /= scale;
  const sourceX = (image.naturalWidth - sourceWidth) / 2 - state.offsetX / scale;
  const sourceY = (image.naturalHeight - sourceHeight) / 2 - state.offsetY / scale;
  ctx.save();
  ctx.beginPath();
  ctx.arc(scene.center.x, scene.center.y, scene.radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalAlpha = state.opacity;
  ctx.globalCompositeOperation = "screen";
  ctx.filter = "saturate(.58) contrast(1.08)";
  ctx.drawImage(
    image,
    clamp(sourceX, 0, image.naturalWidth - sourceWidth),
    clamp(sourceY, 0, image.naturalHeight - sourceHeight),
    sourceWidth,
    sourceHeight,
    x,
    y,
    width,
    height
  );
  ctx.restore();
}

function drawGlass(ctx, scene) {
  const border = scene.state.window.border;
  const opacity = scene.state.window.glassOpacity;
  ctx.save();
  ctx.globalAlpha = opacity;
  for (const cell of scene.rings) {
    const path = path2d(cell.path);
    ctx.fillStyle = glassGradient(ctx, cell.color, cell.bounds);
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const cell of scene.rings) {
    const path = path2d(cell.path);
    ctx.strokeStyle = "#151613";
    ctx.lineWidth = border;
    ctx.stroke(path);
  }
  ctx.restore();
}

function drawCentral(ctx, scene) {
  const border = scene.state.window.border;
  const backing = scene.central.backing;
  const backingGradient = ctx.createRadialGradient(
    backing.x - backing.radius * 0.22,
    backing.y - backing.radius * 0.28,
    2,
    backing.x,
    backing.y,
    backing.radius
  );
  backingGradient.addColorStop(0, shadeColor(backing.color, 0.2));
  backingGradient.addColorStop(0.55, shadeColor(backing.color, -0.5));
  backingGradient.addColorStop(1, "#282a25");
  ctx.save();
  ctx.beginPath();
  ctx.arc(backing.x, backing.y, backing.radius, 0, Math.PI * 2);
  ctx.fillStyle = backingGradient;
  ctx.globalAlpha = scene.state.window.glassOpacity;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#151613";
  ctx.lineWidth = Math.max(1.4, border * 0.88);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.8, border * 0.38);
  for (let spoke = 0; spoke < 12; spoke += 1) {
    const angle = (spoke / 12) * Math.PI * 2 + Math.PI / 24;
    ctx.beginPath();
    ctx.moveTo(backing.x, backing.y);
    ctx.lineTo(
      backing.x + Math.cos(angle) * backing.radius,
      backing.y + Math.sin(angle) * backing.radius
    );
    ctx.stroke();
  }
  for (const ratio of [0.46, 0.74]) {
    ctx.beginPath();
    ctx.arc(backing.x, backing.y, backing.radius * ratio, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
  const clip = path2d(scene.central.clipPath);
  ctx.save();
  ctx.clip(clip);
  ctx.globalAlpha = scene.state.window.glassOpacity;
  for (const cell of scene.central.cells) {
    const path = path2d(cell.path);
    ctx.fillStyle = glassGradient(ctx, cell.color, cell.bounds);
    ctx.fill(path);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = "center";
  for (const cell of scene.central.cells) {
    const path = path2d(cell.path);
    ctx.strokeStyle = "#151613";
    ctx.lineWidth = Math.max(1.1, border * 0.72);
    ctx.stroke(path);
  }
  ctx.restore();

  const corePath = path2d(scene.central.core.path);
  const coreGradient = ctx.createRadialGradient(
    scene.central.core.bounds.left + scene.central.core.bounds.width * 0.34,
    scene.central.core.bounds.top + scene.central.core.bounds.height * 0.28,
    1,
    scene.centralCenter.x,
    scene.centralCenter.y,
    Math.max(3, scene.central.core.bounds.width / 2)
  );
  coreGradient.addColorStop(0, shadeColor(scene.central.core.color, 0.42));
  coreGradient.addColorStop(0.56, scene.central.core.color);
  coreGradient.addColorStop(1, shadeColor(scene.central.core.color, -0.34));
  ctx.fillStyle = coreGradient;
  ctx.globalAlpha = scene.state.window.glassOpacity;
  ctx.fill(corePath);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#151613";
  ctx.lineWidth = Math.max(1.2, border * 0.9);
  ctx.stroke(corePath);

  ctx.strokeStyle = "#171814";
  ctx.lineWidth = Math.max(1.8, border * 0.92);
  ctx.stroke(clip);
  ctx.strokeStyle = "rgba(236,216,166,.22)";
  ctx.lineWidth = 0.7;
  ctx.stroke(clip);
}

function drawLightOverlay(ctx, scene) {
  const { center, radius, light } = scene;
  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.globalCompositeOperation = "screen";
  const lightX = center.x + (light.x - 0.5) * radius * 1.45;
  const lightY = center.y + (light.y - 0.44) * radius * 1.45;
  const glow = ctx.createRadialGradient(lightX, lightY, 0, lightX, lightY, radius * 1.02);
  glow.addColorStop(0, `${light.color}${Math.round(light.intensity * 150).toString(16).padStart(2, "0")}`);
  glow.addColorStop(0.45, `${light.color}3b`);
  glow.addColorStop(1, "#00000000");
  ctx.fillStyle = glow;
  ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);

  const sheen = ctx.createLinearGradient(
    center.x - radius * 0.8,
    center.y - radius,
    center.x + radius * 0.5,
    center.y + radius
  );
  sheen.addColorStop(0, "rgba(255,255,255,.16)");
  sheen.addColorStop(0.35, "rgba(255,255,255,.03)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.clip();
  const edge = ctx.createRadialGradient(
    center.x,
    center.y,
    radius * 0.62,
    center.x,
    center.y,
    radius
  );
  edge.addColorStop(0, "rgba(0,0,0,0)");
  edge.addColorStop(0.8, "rgba(0,0,0,.04)");
  edge.addColorStop(0.96, "rgba(0,0,0,.34)");
  edge.addColorStop(1, "rgba(0,0,0,.52)");
  ctx.fillStyle = edge;
  ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  ctx.restore();
}

function drawFrame(ctx, scene) {
  const { center, radius } = scene;
  const stroke = scene.window.frameStroke;
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.82)";
  ctx.shadowBlur = 54;
  ctx.shadowOffsetY = 24;
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius + stroke * 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = "#0d0e0c";
  ctx.lineWidth = stroke;
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#11120f";
  ctx.lineWidth = stroke * 0.95;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius + stroke * 0.33, 0, Math.PI * 2);
  ctx.strokeStyle = "#5b5546";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius + stroke * 0.63, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(218,190,126,.4)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(center.x, center.y, radius - stroke * 0.47, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(236,215,164,.16)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
}

function drawLetterSpacedText(ctx, node) {
  const characters = Array.from(node.text);
  const widths = characters.map((character) => ctx.measureText(character).width);
  const total = widths.reduce((sum, width) => sum + width, 0) +
    Math.max(0, characters.length - 1) * node.letterSpacing;
  let x = node.align === "center" ? node.x - total / 2 : node.x;
  ctx.textAlign = "left";
  for (let index = 0; index < characters.length; index += 1) {
    ctx.fillText(characters[index], x, node.baseline);
    x += widths[index] + node.letterSpacing;
  }
}

function drawTypography(ctx, scene) {
  const { typography, state } = scene;
  const drawNode = (node) => {
    if (!node || !node.text) return;
    ctx.save();
    ctx.font = `${node.weight} ${node.size}px ${node.family}`;
    ctx.fillStyle = node.color;
    ctx.shadowColor = "rgba(0,0,0,.62)";
    ctx.shadowBlur = node.role === "title" ? 18 : 8;
    ctx.shadowOffsetY = 2;
    drawLetterSpacedText(ctx, node);
    ctx.restore();
  };

  if (state.layers.title) typography.titleNodes.forEach(drawNode);
  if (state.layers.subtitle && typography.subtitleNode) {
    ctx.save();
    ctx.strokeStyle = "rgba(214,190,132,.52)";
    ctx.fillStyle = "rgba(214,190,132,.72)";
    ctx.lineWidth = 0.8;
    const divider = typography.divider;
    ctx.beginPath();
    ctx.moveTo(divider.x - divider.width, divider.y);
    ctx.lineTo(divider.x - 8, divider.y);
    ctx.moveTo(divider.x + 8, divider.y);
    ctx.lineTo(divider.x + divider.width, divider.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(divider.x, divider.y - 3.2);
    ctx.lineTo(divider.x + 3.2, divider.y);
    ctx.lineTo(divider.x, divider.y + 3.2);
    ctx.lineTo(divider.x - 3.2, divider.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    drawNode(typography.subtitleNode);
  }
  if (state.layers.footer) drawNode(typography.footerNode);
}

function drawSafeArea(ctx, scene, hasErrors) {
  const safe = scene.safeRect;
  ctx.save();
  ctx.setLineDash([7, 7]);
  ctx.strokeStyle = hasErrors ? "rgba(244,126,116,.9)" : "rgba(225,192,124,.48)";
  ctx.lineWidth = 1;
  ctx.strokeRect(safe.left, safe.top, safe.width, safe.height);
  ctx.setLineDash([]);
  const arm = 13;
  const corners = [
    [safe.left, safe.top, 1, 1],
    [safe.right, safe.top, -1, 1],
    [safe.left, safe.bottom, 1, -1],
    [safe.right, safe.bottom, -1, -1]
  ];
  ctx.strokeStyle = hasErrors ? "rgba(244,126,116,.95)" : "rgba(225,192,124,.8)";
  ctx.lineWidth = 1.5;
  for (const [x, y, dx, dy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + dx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + dy * arm);
    ctx.stroke();
  }
  ctx.restore();
}

function drawSelection(ctx, scene, selection) {
  if (!selection) return;
  let bounds;
  if (selection === "center") {
    bounds = scene.central.bounds;
  } else {
    const nodes = selection === "title"
      ? scene.typography.titleNodes
      : [scene.typography.subtitleNode].filter(Boolean);
    if (!nodes.length) return;
    const left = Math.min(...nodes.map((node) => node.bounds.left));
    const top = Math.min(...nodes.map((node) => node.bounds.top));
    const right = Math.max(...nodes.map((node) => node.bounds.right));
    const bottom = Math.max(...nodes.map((node) => node.bounds.bottom));
    bounds = {
      left: left - 10,
      top: top - 8,
      right: right + 10,
      bottom: bottom + 8
    };
  }
  ctx.save();
  ctx.strokeStyle = "rgba(225,184,94,.95)";
  ctx.lineWidth = 1.1;
  ctx.setLineDash([5, 4]);
  ctx.strokeRect(
    bounds.left - 5,
    bounds.top - 5,
    bounds.right - bounds.left + 10,
    bounds.bottom - bounds.top + 10
  );
  ctx.setLineDash([]);
  const size = 5;
  ctx.fillStyle = "#e0b85d";
  for (const [x, y] of [
    [bounds.left - 5, bounds.top - 5],
    [bounds.right + 5, bounds.top - 5],
    [bounds.left - 5, bounds.bottom + 5],
    [bounds.right + 5, bounds.bottom + 5]
  ]) {
    ctx.fillRect(x - size / 2, y - size / 2, size, size);
  }
  ctx.restore();
}

function drawBoardLabel(ctx, scene) {
  ctx.save();
  ctx.font = '600 8px "Courier New", monospace';
  ctx.fillStyle = "rgba(225,205,166,.33)";
  ctx.letterSpacing = "1.5px";
  ctx.fillText("AURELIA / LIGHT STUDY", 32, 42);
  ctx.textAlign = "right";
  ctx.fillText(
    `${scene.state.canvas.width} × ${scene.state.canvas.height}`,
    scene.width - 32,
    42
  );
  ctx.strokeStyle = "rgba(225,205,166,.16)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(32, 52);
  ctx.lineTo(scene.width - 32, 52);
  ctx.stroke();
  ctx.restore();
}

export function renderScene(canvas, scene, options = {}) {
  const pixelRatio = options.pixelRatio || Math.min(window.devicePixelRatio || 1, 2);
  const targetWidth = Math.round(scene.width * pixelRatio);
  const targetHeight = Math.round(scene.height * pixelRatio);
  if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
    canvas.width = targetWidth;
    canvas.height = targetHeight;
  }
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  ctx.clearRect(0, 0, scene.width, scene.height);
  drawBoard(ctx, scene);
  drawBacklight(ctx, scene);
  if (options.imageElement && scene.state.layers.image) {
    drawCoverImage(ctx, options.imageElement, scene);
  }
  if (scene.state.layers.rings) drawGlass(ctx, scene);
  if (scene.state.layers.center) drawCentral(ctx, scene);
  if (scene.state.layers.glow) drawLightOverlay(ctx, scene);
  drawFrame(ctx, scene);
  drawBoardLabel(ctx, scene);
  drawTypography(ctx, scene);
  if (options.showSafe) drawSafeArea(ctx, scene, options.hasErrors);
  drawSelection(ctx, scene, options.selection);
  return {
    width: scene.width,
    height: scene.height,
    pixelRatio,
    cells: scene.stats.totalCells
  };
}

export function canvasPointFromEvent(event, canvas, scene) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * scene.width,
    y: ((event.clientY - rect.top) / rect.height) * scene.height
  };
}
