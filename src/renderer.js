export const RENDER_PROFILES = Object.freeze({
  full: {
    id: "full",
    label: "完整视觉",
    stars: 46,
    scanlines: 22,
    trail: 18,
    gridColumns: 16,
    gradients: true,
    shadows: true,
  },
  lean: {
    id: "lean",
    label: "精简视觉",
    stars: 14,
    scanlines: 5,
    trail: 4,
    gridColumns: 7,
    gradients: false,
    shadows: false,
  },
});

const COLORS = Object.freeze({
  ink: "#d9f8ff",
  dim: "#5c8291",
  cyan: "#6ee7ff",
  cyanSoft: "rgba(110, 231, 255, 0.18)",
  coral: "#ff715b",
  amber: "#ffc857",
  green: "#8ef0ba",
  red: "#ff646a",
  panel: "rgba(4, 13, 22, 0.82)",
});

function makeMetrics() {
  return {
    frames: 0,
    drawCalls: 0,
    particleDraws: 0,
    gradientCalls: 0,
    shadowCalls: 0,
    stars: 0,
    scanlines: 0,
    peakLiveShapes: 0,
    renderMs: 0,
  };
}

function resetMetrics(metrics) {
  for (const key of Object.keys(metrics)) {
    metrics[key] = 0;
  }
}

function frameCounters(profile) {
  return {
    liveShapes: 0,
    drawCalls: 0,
    particleDraws: 0,
    gradientCalls: 0,
    shadowCalls: 0,
  };
}

function drawBackground(ctx, width, height, tick, profile, counters) {
  ctx.fillStyle = "#030a11";
  ctx.fillRect(0, 0, width, height);
  counters.drawCalls += 1;

  if (profile.gradients) {
    const sky = ctx.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "rgba(5, 25, 39, 0.96)");
    sky.addColorStop(0.62, "rgba(3, 10, 17, 0.98)");
    sky.addColorStop(1, "rgba(10, 18, 26, 1)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, width, height);
    counters.drawCalls += 1;
    counters.gradientCalls += 1;
  }

  for (let index = 0; index < profile.stars; index += 1) {
    const speed = 0.08 + (index % 5) * 0.025;
    const x = ((index * 137 + tick * speed) % (width + 40)) - 20;
    const y = (index * 83 + Math.sin(index * 1.7 + tick * 0.001) * 28) % height;
    const radius = index % 9 === 0 ? 1.6 : 0.8;
    ctx.fillStyle =
      index % 11 === 0 ? "rgba(255, 200, 87, 0.7)" : "rgba(110, 231, 255, 0.38)";
    ctx.fillRect(x, Math.abs(y), radius, radius);
    counters.drawCalls += 1;
    counters.particleDraws += 1;
  }
  counters.liveShapes += profile.stars;

  ctx.strokeStyle = "rgba(77, 145, 168, 0.08)";
  ctx.lineWidth = 1;
  for (let index = 0; index < profile.gridColumns; index += 1) {
    const x = (index / profile.gridColumns) * width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
    counters.drawCalls += 1;
  }
  for (let index = 0; index <= 5; index += 1) {
    const y = (index / 5) * height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    counters.drawCalls += 1;
  }
  counters.liveShapes += profile.gridColumns + 6;

  if (profile.gradients) {
    const horizon = ctx.createLinearGradient(0, height * 0.74, 0, height);
    horizon.addColorStop(0, "rgba(110, 231, 255, 0)");
    horizon.addColorStop(1, "rgba(110, 231, 255, 0.075)");
    ctx.fillStyle = horizon;
    ctx.fillRect(0, height * 0.74, width, height * 0.26);
    counters.drawCalls += 1;
    counters.gradientCalls += 1;
  }

  if (profile.shadows) {
    ctx.save();
    ctx.strokeStyle = "rgba(110, 231, 255, 0.22)";
    ctx.shadowColor = COLORS.cyan;
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.moveTo(0, height * 0.84);
    ctx.lineTo(width, height * 0.84);
    ctx.stroke();
    ctx.restore();
    counters.drawCalls += 1;
    counters.shadowCalls += 1;
  }

  for (let index = 0; index < profile.scanlines; index += 1) {
    const y = (index / profile.scanlines) * height;
    ctx.fillStyle = "rgba(104, 193, 219, 0.035)";
    ctx.fillRect(0, y, width, 1);
    counters.drawCalls += 1;
  }
  counters.liveShapes += profile.scanlines;
}

function drawEntity(ctx, entity, width, height, tick, profile, counters) {
  const x = entity.x * width;
  const y = entity.y * height;
  const radius = entity.size * width;
  const color = entity.kind === "pulse" ? COLORS.cyan : COLORS.coral;
  const trailStep = entity.kind === "pulse" ? 7 : 9;

  for (let index = 0; index < profile.trail; index += 1) {
    const trailY = y - index * trailStep;
    if (trailY < 0) {
      break;
    }
    const alpha = ((profile.trail - index) / profile.trail) * 0.34;
    ctx.fillStyle =
      entity.kind === "pulse"
        ? `rgba(110, 231, 255, ${alpha})`
        : `rgba(255, 113, 91, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, trailY, Math.max(1, radius * (1 - index * 0.04)), 0, Math.PI * 2);
    ctx.fill();
    counters.drawCalls += 1;
    counters.particleDraws += 1;
    counters.liveShapes += 1;
  }

  if (profile.gradients) {
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 2.8);
    glow.addColorStop(0, entity.kind === "pulse" ? "rgba(110,231,255,.5)" : "rgba(255,113,91,.42)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, radius * 2.8, 0, Math.PI * 2);
    ctx.fill();
    counters.gradientCalls += 1;
    counters.drawCalls += 1;
    counters.liveShapes += 1;
  }

  ctx.save();
  if (profile.shadows) {
    ctx.shadowColor = color;
    ctx.shadowBlur = entity.kind === "pulse" ? 16 : 12;
    counters.shadowCalls += 1;
  }
  ctx.fillStyle = entity.kind === "pulse" ? "#bff7ff" : "#ffd0c9";
  ctx.strokeStyle = color;
  ctx.lineWidth = entity.kind === "pulse" ? 2 : 2.5;
  if (entity.kind === "pulse") {
    const wobble = 1 + Math.sin(tick * 0.08 + entity.id) * 0.12;
    ctx.beginPath();
    ctx.arc(x, y, radius * wobble, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, y + radius);
    ctx.lineTo(x + radius, y - radius);
    ctx.lineTo(x, y - radius * 0.5);
    ctx.lineTo(x - radius, y - radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  counters.drawCalls += 2;
  counters.liveShapes += 2;
}

function drawPlayer(ctx, state, width, height, tick, profile, counters) {
  const x = state.playerX * width;
  const y = 0.84 * height;
  const size = 19;
  const isDashing = state.dashTicks > 0;

  if (profile.gradients) {
    const glow = ctx.createRadialGradient(x, y, 2, x, y, 70);
    glow.addColorStop(0, isDashing ? "rgba(255,200,87,.4)" : "rgba(110,231,255,.26)");
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 70, 0, Math.PI * 2);
    ctx.fill();
    counters.gradientCalls += 1;
    counters.drawCalls += 1;
    counters.liveShapes += 1;
  }

  ctx.save();
  if (profile.shadows) {
    ctx.shadowColor = isDashing ? COLORS.amber : COLORS.cyan;
    ctx.shadowBlur = 22;
    counters.shadowCalls += 1;
  }
  ctx.fillStyle = isDashing ? COLORS.amber : "#d8fbff";
  ctx.strokeStyle = isDashing ? COLORS.amber : COLORS.cyan;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size * 0.82, y + size * 0.72);
  ctx.lineTo(x, y + size * 0.32);
  ctx.lineTo(x - size * 0.82, y + size * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  counters.drawCalls += 2;
  counters.liveShapes += 1;

  if (state.held.left || state.held.right) {
    const direction = Number(state.held.right) - Number(state.held.left);
    ctx.strokeStyle = "rgba(110, 231, 255, 0.5)";
    ctx.beginPath();
    ctx.arc(x, y, 30, Math.PI * 0.2, Math.PI * 0.8);
    ctx.stroke();
    if (direction !== 0) {
      ctx.beginPath();
      ctx.moveTo(x + direction * 33, y + 2);
      ctx.lineTo(x + direction * 24, y - 4);
      ctx.moveTo(x + direction * 33, y + 2);
      ctx.lineTo(x + direction * 25, y + 9);
      ctx.stroke();
    }
    counters.drawCalls += 2;
  }

  if (isDashing) {
    ctx.strokeStyle = "rgba(255, 200, 87, 0.5)";
    ctx.lineWidth = 1;
    const radius = 42 + Math.sin(tick * 0.3) * 5;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.stroke();
    counters.drawCalls += 1;
  }
}

function drawValidation(ctx, width, height, validation, mode, counters) {
  if (validation) {
    const failed = !validation.ok;
    const panelWidth = 318;
    const x = width - panelWidth - 24;
    const y = 22;
    ctx.fillStyle = COLORS.panel;
    ctx.fillRect(x, y, panelWidth, 66);
    ctx.strokeStyle = failed ? COLORS.red : COLORS.green;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, panelWidth - 1, 65);
    ctx.fillStyle = failed ? COLORS.red : COLORS.green;
    ctx.font =
      '700 12px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
    ctx.textAlign = "left";
    ctx.fillText(
      failed ? "REPLAY DIVERGED" : "REPLAY VERIFIED",
      x + 16,
      y + 22,
    );
    ctx.fillStyle = "#c4eaf3";
    ctx.font =
      '12px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
    if (failed) {
      const first = validation.firstDivergence;
      const where = first
        ? `T+${first.tick} · ${first.kind.toUpperCase()}`
        : "结构校验失败";
      ctx.fillText(where, x + 16, y + 43);
      ctx.fillStyle = "#ff9a90";
      ctx.fillText(`${validation.errors.length} 条异常已记录`, x + 16, y + 59);
    } else {
      ctx.fillText("0 分叉 · 0 异常 · 哈希一致", x + 16, y + 43);
      ctx.fillStyle = "#9ad9b4";
      ctx.fillText(`回放 ${validation.elapsedMs.toFixed(2)}ms`, x + 16, y + 59);
    }
    counters.drawCalls += 9;
    counters.liveShapes += 2;
  }

  ctx.fillStyle = "rgba(4, 13, 22, 0.72)";
  ctx.fillRect(24, 22, 132, 30);
  ctx.strokeStyle = "rgba(110, 231, 255, 0.25)";
  ctx.strokeRect(24.5, 22.5, 131, 29);
  ctx.fillStyle = COLORS.cyan;
  ctx.font =
    '700 11px ui-monospace, SFMono-Regular, Menlo, "Noto Sans SC", monospace';
  ctx.fillText(mode.toUpperCase(), 38, 41);
  counters.drawCalls += 6;
  counters.liveShapes += 1;
}

export function createRenderer(profileId = "full") {
  const profile = RENDER_PROFILES[profileId] ?? RENDER_PROFILES.full;
  const metrics = makeMetrics();
  return {
    profile,
    metrics,
    resetMetrics() {
      resetMetrics(metrics);
    },
    render(view) {
      const started = globalThis.performance?.now?.() ?? Date.now();
      const { ctx, width, height, state, tick, validation, mode } = view;
      const counters = frameCounters(profile);
      drawBackground(ctx, width, height, tick, profile, counters);
      for (const entity of state.entities) {
        drawEntity(ctx, entity, width, height, tick, profile, counters);
      }
      drawPlayer(ctx, state, width, height, tick, profile, counters);
      drawValidation(ctx, width, height, validation, mode, counters);
      metrics.frames += 1;
      metrics.drawCalls += counters.drawCalls;
      metrics.particleDraws += counters.particleDraws;
      metrics.gradientCalls += counters.gradientCalls;
      metrics.shadowCalls += counters.shadowCalls;
      metrics.stars += profile.stars;
      metrics.scanlines += profile.scanlines;
      metrics.peakLiveShapes = Math.max(
        metrics.peakLiveShapes,
        counters.liveShapes,
      );
      metrics.renderMs +=
        (globalThis.performance?.now?.() ?? Date.now()) - started;
      return metrics;
    },
  };
}
