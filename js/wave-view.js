import { STATIONS, SAMPLE_STEP, fmt } from "./data.js";

const PAD_L = 64;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 26;
const TRACE_GAP = 14;

export function traceLayout(canvas, visibleCount) {
  const plotH = canvas.height - PAD_T - PAD_B;
  const traceH = (plotH - TRACE_GAP * (visibleCount - 1)) / visibleCount;
  return { plotH, traceH };
}

export function xForTime(canvas, time, winStart, winEnd) {
  const plotW = canvas.width - PAD_L - PAD_R;
  return PAD_L + ((time - winStart) / (winEnd - winStart)) * plotW;
}

export function timeForX(canvas, x, winStart, winEnd) {
  const plotW = canvas.width - PAD_L - PAD_R;
  return winStart + ((x - PAD_L) / plotW) * (winEnd - winStart);
}

export function stationAtY(canvas, visibleStations, y) {
  const list = STATIONS.filter((s) => visibleStations.has(s.id));
  const { traceH } = traceLayout(canvas, list.length);
  for (let i = 0; i < list.length; i += 1) {
    const top = PAD_T + i * (traceH + TRACE_GAP);
    if (y >= top && y <= top + traceH) return list[i].id;
  }
  return null;
}

export function drawWaveforms(canvas, state) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const { winStart, winEnd } = state;
  const list = STATIONS.filter((s) => state.visibleStations.has(s.id));
  const { traceH } = traceLayout(canvas, Math.max(1, list.length));

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1320";
  ctx.fillRect(0, 0, w, h);

  list.forEach((station, idx) => {
    const top = PAD_T + idx * (traceH + TRACE_GAP);
    const mid = top + traceH / 2;
    const amp = traceH * 0.36;
    const samples = state.samplesByStation[station.id];

    // 通道背景与边框
    ctx.fillStyle = idx % 2 ? "#0e1726" : "#0d1524";
    ctx.fillRect(PAD_L, top, w - PAD_L - PAD_R, traceH);
    ctx.strokeStyle = "#22344f";
    ctx.strokeRect(PAD_L, top, w - PAD_L - PAD_R, traceH);

    // 零轴与时间网格
    ctx.strokeStyle = "#2a3d59";
    ctx.beginPath(); ctx.moveTo(PAD_L, mid); ctx.lineTo(w - PAD_R, mid); ctx.stroke();
    ctx.fillStyle = "#8fa3bf";
    ctx.font = "11px sans-serif";
    for (let sec = Math.ceil(winStart); sec <= winEnd; sec += 2) {
      const gx = xForTime(canvas, sec, winStart, winEnd);
      ctx.strokeStyle = "#1b2940";
      ctx.beginPath(); ctx.moveTo(gx, top); ctx.lineTo(gx, top + traceH); ctx.stroke();
      ctx.fillText(`${sec}s`, gx - 8, top + traceH - 4);
    }

    // 缺失缺口高亮
    let gapStart = null;
    const markGap = (tEnd) => {
      if (gapStart === null) return;
      const x0 = xForTime(canvas, gapStart, winStart, winEnd);
      const x1 = xForTime(canvas, tEnd, winStart, winEnd);
      ctx.fillStyle = "rgba(255,180,84,0.18)";
      ctx.fillRect(x0, top, Math.max(1, x1 - x0), traceH);
      gapStart = null;
    };

    // 波形折线（断开缺失段）
    ctx.strokeStyle = station.color;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    let penDown = false;
    for (const s of samples) {
      if (s.t < winStart - SAMPLE_STEP || s.t > winEnd + SAMPLE_STEP) continue;
      const x = xForTime(canvas, s.t, winStart, winEnd);
      if (s.isMissing) {
        if (gapStart === null) gapStart = s.t;
        penDown = false;
        continue;
      }
      markGap(s.t);
      const y = mid - Math.max(-1.6, Math.min(1.6, s.v)) * amp;
      if (!penDown) { ctx.moveTo(x, y); penDown = true; } else ctx.lineTo(x, y);
    }
    markGap(winEnd);
    ctx.stroke();

    // 异常点
    ctx.fillStyle = "#ff7a7a";
    for (const s of samples) {
      if (!s.isAnomaly || s.t < winStart || s.t > winEnd) continue;
      const x = xForTime(canvas, s.t, winStart, winEnd);
      const y = mid - Math.max(-1.6, Math.min(1.6, s.v)) * amp;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
    }

    // 理论到达竖线
    if (station.arrivalS >= winStart && station.arrivalS <= winEnd) {
      const ax = xForTime(canvas, station.arrivalS, winStart, winEnd);
      ctx.strokeStyle = "rgba(127,209,168,0.7)";
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(ax, top); ctx.lineTo(ax, top + traceH); ctx.stroke();
      ctx.setLineDash([]);
    }

    // 用户拾取线
    const pick = state.picks[station.id];
    if (pick !== undefined && pick !== null && pick >= winStart && pick <= winEnd) {
      const px = xForTime(canvas, pick, winStart, winEnd);
      ctx.strokeStyle = "#ffd479";
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(px, top); ctx.lineTo(px, top + traceH); ctx.stroke();
      ctx.fillStyle = "#ffd479";
      ctx.fillText(`P ${fmt(pick, 2)}s`, px + 4, top + 12);
    }

    // 通道标签
    ctx.fillStyle = station.color;
    ctx.font = "12px sans-serif";
    ctx.fillText(station.id, 8, mid + 4);
  });

  // 播放头
  if (state.currentTime >= winStart && state.currentTime <= winEnd) {
    const cx = xForTime(canvas, state.currentTime, winStart, winEnd);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(cx, PAD_T); ctx.lineTo(cx, h - PAD_B); ctx.stroke();
  }
}
