const STATUS_COLORS = Object.freeze({
  ok: "rgba(92, 186, 150, 0.46)",
  random: "#ffc857",
  mismatch: "#ff646a",
  error: "#ff715b",
});

export function tickToX(tick, endTick, width, padding = 28) {
  if (endTick <= 0) {
    return padding;
  }
  return padding + (tick / endTick) * (width - padding * 2);
}

export function xToTick(x, endTick, width, padding = 28) {
  const ratio = (x - padding) / (width - padding * 2);
  return Math.max(0, Math.min(endTick, Math.round(ratio * endTick)));
}

export function drawTimeline(ctx, view) {
  const {
    width,
    height,
    endTick,
    timeline = [],
    inputs = [],
    cursor = 0,
    randomDivergence = null,
    stateDivergence = null,
    errors = [],
  } = view;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#06121b";
  ctx.fillRect(0, 0, width, height);

  const laneY = Math.round(height * 0.56);
  const left = 28;
  const right = width - 28;
  ctx.fillStyle = "rgba(110, 231, 255, 0.08)";
  ctx.fillRect(left, laneY - 7, right - left, 14);

  const points = Math.max(1, Math.min(endTick + 1, Math.floor(right - left)));
  let runStatus = null;
  let runStart = 0;
  const paintRun = (endIndex) => {
    if (!runStatus) {
      return;
    }
    const startX = tickToX(runStart, endTick, width);
    const endX = tickToX(endIndex, endTick, width);
    ctx.fillStyle = STATUS_COLORS[runStatus] ?? STATUS_COLORS.ok;
    ctx.fillRect(startX, laneY - 4, Math.max(1, endX - startX), 8);
  };
  for (let index = 0; index < points; index += 1) {
    const tick = Math.round((index / Math.max(1, points - 1)) * endTick);
    const status = timeline[tick] ?? "ok";
    if (status !== runStatus) {
      paintRun(tick);
      runStatus = status;
      runStart = tick;
    }
  }
  paintRun(endTick);

  ctx.strokeStyle = "rgba(110, 231, 255, 0.14)";
  ctx.lineWidth = 1;
  for (let index = 0; index <= 4; index += 1) {
    const tick = Math.round((index / 4) * endTick);
    const x = tickToX(tick, endTick, width);
    ctx.beginPath();
    ctx.moveTo(x, 16);
    ctx.lineTo(x, height - 17);
    ctx.stroke();
    ctx.fillStyle = "#557786";
    ctx.font =
      '10px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
    ctx.textAlign = index === 0 ? "left" : index === 4 ? "right" : "center";
    ctx.fillText(`T${tick}`, x, height - 5);
  }

  for (const input of inputs) {
    const x = tickToX(input.tick, endTick, width);
    const isDown = input.phase === "down";
    const color =
      input.action === "dash"
        ? "#ffc857"
        : input.action === "left"
          ? "#6ee7ff"
          : "#b2a1ff";
    ctx.strokeStyle = color;
    ctx.globalAlpha = isDown ? 0.9 : 0.45;
    ctx.beginPath();
    ctx.moveTo(x, laneY - (isDown ? 15 : 11));
    ctx.lineTo(x, laneY + (isDown ? 15 : 11));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  for (const error of errors) {
    if (error.tick === null || error.tick === undefined) {
      continue;
    }
    const x = tickToX(
      Math.max(0, Math.min(endTick, error.tick)),
      endTick,
      width,
    );
    ctx.fillStyle = STATUS_COLORS.error;
    ctx.beginPath();
    ctx.moveTo(x, laneY - 18);
    ctx.lineTo(x + 5, laneY - 26);
    ctx.lineTo(x - 5, laneY - 26);
    ctx.closePath();
    ctx.fill();
  }

  const marker = (divergence, color, label) => {
    if (!divergence) {
      return;
    }
    const x = tickToX(divergence.tick, endTick, width);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, laneY - 11);
    ctx.lineTo(x + 7, laneY - 20);
    ctx.lineTo(x, laneY - 29);
    ctx.lineTo(x - 7, laneY - 20);
    ctx.closePath();
    ctx.fill();
    ctx.font =
      '700 10px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
    ctx.textAlign = x > width - 130 ? "right" : "left";
    ctx.fillText(label, x + (x > width - 130 ? -10 : 10), 20);
  };
  marker(randomDivergence, "#ffc857", "RNG");
  marker(stateDivergence, "#ff646a", "STATE");

  const cursorX = tickToX(cursor, endTick, width);
  ctx.strokeStyle = "#f4fdff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cursorX, 12);
  ctx.lineTo(cursorX, height - 18);
  ctx.stroke();
  ctx.fillStyle = "#f4fdff";
  ctx.beginPath();
  ctx.arc(cursorX, laneY, 4, 0, Math.PI * 2);
  ctx.fill();
}
