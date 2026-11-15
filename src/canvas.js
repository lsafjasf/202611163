import { CONFIG } from "./sim.js";

const W = 1200;
const H = 674;
const COLORS = {
  bg: "#07171b",
  grid: "rgba(120, 190, 190, 0.045)",
  steel: "#38575b",
  steelLight: "#55787b",
  text: "#d8ecea",
  muted: "#719596",
  faint: "#456667",
  water: "#24aeb5",
  waterBright: "#5ce1db",
  cyan: "#48e0d1",
  green: "#79dc9e",
  target: "rgba(121, 220, 158, 0.09)",
  targetLine: "rgba(121, 220, 158, 0.42)",
  amber: "#f0b35a",
  red: "#ff6f61",
  violet: "#b39cff"
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const lerp = (a, b, t) => a + (b - a) * t;

function roundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

function pointAtDistance(points, distance) {
  let remaining = distance;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (remaining <= length) {
      const t = length ? remaining / length : 0;
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
    }
    remaining -= length;
  }
  return points[points.length - 1];
}

function drawPipe(ctx, points, width = 12) {
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#0a1113";
  ctx.lineWidth = width + 6;
  ctx.beginPath();
  points.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
  ctx.strokeStyle = COLORS.steel;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.strokeStyle = "rgba(150, 203, 204, 0.18)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function path(ctx, callback) {
  ctx.beginPath();
  callback();
}

function text(ctx, value, x, y, size = 11, color = COLORS.muted, align = "left", weight = 400) {
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "SFMono-Regular", "Cascadia Code", Menlo, Consolas, "Noto Sans SC", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}

export class SceneRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.animatedPhase = 0;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(320, Math.round(rect.width * ratio));
    const height = Math.max(180, Math.round(rect.height * ratio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  draw(state, options = {}) {
    const ctx = this.ctx;
    const sx = this.canvas.width / W;
    const sy = this.canvas.height / H;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);
    ctx.clearRect(0, 0, W, H);
    this.drawBackground(ctx, state, options);
    this.drawHeader(ctx, state, options);
    this.drawPipes(ctx, state, options);
    this.drawSource(ctx, state, options);
    this.drawTank(ctx, {
      x: 378,
      y: 112,
      w: 232,
      h: 402,
      level: state.tankA,
      max: CONFIG.tankA.height,
      targetMin: CONFIG.target.aMin,
      targetMax: CONFIG.target.aMax,
      label: "TANK A",
      name: "A 箱",
      accent: COLORS.waterBright
    }, state, options);
    this.drawTank(ctx, {
      x: 802,
      y: 148,
      w: 226,
      h: 366,
      level: state.tankB,
      max: CONFIG.tankB.height,
      targetMin: CONFIG.target.bMin,
      targetMax: CONFIG.target.bMax,
      label: "TANK B",
      name: "B 箱",
      accent: "#67bfe0"
    }, state, options);
    this.drawValve(ctx, 293, 291, state.valves[0], "G1", "进水阀", state.valveTargets[0]);
    this.drawValve(ctx, 706, 291, state.valves[1], "G2", "平衡阀", state.valveTargets[1]);
    this.drawValve(ctx, 1045, 438, state.valves[2], "G3", "排水阀", state.valveTargets[2], true);
    this.drawPump(ctx, state, options);
    this.drawPressureGauge(ctx, 745, 545, state.pressure, state.trip, options);
    this.drawFlowParticles(ctx, state, options);
    this.drawForceHints(ctx, state, options);
    this.drawPressureSpark(ctx, state, options);
    this.drawTriggerMarker(ctx, state, options);
  }

  drawBackground(ctx, state, options) {
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, "#081a1e");
    gradient.addColorStop(0.55, "#071519");
    gradient.addColorStop(1, "#050f12");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (let y = 0; y <= H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(72, 224, 209, 0.018)";
    ctx.beginPath();
    ctx.arc(690, 380, 300, 0, Math.PI * 2);
    ctx.fill();

    if (state.status === "trip") {
      ctx.fillStyle = "rgba(255, 82, 69, 0.035)";
      ctx.fillRect(0, 0, W, H);
    }
  }

  drawHeader(ctx, state, options) {
    text(ctx, "HYDRAULIC PROCESS", 28, 24, 9, COLORS.cyan, "left", 600);
    text(ctx, "SUPPLY → A → B → DRAIN", 28, 40, 8, COLORS.faint);
    text(ctx, options.replay ? "REPLAY BUFFER" : "LIVE TELEMETRY", 28, 56, 8, options.replay ? COLORS.violet : COLORS.muted);
    ctx.strokeStyle = "rgba(120, 190, 190, 0.12)";
    ctx.beginPath();
    ctx.moveTo(28, 68.5);
    ctx.lineTo(1172, 68.5);
    ctx.stroke();
    text(ctx, `T ${state.time.toFixed(2)} s`, 1172, 25, 9, COLORS.muted, "right");
    text(ctx, `P ${state.pressure.toFixed(0)} kPa`, 1172, 42, 8, COLORS.amber, "right");
    text(ctx, `LOAD ${state.load.toFixed(1)} kW`, 1172, 57, 8, COLORS.violet, "right");
  }

  drawPipes(ctx, state, options) {
    drawPipe(ctx, [[198, 291], [293, 291], [333, 291], [333, 145], [378, 145]], 13);
    drawPipe(ctx, [[610, 291], [706, 291], [802, 291]], 11);
    drawPipe(ctx, [[542, 505], [611, 505], [611, 580], [658, 580]], 12);
    drawPipe(ctx, [[742, 580], [779, 580], [779, 507], [802, 507]], 12);
    drawPipe(ctx, [[1028, 438], [1045, 438], [1096, 438], [1096, 616], [1150, 616]], 10);

    const pulse = options.paused ? 0.1 : 0.18;
    ctx.save();
    ctx.strokeStyle = `rgba(72, 224, 209, ${pulse})`;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(333, 291);
    ctx.lineTo(333, 145);
    ctx.stroke();
    ctx.restore();

    text(ctx, "SUPPLY", 50, 185, 8, COLORS.faint);
    text(ctx, "G1  FEED", 212, 276, 8, COLORS.muted);
    text(ctx, "G2  TRANSFER", 638, 276, 8, COLORS.muted);
    text(ctx, "G3  DRAIN", 1052, 423, 8, COLORS.muted);
    text(ctx, "PUMP LINE", 606, 596, 8, COLORS.violet);
  }

  drawSource(ctx, state, options) {
    const x = 50;
    const y = 210;
    const w = 148;
    const h = 254;
    ctx.save();
    roundRect(ctx, x, y, w, h, 9);
    ctx.fillStyle = "rgba(16, 39, 43, 0.82)";
    ctx.fill();
    ctx.strokeStyle = "rgba(122, 187, 189, 0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, x + 5, y + 5, w - 10, h - 10, 6);
    ctx.clip();
    ctx.fillStyle = "rgba(20, 139, 147, 0.63)";
    ctx.fillRect(x + 5, y + 46, w - 10, h - 51);
    const wave = options.paused ? 0 : state.time;
    ctx.strokeStyle = "rgba(108, 231, 225, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let px = x + 5; px <= x + w - 5; px += 4) {
      const py = y + 46 + Math.sin(px * 0.07 + wave * 1.4) * 2;
      if (px === x + 5) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.restore();

    text(ctx, "SOURCE", x + 14, y + 21, 8, COLORS.muted);
    text(ctx, "3.8 m", x + 14, y + 36, 8, COLORS.faint);
    text(ctx, "供水源", x + w / 2, y + h + 19, 11, COLORS.text, "center", 600);
    text(ctx, "320 kPa", x + w / 2, y + h + 34, 8, COLORS.faint, "center");
    ctx.restore();
  }

  drawTank(ctx, tank, state, options) {
    const { x, y, w, h, level, max, targetMin, targetMax, label, name, accent } = tank;
    const innerTop = y + 16;
    const innerBottom = y + h - 18;
    const innerHeight = innerBottom - innerTop;
    const levelY = innerBottom - clamp(level / max, 0, 1) * innerHeight;
    const minY = innerBottom - clamp(targetMin / max, 0, 1) * innerHeight;
    const maxY = innerBottom - clamp(targetMax / max, 0, 1) * innerHeight;
    const inRange = level >= targetMin && level <= targetMax;
    const trend = options.trends?.[label === "TANK A" ? "A" : "B"] ?? 0;

    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.32)";
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    roundRect(ctx, x, y, w, h, 12);
    ctx.fillStyle = "rgba(8, 25, 29, 0.88)";
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = inRange ? "rgba(121, 220, 158, 0.38)" : "rgba(122, 187, 189, 0.3)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.save();
    roundRect(ctx, x + 8, innerTop, w - 16, innerHeight, 6);
    ctx.clip();
    const waterHeight = innerBottom - levelY;
    const gradient = ctx.createLinearGradient(0, levelY, 0, innerBottom);
    gradient.addColorStop(0, "rgba(72, 224, 209, 0.72)");
    gradient.addColorStop(1, "rgba(18, 105, 124, 0.78)");
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 8, levelY, w - 16, waterHeight);

    const waveTime = options.paused ? 0 : state.time;
    ctx.strokeStyle = "rgba(142, 248, 239, 0.82)";
    ctx.lineWidth = 1.6;
    for (let pass = 0; pass < 2; pass += 1) {
      ctx.beginPath();
      for (let px = x + 8; px <= x + w - 8; px += 4) {
        const py = levelY + Math.sin(px * 0.08 + waveTime * 1.6 + pass * 1.7) * (1.2 + pass * 0.7);
        if (px === x + 8) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.globalAlpha = 0.45;
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = "rgba(136, 233, 226, 0.13)";
    ctx.lineWidth = 1;
    const step = 0.5;
    for (let meter = step; meter < max; meter += step) {
      const ty = innerBottom - (meter / max) * innerHeight;
      ctx.beginPath();
      ctx.moveTo(x + 9, ty);
      ctx.lineTo(x + 24, ty);
      ctx.stroke();
      text(ctx, meter.toFixed(1), x + 28, ty, 7, "rgba(142, 203, 202, 0.36)");
    }
    ctx.restore();

    ctx.fillStyle = "rgba(121, 220, 158, 0.09)";
    ctx.fillRect(x + 8, maxY, w - 16, minY - maxY);
    ctx.strokeStyle = COLORS.targetLine;
    ctx.setLineDash([4, 5]);
    ctx.beginPath();
    ctx.moveTo(x + 8, minY);
    ctx.lineTo(x + w - 8, minY);
    ctx.moveTo(x + 8, maxY);
    ctx.lineTo(x + w - 8, maxY);
    ctx.stroke();
    ctx.setLineDash([]);
    text(ctx, "TARGET", x + w - 11, maxY - 8, 7, "rgba(121, 220, 158, 0.65)", "right");

    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(x + 8, levelY);
    ctx.lineTo(x + w - 8, levelY);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = inRange ? COLORS.targetLine : "rgba(72, 224, 209, 0.65)";
    ctx.beginPath();
    ctx.moveTo(x - 1, levelY);
    ctx.lineTo(x - 10, levelY - 5);
    ctx.lineTo(x - 10, levelY + 5);
    ctx.closePath();
    ctx.fill();

    roundRect(ctx, x + 4, y - 7, 39, 20, 5);
    ctx.fillStyle = "#0a2024";
    ctx.fill();
    text(ctx, label, x + 23, y + 3, 7, COLORS.faint, "center");

    text(ctx, name, x + 16, y + 31, 11, COLORS.text, "left", 600);
    text(ctx, `${level.toFixed(2)} m`, x + w - 14, y + 31, 15, inRange ? "#9cf5bd" : COLORS.text, "right", 600);
    text(ctx, `${Math.round((level / max) * 100)}% FULL`, x + 16, y + 49, 7, COLORS.faint);

    const arrow = trend > 0.00008 ? "↑" : trend < -0.00008 ? "↓" : "→";
    const trendColor = trend > 0.00008 ? COLORS.green : trend < -0.00008 ? COLORS.amber : COLORS.muted;
    text(ctx, `${arrow} ${Math.abs(trend * 1000).toFixed(1)} mm/s`, x + w / 2, y + h - 7, 7, trendColor, "center");
    ctx.restore();
  }

  drawValve(ctx, x, y, opening, code, name, target, verticalStem = false) {
    const mismatch = Math.abs(opening - target) > 0.025;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
    ctx.shadowBlur = 10;
    ctx.fillStyle = "#112a2e";
    ctx.strokeStyle = mismatch ? COLORS.amber : "rgba(106, 174, 177, 0.7)";
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = "rgba(72, 224, 209, 0.26)";
    ctx.beginPath();
    ctx.moveTo(-10, -12);
    ctx.lineTo(10, 0);
    ctx.lineTo(-10, 12);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(10, -12);
    ctx.lineTo(-10, 0);
    ctx.lineTo(10, 12);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = mismatch ? COLORS.amber : "#b4d6d4";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -23, 10, 0, Math.PI * 2);
    ctx.stroke();
    ctx.save();
    ctx.translate(0, -23);
    ctx.rotate(opening * Math.PI * 0.9);
    ctx.beginPath();
    ctx.moveTo(-10, 0);
    ctx.lineTo(10, 0);
    ctx.moveTo(0, -10);
    ctx.lineTo(0, 10);
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(0, -23);
    ctx.lineTo(0, -17);
    ctx.stroke();

    ctx.fillStyle = "#07171b";
    ctx.strokeStyle = mismatch ? "rgba(240, 179, 90, 0.6)" : "rgba(72, 224, 209, 0.4)";
    roundRect(ctx, -31, 26, 62, 17, 4);
    ctx.fill();
    ctx.stroke();
    text(ctx, `${code}  ${Math.round(opening * 100)}%`, 0, 34.5, 7.5, mismatch ? COLORS.amber : COLORS.text, "center");
    if (mismatch) {
      text(ctx, `目标 ${Math.round(target * 100)}%`, 0, 51, 7, COLORS.amber, "center");
    } else {
      text(ctx, name, 0, 51, 7, COLORS.faint, "center");
    }
    ctx.restore();
  }

  drawPump(ctx, state, options) {
    const x = 700;
    const y = 580;
    const radius = 43;
    const hot = clamp((state.temperature - 40) / 65, 0, 1);
    const bodyColor = state.dryRun ? COLORS.red : hot > 0.58 ? COLORS.amber : COLORS.violet;
    ctx.save();
    ctx.translate(x, y);

    if (state.hammerAmp > 8 || state.dryRun) {
      ctx.strokeStyle = state.dryRun ? "rgba(255, 111, 97, 0.45)" : "rgba(240, 179, 90, 0.3)";
      ctx.lineWidth = 1.5;
      const ring = ((options.realTime ?? 0) * 45) % 34;
      ctx.beginPath();
      ctx.arc(0, 0, radius + 8 + ring, 0, Math.PI * 2);
      ctx.globalAlpha = 1 - ring / 34;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    ctx.shadowColor = bodyColor;
    ctx.shadowBlur = state.dryRun ? 22 : 9;
    ctx.fillStyle = "rgba(18, 29, 38, 0.96)";
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.save();
    ctx.rotate(-state.time * state.pump * 4.2);
    ctx.strokeStyle = `rgba(179, 156, 255, ${0.35 + state.pump * 0.5})`;
    ctx.lineWidth = 2;
    for (let blade = 0; blade < 6; blade += 1) {
      ctx.rotate(Math.PI / 3);
      ctx.beginPath();
      ctx.moveTo(8, 0);
      ctx.quadraticCurveTo(22, -7, 28, 0);
      ctx.stroke();
    }
    ctx.restore();

    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#07171b";
    ctx.beginPath();
    ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
    ctx.fill();

    roundRect(ctx, -26, 51, 52, 18, 4);
    ctx.fillStyle = "#081b1f";
    ctx.fill();
    ctx.strokeStyle = "rgba(179, 156, 255, 0.28)";
    ctx.stroke();
    text(ctx, `P · ${Math.round(state.pump * 100)}%`, 0, 60.5, 7.5, COLORS.text, "center");
    text(ctx, `${Math.round(state.pumpRpm)} rpm`, 0, 78, 7.5, state.pumpRpm > CONFIG.limits.pumpRpm ? COLORS.red : COLORS.faint, "center");

    if (state.dryRun) {
      ctx.fillStyle = COLORS.red;
      roundRect(ctx, -27, -68, 54, 17, 4);
      ctx.fill();
      text(ctx, "DRY RUN", 0, -59, 7, "#230a08", "center", 700);
    }
    ctx.restore();
  }

  drawPressureGauge(ctx, x, y, pressure, trip, options) {
    const radius = 42;
    const start = Math.PI * 0.75;
    const end = Math.PI * 2.25;
    const ratio = clamp(pressure / 1200, 0, 1);
    const angle = lerp(start, end, ratio);
    const limitAngle = lerp(start, end, CONFIG.limits.pressure / 1200);
    ctx.save();
    ctx.translate(x, y);

    ctx.fillStyle = "rgba(7, 22, 26, 0.92)";
    ctx.strokeStyle = pressure > CONFIG.limits.pressure ? COLORS.red : "rgba(122, 187, 189, 0.32)";
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.arc(0, 0, radius + 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.lineWidth = 6;
    ctx.strokeStyle = "rgba(128, 166, 166, 0.15)";
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, end);
    ctx.stroke();
    ctx.strokeStyle = pressure > CONFIG.limits.pressure ? COLORS.red : pressure > 650 ? COLORS.amber : COLORS.waterBright;
    ctx.beginPath();
    ctx.arc(0, 0, radius, start, angle);
    ctx.stroke();

    ctx.strokeStyle = COLORS.red;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(limitAngle) * (radius - 5), Math.sin(limitAngle) * (radius - 5));
    ctx.lineTo(Math.cos(limitAngle) * (radius + 5), Math.sin(limitAngle) * (radius + 5));
    ctx.stroke();

    ctx.strokeStyle = "#f2fbf9";
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(Math.cos(angle + Math.PI) * 9, Math.sin(angle + Math.PI) * 9);
    ctx.lineTo(Math.cos(angle) * (radius - 8), Math.sin(angle) * (radius - 8));
    ctx.stroke();
    ctx.fillStyle = COLORS.text;
    ctx.beginPath();
    ctx.arc(0, 0, 4.2, 0, Math.PI * 2);
    ctx.fill();

    text(ctx, `${pressure.toFixed(0)}`, 0, 24, 13, pressure > CONFIG.limits.pressure ? COLORS.red : COLORS.text, "center", 600);
    text(ctx, "kPa", 0, 35, 7, COLORS.faint, "center");
    text(ctx, "PRESSURE", 0, -22, 6.5, COLORS.faint, "center");
    ctx.restore();
  }

  drawFlowParticles(ctx, state, options) {
    const time = state.time;
    const pipes = [
      {
        points: [[198, 291], [293, 291], [333, 291], [333, 145], [378, 145]],
        flow: state.flows.feed,
        color: "rgba(115, 246, 237, 0.95)"
      },
      {
        points: [[610, 291], [706, 291], [802, 291]],
        flow: state.flows.balance,
        color: "rgba(112, 221, 235, 0.9)"
      },
      {
        points: [[542, 505], [611, 505], [611, 580], [658, 580]],
        flow: state.flows.pumped,
        color: "rgba(192, 174, 255, 0.95)"
      },
      {
        points: [[742, 580], [779, 580], [779, 507], [802, 507]],
        flow: state.flows.pumped,
        color: "rgba(192, 174, 255, 0.95)"
      },
      {
        points: [[1028, 438], [1045, 438], [1096, 438], [1096, 616], [1150, 616]],
        flow: state.flows.drain,
        color: "rgba(95, 187, 195, 0.85)"
      }
    ];
    ctx.save();
    for (const pipe of pipes) {
      if (pipe.flow < 0.2) continue;
      const length = polylineLength(pipe.points);
      const spacing = 34;
      const velocity = 16 + pipe.flow * 0.9;
      const offset = options.paused ? 0 : (time * velocity) % spacing;
      for (let distance = offset; distance < length; distance += spacing) {
        const [x, y] = pointAtDistance(pipe.points, distance);
        const pulse = 0.7 + Math.sin(time * 4 + distance * 0.05) * 0.3;
        ctx.fillStyle = pipe.color;
        ctx.globalAlpha = pulse;
        ctx.shadowColor = pipe.color;
        ctx.shadowBlur = 7;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  drawArrow(ctx, x1, y1, x2, y2, color, width = 1.5) {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - Math.cos(angle - 0.55) * 8, y2 - Math.sin(angle - 0.55) * 8);
    ctx.lineTo(x2 - Math.cos(angle + 0.55) * 8, y2 - Math.sin(angle + 0.55) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawForceHints(ctx, state, options) {
    const emphasis = clamp(options.resumePulse ?? 0, 0, 1);
    const alpha = 0.3 + emphasis * 0.6;
    const forceColor = state.status === "trip" ? "rgba(255, 111, 97, 0.75)" : `rgba(72, 224, 209, ${alpha})`;
    const labelColor = state.status === "trip" ? COLORS.red : emphasis > 0.15 ? COLORS.waterBright : COLORS.muted;
    ctx.save();
    this.drawArrow(ctx, 620, 472, 670, 472, forceColor, 1.4 + emphasis);
    this.drawArrow(ctx, 730, 472, 785, 472, forceColor, 1.4 + emphasis);
    text(ctx, "泵推力 A → B", 700, 458, 7, labelColor, "center");
    this.drawArrow(ctx, 892, 642, 892, 618, forceColor, 1.2 + emphasis);
    text(ctx, "重力", 866, 640, 7, labelColor, "center");

    const pressureTrend = options.trends?.pressure ?? 0;
    const pressureArrow = pressureTrend > 0.2 ? "↗" : pressureTrend < -0.2 ? "↘" : "→";
    text(ctx, `${pressureArrow} ${pressureTrend >= 0 ? "+" : ""}${pressureTrend.toFixed(1)} kPa/s`, 745, 603, 6.5, labelColor, "center");

    if (emphasis > 0.02) {
      ctx.globalAlpha = emphasis;
      ctx.strokeStyle = "rgba(72, 224, 209, 0.55)";
      ctx.lineWidth = 1.2;
      ctx.setLineDash([5, 5]);
      ctx.beginPath();
      ctx.moveTo(628, 430);
      ctx.lineTo(684, 430);
      ctx.moveTo(716, 430);
      ctx.lineTo(772, 430);
      ctx.stroke();
      ctx.setLineDash([]);
      text(ctx, "RESUMED", 700, 419, 7, COLORS.waterBright, "center");
    }
    ctx.restore();
  }

  drawPressureSpark(ctx, state, options) {
    const x = 874;
    const y = 84;
    const w = 298;
    const h = 52;
    const trail = options.pressureTrail?.length ? options.pressureTrail : [{ time: state.time, pressure: state.pressure }];
    const endTime = Math.max(trail[trail.length - 1].time, 1);
    const startTime = Math.max(0, endTime - 12);
    const mapX = (time) => x + ((time - startTime) / Math.max(0.001, endTime - startTime)) * w;
    const mapY = (pressure) => y + h - clamp(pressure / 1100, 0, 1) * h;
    ctx.save();
    ctx.fillStyle = "rgba(7, 22, 26, 0.66)";
    roundRect(ctx, x - 7, y - 11, w + 14, h + 24, 6);
    ctx.fill();
    ctx.strokeStyle = "rgba(122, 187, 189, 0.13)";
    ctx.stroke();
    text(ctx, "PRESSURE · 12 s", x, y - 5, 6.5, COLORS.faint);
    const limitY = mapY(CONFIG.limits.pressure);
    ctx.strokeStyle = "rgba(255, 111, 97, 0.35)";
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(x, limitY);
    ctx.lineTo(x + w, limitY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = state.pressure > CONFIG.limits.pressure ? COLORS.red : "rgba(240, 179, 90, 0.82)";
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let started = false;
    for (const point of trail) {
      if (point.time < startTime) continue;
      const px = mapX(point.time);
      const py = mapY(point.pressure);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    if (state.status === "trip") {
      ctx.fillStyle = COLORS.red;
      ctx.beginPath();
      ctx.arc(mapX(state.time), mapY(state.pressure), 2.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  drawTriggerMarker(ctx, state, options) {
    if (state.status === "success") {
      const pulse = 0.55 + Math.sin((options.realTime ?? 0) * 2.5) * 0.2;
      ctx.save();
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(494, 82, 15, 0, Math.PI * 2);
      ctx.stroke();
      text(ctx, "✓", 494, 82, 14, COLORS.green, "center", 700);
      ctx.restore();
      return;
    }
    if (state.status !== "trip" && state.status !== "timeout") return;
    const primary = state.tripPrimary ?? state.trip?.primary;
    const points = [];
    if (primary === "pressure") points.push([745, 545]);
    if (["load", "temperature", "speed"].includes(primary)) points.push([700, 580]);
    if (primary === "overflow") points.push([915, 300]);
    if (primary === "deadline") points.push([494, 313], [915, 313]);
    const phase = (options.realTime ?? 0) * 2.2;
    ctx.save();
    for (const [x, y] of points) {
      const ring = 11 + (phase % 1) * 26;
      ctx.strokeStyle = `rgba(255, 111, 97, ${0.72 - (phase % 1) * 0.55})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COLORS.red;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
      text(ctx, "TRIGGER", x, y + 23, 7, COLORS.red, "center", 700);
    }
    ctx.restore();
  }
}
