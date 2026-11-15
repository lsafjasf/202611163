import {
  ACTION_RADIUS,
  RISK_RADIUS,
  RISK_ZONES,
  ROUTE_EDGES,
  SIDE_COLORS,
  TARGETS,
  WORLD,
} from "./config.js";

const TERRAIN = "#d9d4c4";
const INK = "#20231d";
const CONTOUR = "rgba(63, 69, 54, 0.19)";
const WATER = "#91b5b0";

const CONTOURS = [
  [220, 205, 180, 120, -0.28],
  [260, 218, 140, 92, -0.24],
  [300, 230, 100, 63, -0.2],
  [330, 242, 57, 35, -0.17],
  [520, 790, 240, 145, 0.2],
  [555, 772, 190, 108, 0.2],
  [590, 755, 142, 76, 0.18],
  [610, 746, 92, 46, 0.15],
  [1005, 190, 220, 124, 0.18],
  [1042, 205, 166, 94, 0.12],
  [1078, 214, 118, 64, 0.08],
  [1106, 222, 70, 40, 0.04],
  [1390, 690, 235, 152, -0.28],
  [1372, 720, 178, 112, -0.22],
  [1338, 746, 128, 76, -0.18],
  [1302, 762, 82, 46, -0.15],
  [760, 330, 115, 70, 0.4],
  [792, 338, 82, 48, 0.34],
  [832, 344, 52, 29, 0.3],
];

const DOTTED_POINTS = (() => {
  const points = [];
  let seed = 7351;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  for (let i = 0; i < 650; i += 1) {
    const x = random() * WORLD.width;
    const y = random() * WORLD.height;
    if (!isInWater(x, y)) points.push([x, y, random()]);
  }
  return points;
})();

function isInWater(x, y) {
  const riverX = 525 + Math.sin(y / 190) * 95 + y * 0.13;
  return Math.abs(x - riverX) < 72 || (x < 120 && y > 710);
}

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

function ellipsePath(ctx, x, y, rx, ry, rotation = 0, wobble = 0) {
  const steps = 72;
  ctx.beginPath();
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2;
    const ripple = 1 + Math.sin(angle * 3 + wobble) * 0.035;
    const px = Math.cos(angle) * rx * ripple;
    const py = Math.sin(angle) * ry * ripple;
    const xr = px * Math.cos(rotation) - py * Math.sin(rotation);
    const yr = px * Math.sin(rotation) + py * Math.cos(rotation);
    if (i === 0) ctx.moveTo(x + xr, y + yr);
    else ctx.lineTo(x + xr, y + yr);
  }
  ctx.closePath();
}

export class SurveyMap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.camera = { x: WORLD.width / 2, y: WORLD.height / 2, zoom: 1 };
    this.camera.baseScale = 0.5;
    this.lastFrame = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    const aspect = this.width / this.height;
    const cover = Math.max(this.width / WORLD.width, this.height / WORLD.height);
    const fit = Math.min(this.width / WORLD.width, this.height / WORLD.height);
    this.camera.baseScale = aspect > 1.13 ? cover * 0.94 : fit * 1.1;
    this.clampCamera();
  }

  get scale() {
    return this.camera.baseScale * this.camera.zoom;
  }

  worldToScreen(x, y) {
    return {
      x: (x - this.camera.x) * this.scale + this.width / 2,
      y: (y - this.camera.y) * this.scale + this.height / 2,
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.width / 2) / this.scale + this.camera.x,
      y: (y - this.height / 2) / this.scale + this.camera.y,
    };
  }

  clampCamera() {
    const visibleWidth = this.width / this.scale;
    const visibleHeight = this.height / this.scale;
    const marginX = Math.max(0, (visibleWidth - WORLD.width) / 2);
    const marginY = Math.max(0, (visibleHeight - WORLD.height) / 2);
    this.camera.x = Math.min(
      WORLD.width + marginX,
      Math.max(-marginX, this.camera.x),
    );
    this.camera.y = Math.min(
      WORLD.height + marginY,
      Math.max(-marginY, this.camera.y),
    );
  }

  setZoom(nextZoom, screenX = this.width / 2, screenY = this.height / 2) {
    const before = this.screenToWorld(screenX, screenY);
    this.camera.zoom = Math.max(0.72, Math.min(2.7, nextZoom));
    this.camera.x = before.x - (screenX - this.width / 2) / this.scale;
    this.camera.y = before.y - (screenY - this.height / 2) / this.scale;
    this.clampCamera();
    return this.camera.zoom;
  }

  zoomBy(factor, screenX, screenY) {
    return this.setZoom(this.camera.zoom * factor, screenX, screenY);
  }

  resetView() {
    this.camera.x = WORLD.width / 2;
    this.camera.y = WORLD.height / 2;
    this.camera.zoom = 1;
    this.clampCamera();
  }

  draw(state, time) {
    const ctx = this.ctx;
    const dt = Math.min(50, time - this.lastFrame);
    this.lastFrame = time;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawOutside(ctx);
    this.drawTerrain(ctx, dt);
    this.drawRoutes(ctx, state, time);
    this.drawRiskZones(ctx, state, time);
    this.drawTargets(ctx, state, time);
    this.drawSurveyPoints(ctx, state, time);
    this.drawCursors(ctx, state, time);
    this.drawFrameMarks(ctx, state);
  }

  drawOutside(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, this.width, this.height);
    gradient.addColorStop(0, "#cfcaba");
    gradient.addColorStop(0.55, "#d9d5c7");
    gradient.addColorStop(1, "#cbc6b7");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.save();
    ctx.globalAlpha = 0.16;
    ctx.strokeStyle = "#66675b";
    ctx.lineWidth = 0.5;
    const step = 34;
    for (let x = -this.height; x < this.width; x += step) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + this.height, this.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawTerrain(ctx) {
    const scale = this.scale;
    ctx.save();
    this.applyWorldTransform(ctx);

    const paper = ctx.createLinearGradient(0, 0, WORLD.width, WORLD.height);
    paper.addColorStop(0, "#dfdacb");
    paper.addColorStop(0.5, TERRAIN);
    paper.addColorStop(1, "#d3cebd");
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, WORLD.width, WORLD.height);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, WORLD.width, WORLD.height);
    ctx.clip();

    ctx.fillStyle = "rgba(97, 117, 76, 0.09)";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(728, 0);
    ctx.bezierCurveTo(670, 140, 752, 242, 672, 388);
    ctx.bezierCurveTo(626, 476, 610, 585, 664, 690);
    ctx.bezierCurveTo(560, 714, 446, 698, 356, 744);
    ctx.lineTo(0, 772);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(123, 123, 83, 0.075)";
    ctx.beginPath();
    ctx.moveTo(920, 0);
    ctx.bezierCurveTo(992, 126, 1082, 198, 1160, 284);
    ctx.bezierCurveTo(1268, 400, 1298, 582, 1402, 668);
    ctx.lineTo(WORLD.width, 670);
    ctx.lineTo(WORLD.width, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = "rgba(82, 112, 100, 0.1)";
    ctx.beginPath();
    ctx.moveTo(0, 838);
    ctx.bezierCurveTo(178, 794, 328, 856, 466, 850);
    ctx.bezierCurveTo(624, 842, 704, 912, 858, 930);
    ctx.lineTo(858, WORLD.height);
    ctx.lineTo(0, WORLD.height);
    ctx.closePath();
    ctx.fill();

    this.drawContours(ctx);
    this.drawWater(ctx);
    this.drawRoads(ctx);
    this.drawGrid(ctx);

    ctx.fillStyle = "rgba(55, 63, 45, 0.19)";
    for (const [x, y, size] of DOTTED_POINTS) {
      ctx.fillRect(x, y, size * 1.8 + 0.5, size * 1.8 + 0.5);
    }

    this.drawTerrainLabels(ctx);
    this.drawStructures(ctx);
    ctx.restore();

    ctx.strokeStyle = "rgba(29, 33, 26, 0.55)";
    ctx.lineWidth = 1 / scale;
    ctx.strokeRect(0.5 / scale, 0.5 / scale, WORLD.width - 1 / scale, WORLD.height - 1 / scale);
    ctx.restore();
  }

  applyWorldTransform(ctx) {
    ctx.translate(this.width / 2, this.height / 2);
    ctx.scale(this.scale, this.scale);
    ctx.translate(-this.camera.x, -this.camera.y);
  }

  drawContours(ctx) {
    ctx.save();
    ctx.strokeStyle = CONTOUR;
    ctx.lineWidth = 0.85 / this.scale;
    for (let index = 0; index < CONTOURS.length; index += 1) {
      const [x, y, rx, ry, rotation] = CONTOURS[index];
      ellipsePath(ctx, x, y, rx, ry, rotation, index * 0.7);
      ctx.stroke();
      if (index % 3 === 0) {
        ctx.fillStyle = "rgba(60, 65, 51, 0.35)";
        ctx.font = "7px 'Roboto Mono', monospace";
        ctx.fillText(`${180 + index * 20}`, x + rx * 0.4, y - ry * 0.62);
      }
    }
    ctx.restore();
  }

  drawWater(ctx) {
    const scale = this.scale;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    const river = new Path2D();
    river.moveTo(32, -40);
    river.bezierCurveTo(128, 128, 470, 158, 485, 346);
    river.bezierCurveTo(498, 490, 364, 550, 442, 674);
    river.bezierCurveTo(524, 798, 758, 760, 836, 878);
    river.bezierCurveTo(892, 962, 1064, 988, 1258, 1034);

    ctx.strokeStyle = "rgba(65, 85, 75, 0.25)";
    ctx.lineWidth = 98;
    ctx.stroke(river);
    ctx.strokeStyle = WATER;
    ctx.lineWidth = 86;
    ctx.stroke(river);
    ctx.strokeStyle = "rgba(226, 237, 227, 0.28)";
    ctx.lineWidth = 2 / scale;
    ctx.setLineDash([14 / scale, 17 / scale]);
    ctx.stroke(river);
    ctx.setLineDash([]);

    const waterGradient = ctx.createLinearGradient(330, 100, 850, 880);
    waterGradient.addColorStop(0, "rgba(222, 234, 228, 0.26)");
    waterGradient.addColorStop(1, "rgba(211, 229, 224, 0.05)");
    ctx.strokeStyle = waterGradient;
    ctx.lineWidth = 48;
    ctx.stroke(river);

    ctx.beginPath();
    ctx.ellipse(88, 884, 104, 148, -0.18, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(73, 94, 84, 0.25)";
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(88, 884, 91, 134, -0.18, 0, Math.PI * 2);
    ctx.fillStyle = WATER;
    ctx.fill();

    ctx.fillStyle = "rgba(49, 86, 84, 0.55)";
    ctx.font = "italic 11px 'Noto Sans SC', sans-serif";
    ctx.save();
    ctx.translate(560, 554);
    ctx.rotate(1.18);
    ctx.fillText("青 川 · QING RIVER", 0, 0);
    ctx.restore();
    ctx.restore();
  }

  drawRoads(ctx) {
    const scale = this.scale;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(72, 72, 56, 0.35)";
    ctx.lineWidth = 5 / scale;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(20, 532);
    ctx.bezierCurveTo(218, 468, 402, 548, 626, 456);
    ctx.bezierCurveTo(792, 388, 934, 466, 1092, 372);
    ctx.bezierCurveTo(1266, 270, 1332, 248, 1580, 288);
    ctx.stroke();
    ctx.strokeStyle = "rgba(241, 236, 216, 0.8)";
    ctx.lineWidth = 2.3 / scale;
    ctx.stroke();

    ctx.strokeStyle = "rgba(72, 72, 56, 0.4)";
    ctx.lineWidth = 3.4 / scale;
    ctx.setLineDash([7 / scale, 10 / scale]);
    ctx.beginPath();
    ctx.moveTo(184, 1000);
    ctx.bezierCurveTo(240, 842, 410, 764, 552, 686);
    ctx.bezierCurveTo(670, 620, 708, 500, 852, 436);
    ctx.bezierCurveTo(986, 376, 1052, 288, 1184, 94);
    ctx.stroke();

    ctx.setLineDash([2 / scale, 11 / scale]);
    ctx.lineWidth = 2.3 / scale;
    ctx.beginPath();
    ctx.moveTo(640, 1000);
    ctx.bezierCurveTo(678, 830, 936, 822, 1034, 690);
    ctx.bezierCurveTo(1094, 608, 1154, 554, 1380, 530);
    ctx.stroke();
    ctx.restore();
  }

  drawGrid(ctx) {
    const scale = this.scale;
    ctx.save();
    ctx.strokeStyle = "rgba(42, 47, 36, 0.11)";
    ctx.lineWidth = 0.65 / scale;
    ctx.fillStyle = "rgba(42, 47, 36, 0.38)";
    ctx.font = "6.5px 'Roboto Mono', monospace";
    for (let x = 100; x < WORLD.width; x += 100) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, WORLD.height);
      ctx.stroke();
      if (x % 200 === 0) ctx.fillText(`E${x.toString().padStart(4, "0")}`, x + 4, 10);
    }
    for (let y = 100; y < WORLD.height; y += 100) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(WORLD.width, y);
      ctx.stroke();
      if (y % 200 === 0) ctx.fillText(`N${y.toString().padStart(4, "0")}`, 5, y - 4);
    }
    ctx.restore();
  }

  drawTerrainLabels(ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(47, 53, 40, 0.48)";
    ctx.font = "600 10px 'Arial Narrow', 'Noto Sans SC', sans-serif";
    ctx.letterSpacing = "2px";
    ctx.fillText("北岸台地", 146, 148);
    ctx.fillText("松林缓坡", 1006, 764);
    ctx.fillText("盐沼保护区", 186, 912);
    ctx.font = "italic 8px 'Roboto Mono', monospace";
    ctx.fillStyle = "rgba(47, 53, 40, 0.4)";
    ctx.fillText("NORTH RIDGE", 146, 161);
    ctx.fillText("PINE SLOPE", 1006, 777);
    ctx.fillText("SALT MARSH", 186, 925);

    const heights = [
      [252, 254, "128"],
      [1042, 214, "214"],
      [1378, 706, "176"],
      [566, 758, "93"],
      [902, 624, "61"],
    ];
    ctx.fillStyle = "rgba(49, 54, 42, 0.5)";
    ctx.font = "6.5px 'Roboto Mono', monospace";
    for (const [x, y, height] of heights) {
      ctx.fillText(`+${height}`, x, y);
      ctx.beginPath();
      ctx.moveTo(x - 3, y - 2);
      ctx.lineTo(x + 6, y - 2);
      ctx.strokeStyle = "rgba(49, 54, 42, 0.5)";
      ctx.lineWidth = 0.8 / this.scale;
      ctx.stroke();
    }

    ctx.strokeStyle = "rgba(55, 61, 47, 0.32)";
    ctx.lineWidth = 0.8 / this.scale;
    ctx.beginPath();
    ctx.moveTo(1328, 858);
    ctx.lineTo(1428, 858);
    ctx.moveTo(1328, 850);
    ctx.lineTo(1328, 866);
    ctx.moveTo(1428, 850);
    ctx.lineTo(1428, 866);
    ctx.stroke();
    ctx.fillStyle = "rgba(49, 54, 42, 0.56)";
    ctx.font = "6.5px 'Roboto Mono', monospace";
    ctx.fillText("100 m", 1360, 850);
    ctx.restore();
  }

  drawStructures(ctx) {
    ctx.save();
    ctx.strokeStyle = "rgba(49, 54, 42, 0.42)";
    ctx.lineWidth = 0.8 / this.scale;
    ctx.fillStyle = "rgba(49, 54, 42, 0.11)";
    const buildings = [
      [1264, 534, 18, 10],
      [1290, 538, 8, 9],
      [1268, 550, 11, 7],
      [734, 150, 13, 8],
      [752, 154, 7, 7],
      [214, 414, 10, 8],
      [228, 412, 7, 6],
    ];
    for (const [x, y, w, h] of buildings) {
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
    ctx.fillStyle = "rgba(49, 54, 42, 0.55)";
    ctx.font = "6px 'Roboto Mono', monospace";
    ctx.fillText("NORTH BANK STATION", 1240, 525);
    ctx.beginPath();
    ctx.arc(1386, 566, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(1386, 554);
    ctx.lineTo(1386, 578);
    ctx.moveTo(1374, 566);
    ctx.lineTo(1398, 566);
    ctx.stroke();
    ctx.fillText("BM 07", 1376, 590);
    ctx.restore();
  }

  drawRoutes(ctx, state, time) {
    const scale = this.scale;
    ctx.save();
    this.applyWorldTransform(ctx);
    for (const route of state.routes) {
      const from = TARGETS.find((target) => target.id === route.from);
      const to = TARGETS.find((target) => target.id === route.to);
      if (!from || !to) continue;
      const color = route.ownerSide === "left" ? SIDE_COLORS.left : SIDE_COLORS.right;
      this.drawRouteSegment(ctx, from, to, color, scale, time, false);
    }

    if (state.selectedPointId) {
      const from = state.points.find((point) => point.targetId === state.selectedPointId);
      if (from) {
        const cursor = state.cursors.cartographer;
        ctx.strokeStyle = "rgba(20, 125, 112, 0.7)";
        ctx.lineWidth = 1.6 / scale;
        ctx.setLineDash([7 / scale, 7 / scale]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(cursor.x, cursor.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const tip = this.worldToScreen(cursor.x, cursor.y);
        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.fillStyle = "#147d70";
        ctx.font = "600 7px 'Roboto Mono', monospace";
        ctx.fillText(`待连 ${from.targetId}`, tip.x + 14, tip.y - 10);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  drawRouteSegment(ctx, from, to, color, scale, time, preview) {
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(28, 31, 24, 0.88)";
    ctx.lineWidth = (preview ? 5 : 7) / scale;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineWidth = (preview ? 2.4 : 3.4) / scale;
    ctx.stroke();

    if (!preview) {
      const progress = (time * 0.00042) % 1;
      const dotX = from.x + (to.x - from.x) * progress;
      const dotY = from.y + (to.y - from.y) * progress;
      ctx.fillStyle = "#fbf9f2";
      ctx.beginPath();
      ctx.arc(dotX, dotY, 2.1 / scale, 0, Math.PI * 2);
      ctx.fill();

      const midX = (from.x + to.x) / 2;
      const midY = (from.y + to.y) / 2;
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      ctx.save();
      ctx.translate(midX, midY);
      ctx.rotate(angle);
      ctx.fillStyle = "rgba(247, 244, 235, 0.94)";
      roundedRect(ctx, -22, -18, 44, 12, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(28, 31, 24, 0.35)";
      ctx.lineWidth = 0.7 / scale;
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.font = "600 5.7px 'Roboto Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(`${from.id}—${to.id}`, 0, -9.3);
      ctx.restore();
    }
  }

  drawRiskZones(ctx, state, time) {
    const scale = this.scale;
    ctx.save();
    this.applyWorldTransform(ctx);
    for (const zone of RISK_ZONES) {
      const connected = state.routes.some((route) => route.id === zone.routeId);
      const mark = state.risks.find((risk) => risk.zoneId === zone.id);
      const pulse = 1 + Math.sin(time * 0.004) * 0.12;
      const radius = 17 / scale;

      ctx.strokeStyle = connected
        ? "rgba(228, 115, 57, 0.72)"
        : "rgba(77, 78, 63, 0.3)";
      ctx.lineWidth = 1 / scale;
      ctx.setLineDash([4 / scale, 4 / scale]);
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, radius * (connected && !mark ? pulse : 1), 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      if (mark) {
        ctx.fillStyle = "#e47339";
        ctx.strokeStyle = "#20231d";
        ctx.lineWidth = 1.1 / scale;
        ctx.beginPath();
        ctx.arc(zone.x, zone.y, 9 / scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = "#fffaf0";
        ctx.beginPath();
        ctx.moveTo(zone.x, zone.y - 4.5 / scale);
        ctx.lineTo(zone.x + 4.5 / scale, zone.y + 3.8 / scale);
        ctx.lineTo(zone.x - 4.5 / scale, zone.y + 3.8 / scale);
        ctx.closePath();
        ctx.fill();

        this.drawWorldLabel(
          ctx,
          zone.x + 15 / scale,
          zone.y - 12 / scale,
          `${zone.id}  ${zone.label}`,
          "#e47339",
          scale,
          true,
        );
      } else {
        ctx.fillStyle = connected ? "rgba(228, 115, 57, 0.9)" : "rgba(70, 73, 60, 0.4)";
        ctx.beginPath();
        ctx.moveTo(zone.x, zone.y - 5 / scale);
        ctx.lineTo(zone.x + 5 / scale, zone.y + 4 / scale);
        ctx.lineTo(zone.x - 5 / scale, zone.y + 4 / scale);
        ctx.closePath();
        ctx.fill();
        this.drawWorldLabel(
          ctx,
          zone.x + 13 / scale,
          zone.y - 10 / scale,
          connected ? `待标 · ${zone.code}` : `未解锁 · ${zone.label}`,
          connected ? "#a74d25" : "#6c6c5e",
          scale,
          connected,
        );
      }
    }
    ctx.restore();
  }

  drawWorldLabel(ctx, x, y, text, color, scale, active) {
    ctx.save();
    ctx.fillStyle = active ? "rgba(247, 244, 235, 0.94)" : "rgba(247, 244, 235, 0.72)";
    ctx.strokeStyle = active ? "rgba(32, 35, 29, 0.34)" : "rgba(32, 35, 29, 0.18)";
    ctx.lineWidth = 0.7 / scale;
    ctx.font = `650 ${6.2 / scale}px 'Roboto Mono', monospace`;
    const width = ctx.measureText(text).width + 10 / scale;
    roundedRect(ctx, x, y - 6.5 / scale, width, 12 / scale, 1.5 / scale);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillText(text, x + 5 / scale, y + 1.6 / scale);
    ctx.restore();
  }

  drawTargets(ctx, state, time) {
    const scale = this.scale;
    ctx.save();
    this.applyWorldTransform(ctx);
    const surveyor = state.cursors.surveyor;
    for (const target of TARGETS) {
      if (state.points.some((point) => point.targetId === target.id)) continue;
      const distance = Math.hypot(surveyor.x - target.x, surveyor.y - target.y);
      const near = distance < ACTION_RADIUS;
      const pulse = 1 + Math.sin(time * 0.004 + target.x) * 0.12;
      const radius = (near ? 20 : 16) / scale * (near ? pulse : 1);

      ctx.strokeStyle = near ? "rgba(71, 91, 30, 0.9)" : "rgba(68, 72, 58, 0.45)";
      ctx.lineWidth = near ? 1.4 / scale : 0.9 / scale;
      ctx.setLineDash(near ? [] : [3 / scale, 5 / scale]);
      ctx.beginPath();
      ctx.arc(target.x, target.y, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      const tick = near ? 8 / scale : 6 / scale;
      ctx.beginPath();
      ctx.moveTo(target.x - tick, target.y);
      ctx.lineTo(target.x + tick, target.y);
      ctx.moveTo(target.x, target.y - tick);
      ctx.lineTo(target.x, target.y + tick);
      ctx.stroke();

      ctx.fillStyle = near ? "#20231d" : "rgba(47, 51, 40, 0.58)";
      ctx.beginPath();
      ctx.arc(target.x, target.y, 2 / scale, 0, Math.PI * 2);
      ctx.fill();

      this.drawWorldLabel(
        ctx,
        target.x + 20 / scale,
        target.y - 15 / scale,
        near ? `可布设 · ${target.id}` : target.id,
        near ? "#526d1f" : "#5a5c4f",
        scale,
        near,
      );
    }
    ctx.restore();
  }

  drawSurveyPoints(ctx, state, time) {
    const scale = this.scale;
    ctx.save();
    this.applyWorldTransform(ctx);
    state.points.forEach((point, index) => {
      const selected = state.selectedPointId === point.targetId;
      const pulse = 1 + Math.sin(time * 0.003 + index) * 0.08;
      ctx.save();
      ctx.translate(point.x, point.y);

      ctx.strokeStyle = "rgba(32, 35, 29, 0.17)";
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, 21 / scale, 0, Math.PI * 2);
      ctx.stroke();

      if (selected) {
        ctx.strokeStyle = "rgba(20, 125, 112, 0.8)";
        ctx.lineWidth = 1.3 / scale;
        ctx.setLineDash([3 / scale, 3 / scale]);
        ctx.beginPath();
        ctx.arc(0, 0, (25 / scale) * pulse, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.fillStyle = "#f7f4eb";
      ctx.strokeStyle = "#20231d";
      ctx.lineWidth = 1.2 / scale;
      ctx.beginPath();
      ctx.arc(0, 0, 9 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = SIDE_COLORS.left;
      ctx.beginPath();
      ctx.arc(0, 0, 5.2 / scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#20231d";
      ctx.beginPath();
      ctx.arc(0, 0, 1.5 / scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(32, 35, 29, 0.86)";
      roundedRect(ctx, 12 / scale, -18 / scale, 54 / scale, 18 / scale, 2 / scale);
      ctx.fill();
      ctx.fillStyle = "#f7f4eb";
      ctx.font = `700 ${6.5 / scale}px 'Roboto Mono', monospace`;
      ctx.fillText(point.targetId, 17 / scale, -7.2 / scale);
      ctx.fillStyle = "#c8f04b";
      ctx.font = `600 ${4.8 / scale}px 'Roboto Mono', monospace`;
      ctx.fillText(`P${point.ownerSide === "left" ? "1" : "2"} · 已测量`, 17 / scale, -12.6 / scale);
      ctx.restore();
    });
    ctx.restore();
  }

  drawCursors(ctx, state, time) {
    const scale = this.scale;
    ctx.save();
    this.applyWorldTransform(ctx);
    const roles = [
      ["surveyor", state.cursors.surveyor, "#a9cd31", "测量员"],
      ["cartographer", state.cursors.cartographer, "#168a7b", "制图员"],
    ];
    for (const [role, cursor, color, label] of roles) {
      const side = Object.keys(state.roleMap).find((key) => state.roleMap[key] === role);
      const isDebugInactive = state.debug && state.debugRole !== role;
      const isDebugActive = state.debug && state.debugRole === role;
      ctx.save();
      ctx.translate(cursor.x, cursor.y);
      ctx.globalAlpha = isDebugInactive ? 0.36 : 1;
      const pulse = (Math.sin(time * 0.006) + 1) * 0.5;

      ctx.fillStyle = `${color}22`;
      ctx.beginPath();
      ctx.arc(0, 0, (23 + pulse * 3) / scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = color;
      ctx.lineWidth = (isDebugActive ? 1.5 : 1.1) / scale;
      ctx.beginPath();
      ctx.arc(0, 0, 13 / scale, 0, Math.PI * 2);
      ctx.stroke();

      const arm = 7 / scale;
      ctx.beginPath();
      ctx.moveTo(-19 / scale, 0);
      ctx.lineTo(-arm, 0);
      ctx.moveTo(19 / scale, 0);
      ctx.lineTo(arm, 0);
      ctx.moveTo(0, -19 / scale);
      ctx.lineTo(0, -arm);
      ctx.moveTo(0, 19 / scale);
      ctx.lineTo(0, arm);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, 2.5 / scale, 0, Math.PI * 2);
      ctx.fill();

      const tag = state.debug
        ? `${isDebugActive ? "调试" : "托管"} · ${label}`
        : `P${side === "left" ? "1" : "2"} · ${label}`;
      ctx.font = `700 ${6.5 / scale}px 'Roboto Mono', monospace`;
      const tagWidth = ctx.measureText(tag).width + 13 / scale;
      ctx.fillStyle = "#20231d";
      roundedRect(ctx, 17 / scale, 14 / scale, tagWidth, 16 / scale, 1.5 / scale);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.fillRect(17 / scale, 14 / scale, 2 / scale, 16 / scale);
      ctx.fillStyle = "#f7f4eb";
      ctx.fillText(tag, 23 / scale, 24.4 / scale);
      ctx.restore();
    }
    ctx.restore();
  }

  drawFrameMarks(ctx, state) {
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = "rgba(23, 26, 21, 0.5)";
    ctx.lineWidth = 1;
    const length = 12;
    const inset = 7;
    const corners = [
      [inset, inset, 1, 1],
      [this.width - inset, inset, -1, 1],
      [inset, this.height - inset, 1, -1],
      [this.width - inset, this.height - inset, -1, -1],
    ];
    for (const [x, y, dx, dy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + dx * length, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + dy * length);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(32, 35, 29, 0.45)";
    ctx.font = "600 6.5px 'Roboto Mono', monospace";
    ctx.fillText("NB–07 / WGS84", 16, this.height - 9);
    if (state.status === "paused") {
      ctx.fillStyle = "rgba(32, 35, 29, 0.26)";
      ctx.fillRect(0, 0, this.width, this.height);
    }
    ctx.restore();
  }
}
