import { WORLD, LIMITS, clamp, lerp } from "./engine.js";

const TAU = Math.PI * 2;

function mulberry32(seed) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
}

function ropePath(ctx, start, end, sag, segments = 28) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const perpendicularX = -dy / length;
  const perpendicularY = dx / length;
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  for (let index = 1; index <= segments; index += 1) {
    const amount = index / segments;
    const curve = Math.sin(amount * Math.PI) * sag;
    const x = lerp(start.x, end.x, amount) + perpendicularX * curve;
    const y = lerp(start.y, end.y, amount) + perpendicularY * curve;
    ctx.lineTo(x, y);
  }
}

function normalizeState(state) {
  if (state.crate) {
    return {
      x: state.crate.x,
      y: state.crate.y,
      vx: state.crate.vx,
      vy: state.crate.vy,
      rotation: state.crate.rotation || 0,
      tension: state.drive.displayTension,
      rawTension: state.drive.tension,
      ropeIntegrity: state.drive.integrity,
      restLength: state.drive.restLength,
      targetX: state.guide.targetX,
      targetY: state.guide.targetY,
      guideLoad: state.guide.load,
      wind: state.wind.total,
      time: state.elapsed,
      phase: state.phase,
      swapped: Boolean(state.swapped),
      settle: state.settle,
      retrieveLeft: state.retrieve.left,
      retrieveRight: state.retrieve.right,
      progress: state.progress,
      result: state.result,
    };
  }
  return {
    x: state.x,
    y: state.y,
    vx: state.vx,
    vy: state.vy,
    rotation: state.rotation,
    tension: state.tensionDisplay,
    rawTension: state.tension,
    ropeIntegrity: state.ropeIntegrity,
    restLength: state.restLength,
    targetX: state.targetX,
    targetY: state.targetY,
    guideLoad: state.guideLoad,
    wind: state.wind,
    time: state.t,
    phase: state.phase,
    swapped: Boolean(state.swapped),
    settle: state.settle,
    retrieveLeft: state.retrieveLeft,
    retrieveRight: state.retrieveRight,
    progress: state.progress,
    result: state.result ? { outcome: state.result } : null,
  };
}

export class CanyonRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.background = null;
    this.resize();
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width || this.canvas.width);
    const height = Math.max(1, rect.height || this.canvas.height);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(width * this.dpr);
    this.canvas.height = Math.round(height * this.dpr);
    this.background = this.buildBackground();
  }

  buildBackground() {
    const canvas = document.createElement("canvas");
    canvas.width = WORLD.width;
    canvas.height = WORLD.height;
    const ctx = canvas.getContext("2d");
    const random = mulberry32(20261116);

    const chasm = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    chasm.addColorStop(0, "#081719");
    chasm.addColorStop(0.28, "#031013");
    chasm.addColorStop(0.52, "#010608");
    chasm.addColorStop(0.78, "#061215");
    chasm.addColorStop(1, "#0b191a");
    ctx.fillStyle = chasm;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    for (let index = 0; index < 18; index += 1) {
      const x = 110 + random() * 980;
      const y = 90 + random() * 440;
      const radius = 25 + random() * 115;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, "rgba(36, 88, 78, 0.08)");
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    this.drawCliff(ctx, "left", random);
    this.drawCliff(ctx, "right", random);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = "#82b3a8";
    ctx.lineWidth = 0.6;
    for (let y = 90; y < 540; y += 46) {
      ctx.beginPath();
      for (let x = 150; x < 1050; x += 20) {
        const offset = Math.sin(x * 0.017 + y * 0.03) * 5;
        if (x === 150) ctx.moveTo(x, y + offset);
        else ctx.lineTo(x, y + offset);
      }
      ctx.stroke();
    }
    ctx.restore();

    const vignette = ctx.createRadialGradient(600, 310, 170, 600, 310, 710);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(0.72, "rgba(0,0,0,0.13)");
    vignette.addColorStop(1, "rgba(0,0,0,0.65)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);
    return canvas;
  }

  drawCliff(ctx, side, random) {
    const isLeft = side === "left";
    const edge = isLeft ? 138 : 1062;
    const outer = isLeft ? 0 : 1200;
    ctx.save();
    for (let layer = 0; layer < 4; layer += 1) {
      const inset = layer * (isLeft ? 17 : 19);
      const points = [];
      for (let y = -20; y <= 640; y += 46) {
        const wobble = (random() - 0.5) * (26 - layer * 3);
        points.push({ x: edge + (isLeft ? inset : -inset) + wobble, y });
      }
      ctx.beginPath();
      ctx.moveTo(outer, -20);
      for (const point of points) ctx.lineTo(point.x, point.y);
      ctx.lineTo(outer, 640);
      ctx.closePath();
      const shade = 14 + layer * 8;
      const gradient = ctx.createLinearGradient(edge, 0, outer, 0);
      gradient.addColorStop(0, `rgb(${shade + 19}, ${shade + 34}, ${shade + 33})`);
      gradient.addColorStop(0.55, `rgb(${shade + 7}, ${shade + 20}, ${shade + 19})`);
      gradient.addColorStop(1, `rgb(${shade}, ${shade + 10}, ${shade + 11})`);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = `rgba(112, 164, 154, ${0.045 + layer * 0.025})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.globalAlpha = 0.2;
    for (let index = 0; index < 18; index += 1) {
      const x = outer + (isLeft ? 1 : -1) * random() * 105;
      const y = random() * 620;
      ctx.strokeStyle = random() > 0.5 ? "#a6a789" : "#4d7771";
      ctx.lineWidth = 1 + random();
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (isLeft ? 1 : -1) * (8 + random() * 32), y + (random() - 0.5) * 18);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = "rgba(111, 228, 208, 0.19)";
    ctx.shadowColor = "#6fe4d0";
    ctx.shadowBlur = 9;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = 38; y < 600; y += 14) {
      const x = edge + Math.sin(y * 0.11) * 4;
      if (y === 38) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  draw(state) {
    if (!this.background) return;
    const ctx = this.ctx;
    const view = normalizeState(state);
    const scale = Math.min(this.canvas.width / WORLD.width, this.canvas.height / WORLD.height);
    const offsetX = (this.canvas.width - WORLD.width * scale) / 2;
    const offsetY = (this.canvas.height - WORLD.height * scale) / 2;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#061012";
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
    ctx.clearRect(0, 0, WORLD.width, WORLD.height);
    ctx.drawImage(this.background, 0, 0, WORLD.width, WORLD.height);

    this.drawAmbient(ctx, view);
    this.drawAnchors(ctx, view);
    this.drawRopes(ctx, view);
    this.drawPlatform(ctx, view);
    this.drawTarget(ctx, view);
    this.drawWind(ctx, view);
    this.drawCrate(ctx, view);
    this.drawWarningEffects(ctx, view);
    this.drawOverlayReadout(ctx, view);
  }

  drawAmbient(ctx, view) {
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = "rgba(111, 228, 208, 0.14)";
    ctx.setLineDash([2, 12]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(150, WORLD.platform.cy);
    ctx.lineTo(1050, WORLD.platform.cy);
    ctx.stroke();
    ctx.setLineDash([]);

    const scan = (view.time * 36) % 900;
    const scanGradient = ctx.createLinearGradient(150 + scan, 0, 270 + scan, 0);
    scanGradient.addColorStop(0, "rgba(111, 228, 208, 0)");
    scanGradient.addColorStop(0.5, "rgba(111, 228, 208, 0.035)");
    scanGradient.addColorStop(1, "rgba(111, 228, 208, 0)");
    ctx.fillStyle = scanGradient;
    ctx.fillRect(150 + scan, 80, 120, 470);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "rgba(111, 228, 208, 0.32)";
    ctx.font = "8px monospace";
    ctx.fillText("ZONE // DEAD AIR", 154, 87);
    ctx.fillStyle = "rgba(244, 170, 98, 0.36)";
    ctx.textAlign = "right";
    ctx.fillText("DROP WINDOW 03", 1046, 87);
    ctx.restore();
  }

  drawAnchors(ctx, view) {
    ctx.save();
    ctx.translate(WORLD.leftAnchor.x - 23, WORLD.leftAnchor.y);
    ctx.fillStyle = "#0b1719";
    roundedRect(ctx, -18, -48, 52, 96, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(111, 228, 208, 0.34)";
    ctx.stroke();
    ctx.fillStyle = "#17292b";
    roundedRect(ctx, -7, -36, 29, 72, 5);
    ctx.fill();

    ctx.save();
    ctx.translate(7, 0);
    ctx.rotate(view.time * 0.35 + (view.restLength || 0) * 0.007);
    for (let index = 0; index < 8; index += 1) {
      ctx.rotate(TAU / 8);
      ctx.fillStyle = index % 2 ? "#2d5955" : "#1e3f3c";
      ctx.fillRect(2, -3, 15, 6);
    }
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, TAU);
    ctx.fillStyle = "#0a1416";
    ctx.fill();
    ctx.strokeStyle = "rgba(111, 228, 208, 0.55)";
    ctx.stroke();
    ctx.restore();
    ctx.fillStyle = "rgba(111, 228, 208, 0.65)";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText("WINCH L", 8, 56);
    ctx.restore();

    ctx.save();
    ctx.translate(WORLD.rightAnchor.x + 17, WORLD.rightAnchor.y);
    ctx.fillStyle = "#0b1719";
    roundedRect(ctx, -33, -48, 50, 96, 7);
    ctx.fill();
    ctx.strokeStyle = "rgba(244, 170, 98, 0.33)";
    ctx.stroke();
    ctx.strokeStyle = "#30494a";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(-10, -38);
    ctx.lineTo(-10, 38);
    ctx.stroke();
    for (let y = -30; y <= 30; y += 12) {
      ctx.strokeStyle = "rgba(244, 170, 98, 0.28)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-15, y);
      ctx.lineTo(-5, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(-10, 0, 15 + Math.sin(view.time * 2) * 1.5, 0, TAU);
    ctx.strokeStyle = "rgba(244, 170, 98, 0.16)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "rgba(244, 170, 98, 0.65)";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GUIDE R", -5, 56);
    ctx.restore();

    this.drawAnchorLamp(ctx, WORLD.leftAnchor, "#6fe4d0");
    this.drawAnchorLamp(ctx, WORLD.rightAnchor, "#f4aa62");
    this.drawOperator(ctx, 51, 405, "#6fe4d0", view, "left");
    this.drawOperator(ctx, 1149, 405, "#f4aa62", view, "right");
  }

  drawAnchorLamp(ctx, point, color) {
    ctx.save();
    const pulse = 0.72 + Math.sin(performance.now() * 0.004 + point.x) * 0.2;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.arc(point.x, point.y - 39, 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  drawOperator(ctx, x, y, color, view, station) {
    const player = view.swapped
      ? station === "left"
        ? "P2"
        : "P1"
      : station === "left"
        ? "P1"
        : "P2";
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(station === "left" ? 9 : -9, -10);
    ctx.lineTo(station === "left" ? 37 : -37, -48);
    ctx.stroke();

    ctx.globalAlpha = 0.26;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(3, 10, 18, 7, 0, 0, TAU);
    ctx.fill();

    ctx.globalAlpha = 1;
    ctx.fillStyle = "#1c3234";
    ctx.beginPath();
    ctx.ellipse(0, 1, 12, 16, 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.56;
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.beginPath();
    ctx.arc(0, -9, 6, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(0, -9, 10, 0, TAU);
    ctx.stroke();

    ctx.globalAlpha = 0.9;
    ctx.fillStyle = color;
    ctx.font = "bold 8px monospace";
    ctx.textAlign = "center";
    ctx.fillText(player, 0, 27);
    ctx.globalAlpha = 0.38;
    ctx.font = "6px monospace";
    ctx.fillText(station === "left" ? "WINCH" : "GUIDE", 0, 37);
    ctx.restore();
  }

  drawPlatform(ctx, view) {
    const platform = WORLD.platform;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.8)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#091517";
    roundedRect(ctx, platform.x - 8, platform.y - 5, platform.w + 16, platform.h + 16, 9);
    ctx.fill();
    ctx.shadowColor = "transparent";

    const metal = ctx.createLinearGradient(platform.x, platform.y, platform.x, platform.y + platform.h);
    metal.addColorStop(0, "#264043");
    metal.addColorStop(0.45, "#172c2f");
    metal.addColorStop(1, "#0d1c1f");
    ctx.fillStyle = metal;
    roundedRect(ctx, platform.x, platform.y, platform.w, platform.h, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(122, 191, 181, 0.38)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.save();
    roundedRect(ctx, platform.x + 8, platform.y + 8, platform.w - 16, platform.h - 16, 3);
    ctx.clip();
    ctx.strokeStyle = "rgba(244, 170, 98, 0.13)";
    ctx.lineWidth = 7;
    for (let x = platform.x - platform.h; x < platform.x + platform.w + platform.h; x += 18) {
      ctx.beginPath();
      ctx.moveTo(x, platform.y + platform.h);
      ctx.lineTo(x + platform.h, platform.y);
      ctx.stroke();
    }
    ctx.restore();

    ctx.setLineDash([8, 6]);
    ctx.strokeStyle = "rgba(111, 228, 208, 0.27)";
    ctx.lineWidth = 1;
    roundedRect(ctx, platform.x + 14, platform.y + 14, platform.w - 28, platform.h - 28, 2);
    ctx.stroke();
    ctx.setLineDash([]);

    for (let index = 0; index < 4; index += 1) {
      const x = platform.x + 20 + index * ((platform.w - 40) / 3);
      ctx.fillStyle = index % 2 ? "rgba(244, 170, 98, 0.73)" : "rgba(111, 228, 208, 0.73)";
      ctx.beginPath();
      ctx.arc(x, platform.y + 5, 2, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(215, 227, 222, 0.47)";
    ctx.font = "7px monospace";
    ctx.textAlign = "center";
    ctx.fillText("C-07 / RELAY", platform.cx, platform.y + platform.h - 9);

    const glow = ctx.createRadialGradient(platform.cx, platform.cy, 5, platform.cx, platform.cy, 100);
    glow.addColorStop(0, "rgba(111, 228, 208, 0.08)");
    glow.addColorStop(1, "rgba(111, 228, 208, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(platform.x - 40, platform.y - 40, platform.w + 80, platform.h + 80);
    ctx.restore();
  }

  drawRopes(ctx, view) {
    const crate = { x: view.x, y: view.y };
    const driveSag = clamp((34 - view.tension) * 0.55, 0, 25);
    const guideSag = clamp(25 - view.guideLoad * 0.13, 2, 24);
    ctx.save();
    ctx.lineCap = "round";

    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 4;
    ropePath(ctx, WORLD.leftAnchor, crate, driveSag);
    ctx.stroke();
    ctx.strokeStyle = view.tension > LIMITS.tensionWarn ? "#ff6a58" : "#96e5d5";
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 5;
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.9;
    ropePath(ctx, WORLD.leftAnchor, crate, driveSag);
    ctx.stroke();
    ctx.globalAlpha = 1;

    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.5)";
    ctx.lineWidth = 3.5;
    ropePath(ctx, WORLD.rightAnchor, crate, guideSag);
    ctx.stroke();
    ctx.strokeStyle = "#e6b07c";
    ctx.shadowColor = "#f4aa62";
    ctx.shadowBlur = 4;
    ctx.lineWidth = 1.15;
    ctx.globalAlpha = 0.82;
    ropePath(ctx, WORLD.rightAnchor, crate, guideSag);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (view.ropeIntegrity < 55) {
      const flicker = 0.4 + Math.sin(performance.now() * 0.02) * 0.35;
      ctx.strokeStyle = `rgba(255, 106, 88, ${flicker})`;
      ctx.lineWidth = 3;
      ctx.shadowColor = "#ff6a58";
      ctx.shadowBlur = 13;
      ropePath(ctx, WORLD.leftAnchor, crate, driveSag);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTarget(ctx, view) {
    const target = { x: view.targetX, y: view.targetY };
    const platform = WORLD.platform;
    const inPlatform =
      target.x > platform.x &&
      target.x < platform.x + platform.w &&
      target.y > platform.y &&
      target.y < platform.y + platform.h;
    ctx.save();
    if (Math.hypot(target.x - platform.cx, target.y - platform.cy) > 12) {
      ctx.strokeStyle = "rgba(244, 170, 98, 0.17)";
      ctx.setLineDash([3, 8]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(platform.cx, platform.cy);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const color = inPlatform ? "#f4aa62" : "#ff6a58";
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 1;
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.globalAlpha = 0.83;
    ctx.beginPath();
    ctx.arc(target.x, target.y, 11, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(target.x, target.y, 18 + Math.sin(view.time * 3) * 2, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(target.x - 20, target.y);
    ctx.lineTo(target.x - 7, target.y);
    ctx.moveTo(target.x + 7, target.y);
    ctx.lineTo(target.x + 20, target.y);
    ctx.moveTo(target.x, target.y - 20);
    ctx.lineTo(target.x, target.y - 7);
    ctx.moveTo(target.x, target.y + 7);
    ctx.lineTo(target.x, target.y + 20);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = "7px monospace";
    ctx.textAlign = "left";
    ctx.fillText(inPlatform ? "AIM LOCK" : "OUT OF ZONE", target.x + 23, target.y - 7);
    ctx.restore();
  }

  drawWind(ctx, view) {
    const wind = view.wind || 0;
    const direction = Math.sign(wind) || -1;
    const intensity = clamp(Math.abs(wind) / 70, 0.22, 1);
    ctx.save();
    ctx.lineCap = "round";
    for (let index = 0; index < 22; index += 1) {
      const seed = index * 17.31;
      const x = 190 + ((index * 127 + Math.sin(seed) * 91) % 820);
      const baseY = 105 + ((index * 73 + Math.cos(seed) * 89) % 410);
      const travel = (view.time * (35 + intensity * 95) * direction) % 90;
      const y = baseY + travel;
      const length = 10 + intensity * 27 + (index % 4) * 4;
      const alpha = 0.035 + intensity * (index % 3 === 0 ? 0.19 : 0.1);
      ctx.strokeStyle = `rgba(188, 222, 211, ${alpha})`;
      ctx.lineWidth = 0.7 + intensity * 0.7;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + wind * 0.11, y + length * direction);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawCrate(ctx, view) {
    const width = WORLD.crate.w;
    const height = WORLD.crate.h;
    ctx.save();
    ctx.translate(view.x, view.y);
    ctx.rotate(view.rotation || 0);

    ctx.save();
    ctx.translate(3, 9);
    ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
    ctx.filter = "blur(6px)";
    roundedRect(ctx, -width / 2, -height / 2, width, height, 4);
    ctx.fill();
    ctx.restore();

    const body = ctx.createLinearGradient(0, -height / 2, 0, height / 2);
    body.addColorStop(0, "#d7c69c");
    body.addColorStop(0.5, "#a99770");
    body.addColorStop(1, "#736649");
    ctx.fillStyle = body;
    ctx.strokeStyle = "rgba(245, 226, 184, 0.58)";
    ctx.lineWidth = 1;
    ctx.shadowColor = "rgba(244, 170, 98, 0.36)";
    ctx.shadowBlur = 15;
    roundedRect(ctx, -width / 2, -height / 2, width, height, 3);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = "#3b382d";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-17, -height / 2 + 2);
    ctx.lineTo(-17, height / 2 - 2);
    ctx.moveTo(17, -height / 2 + 2);
    ctx.lineTo(17, height / 2 - 2);
    ctx.stroke();
    ctx.strokeStyle = "#594e39";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-width / 2 + 2, -6);
    ctx.lineTo(width / 2 - 2, -6);
    ctx.stroke();

    ctx.fillStyle = "#272a24";
    ctx.font = "6px monospace";
    ctx.textAlign = "center";
    ctx.fillText("SUPPLY", 0, 2);
    ctx.font = "bold 8px monospace";
    ctx.fillStyle = "#3f3b2d";
    ctx.fillText("07", 0, 12);

    const ledColor = view.phase === "retrieving" ? "#91d77f" : "#f4aa62";
    ctx.fillStyle = ledColor;
    ctx.shadowColor = ledColor;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(21, -7, 2.2, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (view.phase === "retrieving") {
      this.drawRetrievalRing(ctx, view);
    }
    if (view.settle > 0 && view.phase === "playing") {
      const amount = clamp(view.settle / LIMITS.settleTime, 0, 1);
      ctx.save();
      ctx.strokeStyle = `rgba(145, 215, 127, ${0.3 + amount * 0.6})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(view.x, view.y, 36 + amount * 4, -Math.PI / 2, -Math.PI / 2 + TAU * amount);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawRetrievalRing(ctx, view) {
    const radius = 41;
    const drawArc = (progress, color, mirror) => {
      ctx.beginPath();
      ctx.arc(
        view.x,
        view.y,
        radius,
        mirror ? Math.PI / 2 : -Math.PI / 2,
        mirror ? Math.PI / 2 + TAU * (progress / 100) : -Math.PI / 2 + TAU * (progress / 100),
      );
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.stroke();
    };
    ctx.save();
    ctx.globalAlpha = 0.7;
    drawArc(view.retrieveLeft, "#6fe4d0", false);
    drawArc(view.retrieveRight, "#f4aa62", true);
    ctx.shadowBlur = 0;
    ctx.font = "6px monospace";
    ctx.fillStyle = "rgba(223, 234, 230, 0.7)";
    ctx.textAlign = "center";
    ctx.fillText("SYNC RETRIEVE", view.x, view.y - 51);
    ctx.restore();
  }

  drawWarningEffects(ctx, view) {
    if (view.rawTension >= LIMITS.tensionWarn) {
      const intensity = clamp((view.rawTension - LIMITS.tensionWarn) / 16, 0.2, 1);
      const pulse = 0.55 + Math.sin(performance.now() * 0.016) * 0.28;
      const glow = ctx.createLinearGradient(0, 0, 0, WORLD.height);
      glow.addColorStop(0, `rgba(255, 71, 53, ${intensity * pulse * 0.08})`);
      glow.addColorStop(0.5, "rgba(255, 71, 53, 0)");
      glow.addColorStop(1, `rgba(255, 71, 53, ${intensity * pulse * 0.1})`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, WORLD.width, WORLD.height);
      ctx.strokeStyle = `rgba(255, 106, 88, ${intensity * pulse * 0.8})`;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(1, 1, WORLD.width - 2, WORLD.height - 2);
    }

    if (Math.abs(view.y - WORLD.platform.cy) > 70) {
      ctx.save();
      const below = view.y > WORLD.platform.cy;
      const y = view.y + (below ? -47 : 47);
      ctx.strokeStyle = "rgba(255, 106, 88, 0.72)";
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(view.x, y - (below ? 6 : -6));
      ctx.lineTo(view.x - 5, y + (below ? 1 : -1));
      ctx.lineTo(view.x + 5, y + (below ? 1 : -1));
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawOverlayReadout(ctx, view) {
    ctx.save();
    ctx.font = "7px monospace";
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(152, 180, 174, 0.51)";
    ctx.fillText(`T ${view.rawTension.toFixed(1)}`, 155, 564);
    ctx.fillText(`W ${view.wind.toFixed(1)}`, 211, 564);
    ctx.fillText(`AIM ${Math.round(view.targetX)},${Math.round(view.targetY)}`, 265, 564);
    ctx.textAlign = "right";
    const status =
      view.phase === "retrieving"
        ? "SYNC RETRIEVAL"
        : view.phase === "won"
          ? "CARGO SECURED"
          : view.phase === "lost"
            ? "LINK LOST"
            : "MANUAL GUIDANCE";
    ctx.fillStyle =
      view.phase === "lost"
        ? "rgba(255, 106, 88, 0.72)"
        : view.phase === "won"
          ? "rgba(145, 215, 127, 0.72)"
          : "rgba(152, 180, 174, 0.51)";
    ctx.fillText(status, 1045, 564);
    ctx.restore();
  }
}
