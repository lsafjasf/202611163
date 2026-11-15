import { SOURCE, STATIONS, WAVE_SPEED_KM_S, DURATION_S } from "./data.js";

const PADDING = 46;

export function mapProjector(canvas) {
  const bounds = 22; // 数据坐标范围约 ±22 km
  const scale = Math.min(
    (canvas.width - PADDING * 2) / (bounds * 2),
    (canvas.height - PADDING * 2) / (bounds * 2),
  );
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  return {
    toPixel(x, y) {
      return [cx + x * scale, cy - y * scale];
    },
    scale,
  };
}

function drawGrid(ctx, w, h) {
  ctx.strokeStyle = "#1b2940";
  ctx.lineWidth = 1;
  for (let gx = 0; gx <= w; gx += 40) {
    ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, h); ctx.stroke();
  }
  for (let gy = 0; gy <= h; gy += 40) {
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
  }
}

export function drawMap(canvas, state) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const { toPixel, scale } = mapProjector(canvas);

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1320";
  ctx.fillRect(0, 0, w, h);
  drawGrid(ctx, w, h);

  // 震源
  const [sx, sy] = toPixel(SOURCE.x, SOURCE.y);
  ctx.fillStyle = "#ff5d5d";
  ctx.beginPath();
  ctx.arc(sx, sy, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#ffb0b0";
  ctx.font = "13px sans-serif";
  ctx.fillText(SOURCE.name, sx + 11, sy - 9);

  // 扩散圈：半径 = 波速 × 播放时间，超出画面后停止生成
  const radiusKm = WAVE_SPEED_KM_S * Math.min(state.currentTime, DURATION_S);
  const radii = [radiusKm, Math.max(0, radiusKm - 7), Math.max(0, radiusKm - 14)];
  radii.forEach((r, i) => {
    if (r <= 0) return;
    ctx.strokeStyle = `rgba(90,170,255,${0.55 - i * 0.17})`;
    ctx.lineWidth = 2 - i * 0.5;
    ctx.beginPath();
    ctx.arc(sx, sy, r * scale, 0, Math.PI * 2);
    ctx.stroke();
  });

  // 台站、连线、拾取标记
  for (const station of STATIONS) {
    const visible = state.visibleStations.has(station.id);
    const [px, py] = toPixel(station.x, station.y);
    ctx.globalAlpha = visible ? 1 : 0.25;

    ctx.strokeStyle = "rgba(120,150,190,0.45)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, py); ctx.stroke();
    ctx.setLineDash([]);

    const arrived = state.currentTime >= station.arrivalS;
    ctx.fillStyle = station.color;
    ctx.beginPath();
    ctx.arc(px, py, arrived ? 8 : 6, 0, Math.PI * 2);
    ctx.fill();
    if (arrived) {
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(px, py, 11, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.fillStyle = "#dce4f0";
    ctx.font = "12px sans-serif";
    ctx.fillText(
      `${station.name} ${station.distanceKm.toFixed(1)}km 理论到达${station.arrivalS.toFixed(2)}s`,
      px + 11, py + 4,
    );

    const pick = state.picks[station.id];
    if (pick !== undefined && pick !== null) {
      ctx.strokeStyle = "#ffd479";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px - 10, py - 10); ctx.lineTo(px + 10, py + 10);
      ctx.moveTo(px + 10, py - 10); ctx.lineTo(px - 10, py + 10);
      ctx.stroke();
      ctx.fillStyle = "#ffd479";
      ctx.fillText(`拾取 ${pick.toFixed(2)}s`, px + 11, py + 20);
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = "#8fa3bf";
  ctx.font = "11px sans-serif";
  ctx.fillText(`波速 ${WAVE_SPEED_KM_S} km/s，扩散半径随播放时间同步增长`, 12, h - 12);
}
