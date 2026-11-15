/* Canvas rendering: 3D attitude sphere, angular-velocity trace, error trace. */
(function (root) {
  "use strict";

  const TAU = Math.PI * 2;

  function drawSphere(canvas, st, torque) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(w, h) * 0.36;
    ctx.clearRect(0, 0, w, h);

    // grid sphere
    ctx.save();
    ctx.strokeStyle = "rgba(120,170,255,0.35)";
    ctx.lineWidth = 1;
    for (let ring = 1; ring <= 3; ring++) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, r, (r * ring) / 3.4, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.strokeStyle = "rgba(150,190,255,0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // cross axes
    ctx.beginPath();
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.strokeStyle = "rgba(120,170,255,0.25)";
    ctx.stroke();

    // gyroscope axis from tilt (qx,qy); project onto screen
    const sx = cx + st.qy * r * 2.2;
    const sy = cy + st.qx * r * 2.2;
    const grad = ctx.createRadialGradient(sx, sy, 2, sx, sy, r * 0.5);
    grad.addColorStop(0, "rgba(120,255,180,0.95)");
    grad.addColorStop(1, "rgba(40,120,90,0.25)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, r * 0.42, 0, TAU);
    ctx.fill();

    // axis stem
    ctx.strokeStyle = "#7dffb0";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(sx, sy);
    ctx.stroke();

    // force/torque arrow showing correction direction & trend
    const tx = torque && torque.x ? torque.x : 0;
    const ty = torque && torque.y ? torque.y : 0;
    const tmag = Math.hypot(tx, ty);
    if (tmag > 0.02) {
      const len = Math.min(r * 0.9, 12 + tmag * 26);
      const ax = sx + (-ty / tmag) * len;
      const ay = sy + (tx / tmag) * len;
      drawArrow(ctx, sx, sy, ax, ay, "#ffb347");
    }

    // center marker + tilt ring limit
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,90,90,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.97, 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawArrow(ctx, x0, y0, x1, y1, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    const ang = Math.atan2(y1 - y0, x1 - x0);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(
      x1 - 9 * Math.cos(ang - 0.4),
      y1 - 9 * Math.sin(ang - 0.4)
    );
    ctx.lineTo(
      x1 - 9 * Math.cos(ang + 0.4),
      y1 - 9 * Math.sin(ang + 0.4)
    );
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawTrace(canvas, series, opts) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;
    const pad = 26;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(10,18,32,0.55)";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1;
    ctx.font = "10px monospace";
    ctx.fillStyle = "rgba(200,215,240,0.7)";
    for (let g = 0; g <= 4; g++) {
      const y = pad + ((h - 2 * pad) * g) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - 6, y);
      ctx.stroke();
      const val = opts.max - ((opts.max - opts.min) * g) / 4;
      ctx.fillText(val.toFixed(opts.digits || 1), 2, y + 3);
    }

    series.forEach((line) => {
      const n = line.data.length;
      if (n < 2) return;
      ctx.strokeStyle = line.color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      line.data.forEach((v, i) => {
        const x = pad + ((w - pad - 8) * i) / (n - 1);
        const norm = (v - opts.min) / (opts.max - opts.min);
        const y = h - pad - norm * (h - 2 * pad);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });

    ctx.fillStyle = "rgba(220,230,255,0.85)";
    ctx.font = "11px monospace";
    ctx.fillText(opts.title, pad, 14);
    let lx = pad + 8;
    series.forEach((line) => {
      ctx.fillStyle = line.color;
      ctx.fillText(line.label, lx, h - 8);
      lx += ctx.measureText(line.label).width + 14;
    });
  }

  root.GyroRender = { drawSphere, drawTrace };
})(typeof self !== "undefined" ? self : this);
