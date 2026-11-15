// Canvas renderer: building, window frames, arm, cables, gondola, wind
// streaks, and both instrument panels. Pure drawing; no game logic.
import { CONFIG, gondolaPos, panelView } from './sim.js';

const WORLD = { xMin: -17, xMax: 17, yMax: 29 };

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  let streaks = [];

  function scale() {
    return canvas.height / WORLD.yMax;
  }
  function toPx(x, y) {
    const s = scale();
    return [canvas.width / 2 + x * s, canvas.height - 2 * s - y * s];
  }

  function draw(state, ui) {
    const s = scale();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSky();
    drawBuilding(state);
    drawWind(state, ui);
    drawRig(state);
    drawPanels(state, ui);
    drawTopBar(state, ui);
    if (ui.overlay) drawOverlay(ui.overlay, ui.overlaySub);
  }

  function drawSky() {
    const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
    grad.addColorStop(0, '#0d1b2a');
    grad.addColorStop(1, '#1b3a4b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  function drawBuilding(state) {
    const s = scale();
    const [bx] = toPx(0, 0);
    ctx.fillStyle = '#2b2d42';
    ctx.fillRect(0, 0, canvas.width, canvas.height - 1.2 * s);
    ctx.fillStyle = '#8d99ae';
    ctx.fillRect(0, canvas.height - 1.2 * s, canvas.width, 1.2 * s);
    for (const r of state.repairs) {
      const [x, y] = toPx(r.x, r.y);
      const w = 2.4 * s;
      const h = 3.0 * s;
      ctx.fillStyle = r.done ? '#2a9d8f' : r.progress > 0 ? '#e9c46a' : '#14213d';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
      ctx.strokeStyle = r.done ? '#7bf1a8' : '#fcbf49';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - w / 2, y - h / 2, w, h);
      ctx.beginPath();
      ctx.moveTo(x, y - h / 2);
      ctx.lineTo(x, y + h / 2);
      ctx.moveTo(x - w / 2, y);
      ctx.lineTo(x + w / 2, y);
      ctx.stroke();
      if (!r.done && r.progress > 0) {
        ctx.strokeStyle = '#7bf1a8';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(x, y, 1.7 * s, -Math.PI / 2, -Math.PI / 2 + (r.progress / CONFIG.repairDwell) * Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function drawWind(state, ui) {
    const s = scale();
    if (Math.abs(state.wind.force) > 0.05) {
      const dir = Math.sign(state.wind.force);
      if (Math.random() < 0.5) {
        streaks.push({
          x: dir > 0 ? WORLD.xMin : WORLD.xMax,
          y: 2 + Math.random() * (WORLD.yMax - 4),
          v: dir * (8 + Math.random() * 6),
          life: 1,
        });
      }
    }
    ctx.strokeStyle = 'rgba(174, 217, 224, 0.55)';
    ctx.lineWidth = 1.5;
    streaks = streaks.filter((p) => p.life > 0);
    for (const p of streaks) {
      p.x += (p.v * 1) / 60;
      p.life -= 0.008;
      const [x, y] = toPx(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - p.v * 0.35 * s, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawRig(state) {
    const s = scale();
    const pos = gondolaPos(state);
    const [ax, ay] = toPx(state.arm.x, 0.4);
    const [gx, gy] = toPx(pos.x, pos.y);
    // rail and trolley
    const [rx0] = toPx(CONFIG.armMin - 1, 0.4);
    const [rx1] = toPx(CONFIG.armMax + 1, 0.4);
    ctx.strokeStyle = '#6c757d';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(rx0, ay);
    ctx.lineTo(rx1, ay);
    ctx.stroke();
    ctx.fillStyle = '#e9c46a';
    ctx.fillRect(ax - 0.5 * s, ay - 0.35 * s, 1.0 * s, 0.7 * s);
    // twin cables
    ctx.strokeStyle = state.tension > CONFIG.tensionWarn ? '#ef476f' : '#dee2e6';
    ctx.lineWidth = 2;
    for (const off of [-0.45, 0.45]) {
      ctx.beginPath();
      ctx.moveTo(ax + off * s * 0.4, ay);
      ctx.lineTo(gx + off * s, gy - 0.5 * s);
      ctx.stroke();
    }
    // gondola basket + repairman
    ctx.fillStyle = '#f4a261';
    ctx.fillRect(gx - 0.8 * s, gy - 0.5 * s, 1.6 * s, 1.0 * s);
    ctx.strokeStyle = '#432818';
    ctx.strokeRect(gx - 0.8 * s, gy - 0.5 * s, 1.6 * s, 1.0 * s);
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(gx, gy - 0.75 * s, 0.22 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPanels(state, ui) {
    drawPanel(state, 'L', 10, ui);
    drawPanel(state, 'R', canvas.width - 210, ui);
  }

  function drawPanel(state, seat, x0, ui) {
    const v = panelView(state, seat);
    const y0 = 10;
    const w = 200;
    const h = 118;
    ctx.fillStyle = 'rgba(13, 27, 42, 0.85)';
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeStyle = seat === 'L' ? '#4cc9f0' : '#f72585';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, w, h);
    ctx.fillStyle = '#edf2f4';
    ctx.font = '12px monospace';
    const duty = v.axis === 'both' ? '升降+摆臂 (调试)' : v.axis === 'hoist' ? '升降' : '摆臂';
    ctx.fillText(`${seat === 'L' ? '左席' : '右席'} · ${duty}`, x0 + 8, y0 + 16);
    bar(x0 + 8, y0 + 26, w - 16, 10, v.tension / CONFIG.tensionMax, '#ef476f', `张力 ${v.tension}N`);
    bar(x0 + 8, y0 + 48, w - 16, 10, v.resource / CONFIG.resourceMax, '#06d6a0', `能源 ${Math.round(v.resource)}%`);
    ctx.fillStyle = '#edf2f4';
    ctx.fillText(`倒计时 ${Math.ceil(v.timeLeft)}s`, x0 + 8, y0 + 80);
    ctx.fillText(`维修 ${v.repairsDone}/3`, x0 + 110, y0 + 80);
    const windArrow = v.wind > 0.05 ? '→' : v.wind < -0.05 ? '←' : '·';
    ctx.fillText(`风 ${windArrow} ${Math.abs(v.wind).toFixed(1)}`, x0 + 8, y0 + 96);
    ctx.fillStyle = '#8d99ae';
    const keys = seat === 'L' ? 'W/S 驱动 F 急停' : '↑/↓ 驱动 Enter 急停';
    ctx.fillText(state.solo ? 'W/S+A/D 双全控' : keys, x0 + 8, y0 + 111);
  }

  function bar(x, y, w, h, ratio, color, label) {
    ctx.fillStyle = '#212529';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * Math.max(0, Math.min(1, ratio)), h);
    ctx.fillStyle = '#adb5bd';
    ctx.font = '9px monospace';
    ctx.fillText(label, x + 2, y + h + 9);
    ctx.font = '12px monospace';
  }

  function drawTopBar(state, ui) {
    ctx.fillStyle = 'rgba(13, 27, 42, 0.85)';
    ctx.fillRect(canvas.width / 2 - 190, 10, 380, 30);
    ctx.fillStyle = '#ffd166';
    ctx.font = '13px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(ui.hint, canvas.width / 2, 29);
    ctx.textAlign = 'left';
    if (ui.mode === 'replay') {
      ctx.fillStyle = '#4cc9f0';
      ctx.fillText(ui.replayInfo, canvas.width / 2 - 190, 56);
    }
  }

  function drawOverlay(title, sub) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(title, canvas.width / 2, canvas.height / 2 - 10);
    ctx.font = '15px monospace';
    ctx.fillText(sub, canvas.width / 2, canvas.height / 2 + 24);
    ctx.textAlign = 'left';
  }

  return { draw };
}
