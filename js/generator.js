export const TEMPLATES = Object.freeze({
  "dune-dusk": {
    id: "dune-dusk",
    name: "暮色沙丘",
    description: "暖光沙丘与低垂的太阳",
    accent: "#d6a557",
  },
  "tidal-blue": {
    id: "tidal-blue",
    name: "潮汐蓝调",
    description: "冷雾海面与月升",
    accent: "#6e94a7",
  },
});

export function mulberry32(seed) {
  let state = Number(seed) >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function fillLine(ctx, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
}

function addVignette(ctx, width, height, strength) {
  const gradient = ctx.createRadialGradient(
    width * 0.5,
    height * 0.44,
    width * 0.22,
    width * 0.5,
    height * 0.5,
    width * 0.9,
  );
  gradient.addColorStop(0, "rgba(16, 12, 8, 0)");
  gradient.addColorStop(0.7, `rgba(16, 12, 8, ${strength * 0.24})`);
  gradient.addColorStop(1, `rgba(10, 8, 6, ${strength})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function addFilmGrain(ctx, width, height, seed, amount) {
  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const random = mulberry32(seed ^ 0x9e3779b9);
  for (let index = 0; index < data.length; index += 4) {
    const noise = (random() - 0.5) * amount;
    data[index] = Math.max(0, Math.min(255, data[index] + noise));
    data[index + 1] = Math.max(0, Math.min(255, data[index + 1] + noise));
    data[index + 2] = Math.max(0, Math.min(255, data[index + 2] + noise));
  }
  ctx.putImageData(image, 0, 0);
}

export function drawDuneDusk(ctx, width, height, seed) {
  const random = mulberry32(seed);
  const horizon = height * 0.55;
  const sunX = width * (0.68 + random() * 0.06);
  const sunY = height * (0.26 + random() * 0.03);
  const sunRadius = width * 0.115;

  const sky = ctx.createLinearGradient(0, 0, 0, horizon * 1.12);
  sky.addColorStop(0, "#7f786b");
  sky.addColorStop(0.24, "#c7a783");
  sky.addColorStop(0.56, "#dfb987");
  sky.addColorStop(0.82, "#d7a172");
  sky.addColorStop(1, "#c68c5e");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, width * 0.54);
  glow.addColorStop(0, "rgba(255, 241, 205, 0.84)");
  glow.addColorStop(0.12, "rgba(245, 210, 154, 0.58)");
  glow.addColorStop(0.4, "rgba(226, 173, 111, 0.18)");
  glow.addColorStop(1, "rgba(226, 173, 111, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, horizon);

  const sun = ctx.createRadialGradient(
    sunX - sunRadius * 0.35,
    sunY - sunRadius * 0.3,
    0,
    sunX,
    sunY,
    sunRadius,
  );
  sun.addColorStop(0, "#fff7dd");
  sun.addColorStop(0.55, "#f7dfae");
  sun.addColorStop(1, "rgba(244, 209, 150, 0.72)");
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sunX, sunY, sunRadius, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 0.2;
  for (let layer = 0; layer < 4; layer += 1) {
    const cloudY = horizon * (0.24 + layer * 0.115) + random() * 12;
    const cloudWidth = width * (0.24 + random() * 0.42);
    const cloudX = width * random() * 0.7 - width * 0.08;
    ctx.fillStyle = layer % 2 ? "#e7c69a" : "#f4ddb5";
    ctx.beginPath();
    ctx.ellipse(cloudX + cloudWidth / 2, cloudY, cloudWidth / 2, 7 + layer * 2, -0.06, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(98, 68, 50, 0.35)";
  ctx.beginPath();
  ctx.moveTo(0, horizon * 0.93);
  ctx.bezierCurveTo(width * 0.15, horizon * 0.71, width * 0.23, horizon * 0.8, width * 0.36, horizon * 0.71);
  ctx.bezierCurveTo(width * 0.52, horizon * 0.6, width * 0.63, horizon * 0.75, width * 0.78, horizon * 0.68);
  ctx.bezierCurveTo(width * 0.9, horizon * 0.64, width * 0.96, horizon * 0.7, width, horizon * 0.65);
  ctx.lineTo(width, horizon);
  ctx.lineTo(0, horizon);
  ctx.closePath();
  ctx.fill();

  const backDune = ctx.createLinearGradient(0, horizon * 0.84, 0, height * 0.75);
  backDune.addColorStop(0, "#bd895e");
  backDune.addColorStop(0.58, "#a56e4b");
  backDune.addColorStop(1, "#8b593d");
  ctx.fillStyle = backDune;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.68);
  ctx.bezierCurveTo(width * 0.2, height * 0.51, width * 0.31, height * 0.54, width * 0.45, height * 0.63);
  ctx.bezierCurveTo(width * 0.61, height * 0.73, width * 0.76, height * 0.48, width, height * 0.58);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  const rearRidge = ctx.createLinearGradient(width * 0.2, 0, width * 0.8, 0);
  rearRidge.addColorStop(0, "rgba(247, 211, 159, 0.1)");
  rearRidge.addColorStop(0.5, "rgba(247, 211, 159, 0.35)");
  rearRidge.addColorStop(1, "rgba(84, 53, 37, 0)");
  ctx.strokeStyle = rearRidge;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.68);
  ctx.bezierCurveTo(width * 0.2, height * 0.51, width * 0.31, height * 0.54, width * 0.45, height * 0.63);
  ctx.bezierCurveTo(width * 0.61, height * 0.73, width * 0.76, height * 0.48, width, height * 0.58);
  ctx.stroke();

  const middleDune = ctx.createLinearGradient(0, height * 0.63, 0, height);
  middleDune.addColorStop(0, "#8b5b3e");
  middleDune.addColorStop(0.4, "#70462f");
  middleDune.addColorStop(1, "#432b20");
  ctx.fillStyle = middleDune;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.83);
  ctx.bezierCurveTo(width * 0.2, height * 0.64, width * 0.38, height * 0.72, width * 0.52, height * 0.8);
  ctx.bezierCurveTo(width * 0.67, height * 0.9, width * 0.8, height * 0.63, width, height * 0.75);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(243, 193, 133, 0.25)";
  ctx.lineWidth = height * 0.0024;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.83);
  ctx.bezierCurveTo(width * 0.2, height * 0.64, width * 0.38, height * 0.72, width * 0.52, height * 0.8);
  ctx.bezierCurveTo(width * 0.67, height * 0.9, width * 0.8, height * 0.63, width, height * 0.75);
  ctx.stroke();

  const foreground = ctx.createLinearGradient(0, height * 0.77, 0, height);
  foreground.addColorStop(0, "#765038");
  foreground.addColorStop(0.5, "#4c3224");
  foreground.addColorStop(1, "#231812");
  ctx.fillStyle = foreground;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.91);
  ctx.bezierCurveTo(width * 0.22, height * 0.79, width * 0.31, height * 0.9, width * 0.48, height * 0.84);
  ctx.bezierCurveTo(width * 0.68, height * 0.76, width * 0.82, height * 0.91, width, height * 0.82);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fill();

  fillLine(ctx, "rgba(242, 192, 134, 0.18)", width * 0.002);
  ctx.beginPath();
  ctx.moveTo(width * 0.1, height * 0.91);
  ctx.bezierCurveTo(width * 0.25, height * 0.84, width * 0.37, height * 0.93, width * 0.5, height * 0.88);
  ctx.bezierCurveTo(width * 0.65, height * 0.82, width * 0.78, height * 0.91, width * 0.95, height * 0.85);
  ctx.stroke();

  for (let index = 0; index < 12; index += 1) {
    const x = width * (0.03 + random() * 0.93);
    const y = height * (0.8 + random() * 0.18);
    ctx.strokeStyle = `rgba(231, 180, 124, ${0.03 + random() * 0.06})`;
    ctx.lineWidth = 1 + random() * 1.4;
    ctx.beginPath();
    ctx.bezierCurveTo(
      x - width * 0.08,
      y - height * 0.01,
      x + width * 0.03,
      y + height * 0.012,
      x + width * 0.1,
      y - height * 0.005,
    );
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(48, 34, 25, 0.72)";
  const birds = [
    [0.47, 0.28, 0.012],
    [0.52, 0.31, 0.009],
    [0.44, 0.34, 0.007],
  ];
  for (const [x, y, size] of birds) {
    ctx.beginPath();
    ctx.quadraticCurveTo(width * (x - size / 2), height * y, width * x, height * (y + size / 3));
    ctx.quadraticCurveTo(width * (x + size / 2), height * y, width * x + width * size, height * (y + size / 5));
    ctx.strokeStyle = "rgba(48, 34, 25, 0.72)";
    ctx.lineWidth = Math.max(1, width * 0.0015);
    ctx.stroke();
  }

  addVignette(ctx, width, height, 0.58);
  addFilmGrain(ctx, width, height, seed, 12);
}

export function drawTidalBlue(ctx, width, height, seed) {
  const random = mulberry32(seed);
  const horizon = height * 0.53;
  const moonX = width * (0.25 + random() * 0.05);
  const moonY = height * (0.22 + random() * 0.04);

  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, "#0c1722");
  sky.addColorStop(0.4, "#203445");
  sky.addColorStop(0.78, "#53636c");
  sky.addColorStop(1, "#a58e7f");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const haze = ctx.createLinearGradient(0, horizon * 0.62, 0, horizon);
  haze.addColorStop(0, "rgba(192, 167, 148, 0)");
  haze.addColorStop(1, "rgba(192, 167, 148, 0.45)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, horizon * 0.62, width, horizon * 0.38);

  const moonGlow = ctx.createRadialGradient(moonX, moonY, 0, moonX, moonY, width * 0.3);
  moonGlow.addColorStop(0, "rgba(235, 237, 220, 0.7)");
  moonGlow.addColorStop(0.14, "rgba(198, 211, 205, 0.3)");
  moonGlow.addColorStop(1, "rgba(139, 170, 175, 0)");
  ctx.fillStyle = moonGlow;
  ctx.fillRect(0, 0, width, horizon);

  ctx.fillStyle = "#e6e6d8";
  ctx.beginPath();
  ctx.arc(moonX, moonY, width * 0.047, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "rgba(17, 29, 38, 0.52)";
  ctx.beginPath();
  ctx.moveTo(0, horizon * 0.84);
  ctx.bezierCurveTo(width * 0.1, horizon * 0.64, width * 0.18, horizon * 0.74, width * 0.28, horizon * 0.68);
  ctx.bezierCurveTo(width * 0.44, horizon * 0.58, width * 0.53, horizon * 0.7, width * 0.68, horizon * 0.64);
  ctx.bezierCurveTo(width * 0.8, horizon * 0.59, width * 0.9, horizon * 0.7, width, horizon * 0.64);
  ctx.lineTo(width, horizon);
  ctx.lineTo(0, horizon);
  ctx.closePath();
  ctx.fill();

  const sea = ctx.createLinearGradient(0, horizon, 0, height);
  sea.addColorStop(0, "#59696c");
  sea.addColorStop(0.21, "#344c58");
  sea.addColorStop(0.55, "#182c37");
  sea.addColorStop(1, "#0a151d");
  ctx.fillStyle = sea;
  ctx.fillRect(0, horizon, width, height - horizon);

  const reflection = ctx.createLinearGradient(0, horizon, 0, height * 0.86);
  reflection.addColorStop(0, "rgba(214, 210, 185, 0.24)");
  reflection.addColorStop(1, "rgba(214, 210, 185, 0)");
  ctx.fillStyle = reflection;
  ctx.beginPath();
  ctx.moveTo(moonX - width * 0.08, horizon);
  ctx.lineTo(moonX + width * 0.1, horizon);
  ctx.lineTo(moonX + width * 0.23, height * 0.88);
  ctx.lineTo(moonX - width * 0.2, height * 0.88);
  ctx.closePath();
  ctx.fill();

  for (let layer = 0; layer < 9; layer += 1) {
    const y = horizon + ((height - horizon) * (layer + 1)) / 12;
    const spread = width * (0.15 + layer * 0.035);
    ctx.strokeStyle = `rgba(194, 206, 198, ${0.13 - layer * 0.009})`;
    ctx.lineWidth = Math.max(1, height * 0.0014);
    ctx.beginPath();
    ctx.moveTo(moonX - spread, y);
    ctx.bezierCurveTo(
      moonX - spread * 0.2,
      y - height * 0.008,
      moonX + spread * 0.35,
      y + height * 0.008,
      moonX + spread * 1.2,
      y,
    );
    ctx.stroke();
  }

  const leftCliff = ctx.createLinearGradient(0, 0, width * 0.48, 0);
  leftCliff.addColorStop(0, "#111c22");
  leftCliff.addColorStop(0.54, "#26343a");
  leftCliff.addColorStop(1, "rgba(50, 64, 67, 0.48)");
  ctx.fillStyle = leftCliff;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.47);
  ctx.lineTo(width * 0.08, height * 0.44);
  ctx.lineTo(width * 0.17, height * 0.5);
  ctx.lineTo(width * 0.24, height * 0.48);
  ctx.lineTo(width * 0.3, height * 0.58);
  ctx.lineTo(width * 0.36, height * 0.63);
  ctx.lineTo(width * 0.31, height * 0.72);
  ctx.lineTo(width * 0.19, height * 0.77);
  ctx.lineTo(width * 0.11, height * 0.9);
  ctx.lineTo(0, height * 0.94);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(151, 171, 167, 0.2)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, height * 0.47);
  ctx.lineTo(width * 0.08, height * 0.44);
  ctx.lineTo(width * 0.17, height * 0.5);
  ctx.lineTo(width * 0.24, height * 0.48);
  ctx.lineTo(width * 0.3, height * 0.58);
  ctx.lineTo(width * 0.36, height * 0.63);
  ctx.stroke();

  ctx.strokeStyle = "rgba(160, 181, 174, 0.16)";
  ctx.lineWidth = 1.4;
  for (let index = 0; index < 7; index += 1) {
    const y = height * (0.78 + random() * 0.17);
    const start = width * (0.08 + random() * 0.14);
    const length = width * (0.24 + random() * 0.3);
    ctx.beginPath();
    ctx.moveTo(start, y);
    ctx.bezierCurveTo(start + length * 0.3, y - 5, start + length * 0.7, y + 5, start + length, y);
    ctx.stroke();
  }

  addVignette(ctx, width, height, 0.64);
  addFilmGrain(ctx, width, height, seed ^ 0x5a, 9);
}

export function createBaseImageCanvas(templateId, seed, width, height) {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  if (templateId === "tidal-blue") {
    drawTidalBlue(ctx, width, height, seed);
  } else {
    drawDuneDusk(ctx, width, height, seed);
  }
  return canvas;
}
