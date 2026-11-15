import { STATIONS, DURATION_S, fmt } from "./data.js";

const PAD_L = 64;
const PAD_R = 18;

export function timeFromTimelineX(canvas, x) {
  const plotW = canvas.width - PAD_L - PAD_R;
  const t = ((x - PAD_L) / plotW) * DURATION_S;
  return Math.max(0, Math.min(DURATION_S, t));
}

export function drawTimeline(canvas, state) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const plotW = w - PAD_L - PAD_R;
  const xFor = (t) => PAD_L + (t / DURATION_S) * plotW;

  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#0c1320";
  ctx.fillRect(0, 0, w, h);

  // 当前窗口高亮
  const wx0 = xFor(state.winStart);
  const wx1 = xFor(state.winEnd);
  ctx.fillStyle = "rgba(74,144,217,0.16)";
  ctx.fillRect(wx0, 8, wx1 - wx0, h - 16);
  ctx.strokeStyle = "#4a90d9";
  ctx.strokeRect(wx0, 8, wx1 - wx0, h - 16);

  // 秒刻度
  ctx.font = "10px sans-serif";
  for (let sec = 0; sec <= DURATION_S; sec += 2) {
    const gx = xFor(sec);
    ctx.strokeStyle = "#22344f";
    ctx.beginPath(); ctx.moveTo(gx, 8); ctx.lineTo(gx, h - 8); ctx.stroke();
    ctx.fillStyle = "#8fa3bf";
    ctx.fillText(`${sec}`, gx - 5, h - 1);
  }

  // 各台站理论到达（虚线）与拾取（实心三角）
  STATIONS.forEach((station, idx) => {
    const y = 18 + idx * 14;
    const ax = xFor(station.arrivalS);
    ctx.strokeStyle = "rgba(127,209,168,0.65)";
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(ax, y - 6); ctx.lineTo(ax, y + 6); ctx.stroke();
    ctx.setLineDash([]);

    const pick = state.picks[station.id];
    if (pick !== undefined && pick !== null) {
      const px = xFor(pick);
      ctx.fillStyle = "#ffd479";
      ctx.beginPath();
      ctx.moveTo(px, y - 7); ctx.lineTo(px - 5, y + 5); ctx.lineTo(px + 5, y + 5);
      ctx.closePath(); ctx.fill();
    }
  });

  // 播放头
  const cx = xFor(state.currentTime);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx, 6); ctx.lineTo(cx, h - 6); ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(fmt(state.currentTime, 2) + "s", cx + 5, 14);

  ctx.fillStyle = "#9fc0e8";
  ctx.font = "11px sans-serif";
  ctx.fillText("全程时间轴（拖动定位；虚线=理论到达，三角=拾取）", 8, 14);
}
