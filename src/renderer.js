export class ImageCache {
  constructor() {
    this.entries = new Map();
  }

  async loadAll(scene) {
    const images = scene.drawables.filter((item) => item.kind === "image");
    const urls = [...new Set(images.map((item) => item.dataUrl).filter(Boolean))];
    await Promise.all(urls.map((url) => this.load(url)));
    return this;
  }

  load(url) {
    if (this.entries.has(url)) return this.entries.get(url).promise;
    const entry = { image: null, promise: null };
    entry.promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        entry.image = image;
        resolve(image);
      };
      image.onerror = () => reject(new Error("图片资源无法解码。"));
      image.src = url;
    }).catch((error) => {
      entry.error = error;
      throw error;
    });
    this.entries.set(url, entry);
    return entry.promise;
  }

  getSync(url) {
    return this.entries.get(url)?.image || null;
  }
}

function drawSceneShape(ctx, item, scene, imageCache) {
  ctx.save();
  ctx.globalAlpha = (item.opacity ?? 1) * (scene.inkOpacity ?? 1);
  ctx.fillStyle = item.color || scene.color;
  ctx.strokeStyle = item.color || scene.color;
  if (item.kind === "arc") {
    ctx.beginPath();
    ctx.arc(item.cx, item.cy, Math.max(0.01, item.radius), item.start, item.end);
    ctx.lineWidth = item.width;
    ctx.lineCap = item.lineCap || "butt";
    ctx.stroke();
  } else if (item.kind === "line") {
    ctx.beginPath();
    ctx.moveTo(item.x1, item.y1);
    ctx.lineTo(item.x2, item.y2);
    ctx.lineWidth = item.width;
    ctx.lineCap = item.lineCap || "round";
    ctx.stroke();
  } else if (item.kind === "circle") {
    ctx.beginPath();
    ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    if (item.filled === false) {
      ctx.lineWidth = item.width || 1;
      ctx.stroke();
    } else {
      ctx.fill();
    }
  } else if (item.kind === "polygon") {
    if (!item.points?.length) {
      ctx.restore();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(item.points[0].x, item.points[0].y);
    for (const point of item.points.slice(1)) {
      ctx.lineTo(point.x, point.y);
    }
    ctx.closePath();
    if (item.filled === false) {
      ctx.lineWidth = item.width || 1;
      ctx.stroke();
    } else {
      ctx.fill();
    }
  } else if (item.kind === "glyph") {
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation || 0);
    ctx.font = `${item.fontWeight || 600} ${item.fontSize}px ${item.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(item.text, 0, 0);
  } else if (item.kind === "image") {
    const image = imageCache?.getSync(item.dataUrl);
    if (!image) {
      ctx.restore();
      return;
    }
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation || 0);
    ctx.drawImage(image, -item.width / 2, -item.height / 2, item.width, item.height);
  }
  ctx.restore();
}

function drawWear(ctx, scene) {
  const { spots, scratches } = scene.wear;
  if (!spots.length && !scratches.length) return;
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = "#000";
  ctx.strokeStyle = "#000";
  for (const spot of spots) {
    ctx.globalAlpha = spot.alpha;
    ctx.beginPath();
    ctx.arc(spot.x, spot.y, spot.r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const scratch of scratches) {
    ctx.globalAlpha = scratch.alpha;
    ctx.beginPath();
    ctx.moveTo(scratch.x1, scratch.y1);
    ctx.lineTo(scratch.x2, scratch.y2);
    ctx.lineWidth = scratch.width;
    ctx.lineCap = "round";
    ctx.stroke();
  }
  ctx.restore();
}

export function drawScene(ctx, scene, options = {}) {
  const scale = options.scale ?? 1;
  const offsetX = options.offsetX ?? 0;
  const offsetY = options.offsetY ?? 0;
  const imageCache = options.imageCache;

  ctx.save();
  if (options.clear !== false) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  if (options.background) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  for (const item of scene.drawables) {
    drawSceneShape(ctx, item, scene, imageCache);
  }
  if (options.wear !== false) {
    drawWear(ctx, scene);
  }
  ctx.restore();
}

export function drawGuides(ctx, scene, view) {
  const { scale, offsetX, offsetY } = view;
  const center = scene.center;
  const safeRadius = scene.width / 2 - scene.model.document.safeMargin;
  const clipRadius = scene.width / 2;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([5 / scale, 5 / scale]);
  ctx.strokeStyle = "rgba(215, 198, 179, 0.34)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, safeRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([2 / scale, 5 / scale]);
  ctx.strokeStyle = "rgba(205, 102, 91, 0.25)";
  ctx.beginPath();
  ctx.arc(center.x, center.y, clipRadius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

export function drawSelection(ctx, scene, group, view) {
  if (!group?.bounds) return;
  const { scale, offsetX, offsetY } = view;
  const bounds = group.bounds;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  ctx.lineWidth = 1.25 / scale;
  ctx.strokeStyle = "rgba(239, 111, 96, 0.94)";
  ctx.setLineDash([]);
  ctx.strokeRect(
    bounds.minX - 4 / scale,
    bounds.minY - 4 / scale,
    bounds.width + 8 / scale,
    bounds.height + 8 / scale
  );
  const handleSize = 6 / scale;
  ctx.fillStyle = "#f4e8e1";
  ctx.strokeStyle = "#c95247";
  for (const [x, y] of [
    [bounds.minX - 4 / scale, bounds.minY - 4 / scale],
    [bounds.maxX + 4 / scale, bounds.minY - 4 / scale],
    [bounds.maxX + 4 / scale, bounds.maxY + 4 / scale],
    [bounds.minX - 4 / scale, bounds.maxY + 4 / scale]
  ]) {
    ctx.fillRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
    ctx.strokeRect(x - handleSize / 2, y - handleSize / 2, handleSize, handleSize);
  }
  ctx.restore();
}

export function scenePointFromScreen(screenX, screenY, view) {
  return {
    x: (screenX - view.offsetX) / view.scale,
    y: (screenY - view.offsetY) / view.scale
  };
}

export function hitTestScene(scene, point, padding = 6) {
  for (let index = scene.groups.length - 1; index >= 0; index -= 1) {
    const group = scene.groups[index];
    if (!group.bounds) continue;
    const bounds = group.bounds;
    if (
      point.x >= bounds.minX - padding
      && point.x <= bounds.maxX + padding
      && point.y >= bounds.minY - padding
      && point.y <= bounds.maxY + padding
    ) {
      return group;
    }
  }
  return null;
}

export async function renderExportCanvas(scene, imageCache, scale = 2) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(scene.width * scale));
  canvas.height = Math.max(1, Math.round(scene.height * scale));
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  drawScene(ctx, scene, {
    scale: canvas.width / scene.width,
    imageCache,
    background: null
  });
  return canvas;
}
