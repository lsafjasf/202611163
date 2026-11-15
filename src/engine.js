export const WORLD = Object.freeze({
  width: 1200,
  height: 620,
  leftAnchor: { x: 108, y: 312 },
  rightAnchor: { x: 1092, y: 312 },
  start: { x: 1012, y: 312 },
  platform: { x: 552, y: 264, w: 184, h: 96, cx: 644, cy: 312 },
  timer: 75,
  crate: { w: 54, h: 46 },
});

export const LIMITS = Object.freeze({
  tensionSlack: 12,
  tensionSafeMin: 36,
  tensionSafeMax: 78,
  tensionWarn: 82,
  tensionBreak: 90,
  guideMinX: WORLD.platform.x - 92,
  guideMaxX: WORLD.platform.x + WORLD.platform.w + 92,
  guideMinY: WORLD.platform.y - 105,
  guideMaxY: WORLD.platform.y + WORLD.platform.h + 105,
  settleTime: 0.8,
  settleSpeed: 39,
  retrieveRate: 44,
});

const GUSTS = [
  { at: 2.6, duration: 2.5, peak: 58 },
  { at: 9.2, duration: 3.1, peak: -64 },
  { at: 19.8, duration: 2.2, peak: 50 },
  { at: 31.5, duration: 2.8, peak: -57 },
  { at: 44.2, duration: 2.1, peak: 46 },
  { at: 58.0, duration: 1.8, peak: -42 },
];

export const EMPTY_INPUT = Object.freeze({
  reelIn: false,
  reelOut: false,
  guideLeft: false,
  guideRight: false,
  guideUp: false,
  guideDown: false,
  retrieveLeft: false,
  retrieveRight: false,
});

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, amount) {
  return a + (b - a) * amount;
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function formatClock(seconds, tenths = false) {
  const total = Math.max(0, seconds);
  const minutes = Math.floor(total / 60);
  const secs = Math.floor(total % 60);
  const base = `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return tenths ? `${base}.${Math.floor((total % 1) * 10)}` : base;
}

export function makeRun({ singlePlayer = false, swapped = false, seed = 7 } = {}) {
  const driveDistance = distance(WORLD.start, WORLD.leftAnchor);
  return {
    seed,
    phase: "ready",
    singlePlayer,
    swapped,
    result: null,
    timeLeft: WORLD.timer,
    elapsed: 0,
    crate: {
      x: WORLD.start.x,
      y: WORLD.start.y,
      vx: 0,
      vy: 0,
      rotation: 0,
    },
    drive: {
      restLength: driveDistance - 48,
      tension: 27.8,
      displayTension: 27.8,
      integrity: 100,
      peakTension: 27.8,
      overTensionTime: 0,
      slackTime: 0,
    },
    cargoIntegrity: 100,
    guide: {
      targetX: WORLD.platform.cx,
      targetY: WORLD.platform.cy,
      load: 0,
    },
    wind: {
      base: 0,
      gust: 0,
      total: 0,
      phase: 0,
    },
    settle: 0,
    retrieve: { left: 0, right: 0, progress: 0 },
    progress: 0,
    warnings: { tension: false, drift: false, slack: false, speed: false },
    inputs: { ...EMPTY_INPUT },
    contributions: { p1: 0, p2: 0, left: 0, right: 0 },
    events: [],
    flags: {
      gustIndex: -1,
      driftLogged: false,
      speedLogged: false,
      recovered: false,
      nearMiss: false,
    },
    stats: {
      conflictCount: 0,
      peakTension: 27.8,
      corrections: 0,
      maxDrift: 0,
    },
  };
}

export function addEvent(run, type, label, detail, severity = "info", conflict = false) {
  const event = {
    t: Number(run.elapsed.toFixed(2)),
    type,
    label,
    detail,
    severity,
    conflict,
  };
  run.events.push(event);
  if (conflict) run.stats.conflictCount += 1;
  return event;
}

export function startRun(run) {
  if (run.phase !== "ready") return run;
  run.phase = "playing";
  addEvent(run, "start", "协作链路建立", "两侧输入已同时接入，任务计时开始");
  return run;
}

function gustAt(seconds) {
  let gust = 0;
  for (const item of GUSTS) {
    const local = seconds - item.at;
    if (local >= 0 && local <= item.duration) {
      const envelope = 0.5 - 0.5 * Math.cos((local / item.duration) * Math.PI * 2);
      gust += item.peak * envelope;
    }
  }
  return gust;
}

function activeGustIndex(seconds) {
  return GUSTS.findIndex((item) => seconds >= item.at && seconds <= item.at + item.duration);
}

function updateGuide(run, input, dt) {
  const horizontal = Number(input.guideRight) - Number(input.guideLeft);
  const vertical = Number(input.guideDown) - Number(input.guideUp);
  run.guide.targetX = clamp(
    run.guide.targetX + horizontal * 132 * dt,
    LIMITS.guideMinX,
    LIMITS.guideMaxX,
  );
  run.guide.targetY = clamp(
    run.guide.targetY + vertical * 132 * dt,
    LIMITS.guideMinY,
    LIMITS.guideMaxY,
  );
  if (horizontal) run.contributions.p2 += Math.abs(horizontal) * dt;
  if (vertical) run.contributions.p2 += Math.abs(vertical) * dt;
}

function updateDrive(run, input, dt) {
  const reel = Number(input.reelIn) - Number(input.reelOut);
  if (reel) {
    run.drive.restLength = clamp(run.drive.restLength - reel * 138 * dt, 350, 930);
    run.contributions.p1 += Math.abs(reel) * dt;
  }
}

function updateTension(run) {
  const ropeDistance = distance(run.crate, WORLD.leftAnchor);
  const stretch = Math.max(0, ropeDistance - run.drive.restLength);
  const rawTension = stretch * 0.61;
  run.drive.tension = clamp(rawTension, 0, 112);
  run.drive.displayTension = lerp(
    run.drive.displayTension,
    run.drive.tension,
    run.phase === "ready" ? 1 : 0.17,
  );
  run.drive.peakTension = Math.max(run.drive.peakTension, run.drive.tension);
  run.stats.peakTension = Math.max(run.stats.peakTension, run.drive.tension);
}

function applyForces(run, dt) {
  const crate = run.crate;
  const toAnchorX = WORLD.leftAnchor.x - crate.x;
  const toAnchorY = WORLD.leftAnchor.y - crate.y;
  const ropeDistance = Math.max(1, Math.hypot(toAnchorX, toAnchorY));
  const tension = Math.max(0, run.drive.tension - 10);
  let ax = (toAnchorX / ropeDistance) * tension * 1.47;
  let ay = (toAnchorY / ropeDistance) * tension * 1.47;

  const guideDx = run.guide.targetX - crate.x;
  const guideDy = run.guide.targetY - crate.y;
  const guideDistance = Math.max(1, Math.hypot(guideDx, guideDy));
  const commandDx = run.guide.targetX - WORLD.platform.cx;
  const commandDy = run.guide.targetY - WORLD.platform.cy;
  const commandDistance = Math.max(0.001, Math.hypot(commandDx, commandDy));
  const commandForce = clamp(commandDistance * 0.95, 0, 58);
  const errorForce = clamp(guideDistance * 1.55, 0, 70);
  const guideAuthority = run.drive.tension > 15 ? commandForce + errorForce : 0;
  run.guide.load = lerp(run.guide.load, guideAuthority, 0.1);
  ax += (guideDx / guideDistance) * errorForce;
  ay += (guideDy / guideDistance) * errorForce;
  ax += (commandDx / commandDistance) * commandForce;
  ay += (commandDy / commandDistance) * commandForce;

  ay += run.wind.total;
  ax += run.wind.total * 0.08;

  crate.vx += ax * dt;
  crate.vy += ay * dt;
  const drag = Math.exp(-1.18 * dt);
  crate.vx *= drag;
  crate.vy *= drag;
  crate.x += crate.vx * dt;
  crate.y += crate.vy * dt;
  crate.rotation = clamp(crate.vx * 0.004 + run.wind.total * 0.0008, -0.12, 0.12);
}

function updateWind(run, dt) {
  const base = Math.sin(run.elapsed * 0.48) * 15 + Math.sin(run.elapsed * 1.17 + 0.8) * 8;
  const gust = gustAt(run.elapsed);
  run.wind.base = base;
  run.wind.gust = gust;
  run.wind.total = base + gust;
  run.wind.phase += dt;
  const index = activeGustIndex(run.elapsed);
  if (index !== -1 && index !== run.flags.gustIndex) {
    run.flags.gustIndex = index;
    const item = GUSTS[index];
    addEvent(
      run,
      "gust",
      item.peak > 0 ? "强侧风抵达" : "反向侧风突袭",
      "右岸需提前将落点上移/下压以抵消漂移",
      "warn",
      true,
    );
  }
}

function failRun(run, reason, label, detail) {
  if (run.phase === "won" || run.phase === "lost") return;
  run.phase = "lost";
  run.result = {
    outcome: "failure",
    reason,
    title: label,
    detail,
    at: run.elapsed,
  };
  addEvent(run, reason, label, detail, "danger", true);
}

function winRun(run) {
  if (run.phase === "won") return;
  run.phase = "won";
  run.retrieve.progress = 100;
  run.progress = 100;
  run.result = {
    outcome: "success",
    reason: "delivered",
    title: "物资已送达",
    detail: "双人同步回收完成，中央中继台恢复供能。",
    at: run.elapsed,
  };
  addEvent(run, "complete", "双人回收完成", "物资固定，任务链路安全关闭", "success");
}

function evaluateTension(run, dt) {
  const tension = run.drive.tension;
  if (tension >= LIMITS.tensionWarn) {
    run.drive.integrity = Math.max(0, run.drive.integrity - dt * 3.2);
    if (!run.warnings.tension) {
      run.warnings.tension = true;
      run.flags.recovered = false;
      addEvent(
        run,
        "tension-critical",
        "主索张力临界",
        "收索侧需立即放索降压，否则 0.5 秒内可能断裂",
        "danger",
        true,
      );
    }
  } else if (tension < 70 && run.warnings.tension) {
    run.warnings.tension = false;
    run.flags.recovered = true;
    addEvent(run, "tension-recovered", "张力已回稳", "过载解除，共享索具继续工作", "success");
  }

  if (tension >= LIMITS.tensionBreak) {
    run.drive.overTensionTime += dt;
    run.drive.integrity = Math.max(0, run.drive.integrity - dt * 90);
    if (run.drive.overTensionTime >= 0.5 || run.drive.integrity <= 0) {
      run.drive.integrity = 0;
      failRun(
        run,
        "rope-break",
        "主索断裂",
        "收索侧持续过载，弹性索超过断裂阈值",
      );
    }
  } else {
    run.drive.overTensionTime = Math.max(0, run.drive.overTensionTime - dt * 1.4);
  }
}

function evaluateSlackAndDrift(run, dt) {
  const tension = run.drive.tension;
  const crate = run.crate;
  if (tension < LIMITS.tensionSlack && run.phase === "playing") {
    run.drive.slackTime += dt;
    if (run.drive.slackTime > 1.5 && !run.warnings.slack) {
      run.warnings.slack = true;
      addEvent(
        run,
        "rope-slack",
        "主索松弛",
        "牵引力不足，箱体只能随风漂移；收索侧需要重新建立张力",
        "warn",
        true,
      );
    }
  } else {
    run.drive.slackTime = Math.max(0, run.drive.slackTime - dt);
    if (tension > 22 && run.warnings.slack) {
      run.warnings.slack = false;
      addEvent(run, "slack-recovered", "牵引力恢复", "箱体重新响应主索控制", "success");
    }
  }

  const verticalDrift = Math.abs(crate.y - WORLD.platform.cy);
  run.stats.maxDrift = Math.max(run.stats.maxDrift, verticalDrift);
  if (verticalDrift > 82 && !run.flags.driftLogged && run.phase === "playing") {
    run.flags.driftLogged = true;
    addEvent(
      run,
      "drift",
      "箱体偏离平台",
      "右岸落点需要向反风向修正",
      "warn",
      true,
    );
  } else if (verticalDrift < 38 && run.flags.driftLogged) {
    run.flags.driftLogged = false;
    run.flags.nearMiss = true;
    addEvent(run, "drift-recovered", "落点重新对齐", "引导索已拉回安全走廊", "success");
  }
}

function platformContainsCrate(run) {
  const crate = run.crate;
  return (
    crate.x > WORLD.platform.x + 15 &&
    crate.x < WORLD.platform.x + WORLD.platform.w - 15 &&
    crate.y > WORLD.platform.y + 15 &&
    crate.y < WORLD.platform.y + WORLD.platform.h - 15
  );
}

function guideInsidePlatform(run) {
  return (
    run.guide.targetX > WORLD.platform.x + 8 &&
    run.guide.targetX < WORLD.platform.x + WORLD.platform.w - 8 &&
    run.guide.targetY > WORLD.platform.y + 8 &&
    run.guide.targetY < WORLD.platform.y + WORLD.platform.h - 8
  );
}

function evaluateLanding(run, dt) {
  const speed = Math.hypot(run.crate.vx, run.crate.vy);
  if (platformContainsCrate(run) && guideInsidePlatform(run) && speed < LIMITS.settleSpeed) {
    run.settle += dt;
    if (!run.flags.speedLogged) {
      run.flags.speedLogged = true;
      addEvent(run, "settling", "箱体进入落位窗口", "保持低速与落点对齐，正在锁定平台", "info");
    }
    if (run.settle >= LIMITS.settleTime) {
      run.phase = "retrieving";
      run.settle = LIMITS.settleTime;
      run.crate.vx = 0;
      run.crate.vy = 0;
      run.crate.x = lerp(run.crate.x, WORLD.platform.cx, 0.55);
      run.crate.y = lerp(run.crate.y, WORLD.platform.cy, 0.55);
      run.retrieve.left = 0;
      run.retrieve.right = 0;
      run.retrieve.progress = 0;
      addEvent(run, "landed", "物资落位成功", "双方同时按住 R 与 P 回收绳索", "success");
    }
  } else {
    if (
      platformContainsCrate(run) &&
      speed >= LIMITS.settleSpeed &&
      !run.warnings.speed
    ) {
      run.warnings.speed = true;
      addEvent(
        run,
        "landing-speed",
        "落位速度过高",
        "收索侧需要放索减速，否则箱体会冲出平台",
        "warn",
        true,
      );
    }
    if (speed < LIMITS.settleSpeed - 6) run.warnings.speed = false;
    run.settle = Math.max(0, run.settle - dt * 1.7);
  }
}

function updateRetrieval(run, input, dt) {
  run.retrieve.left = input.retrieveLeft
    ? Math.min(100, run.retrieve.left + LIMITS.retrieveRate * dt)
    : Math.max(0, run.retrieve.left - dt * 18);
  run.retrieve.right = input.retrieveRight
    ? Math.min(100, run.retrieve.right + LIMITS.retrieveRate * dt)
    : Math.max(0, run.retrieve.right - dt * 18);
  run.retrieve.progress = Math.min(run.retrieve.left, run.retrieve.right);
  if (input.retrieveLeft) run.contributions.left += dt;
  if (input.retrieveRight) run.contributions.right += dt;
  if (run.retrieve.progress >= 100) winRun(run);
}

function updateProgress(run) {
  if (run.phase === "won") {
    run.progress = 100;
    return;
  }
  if (run.phase === "retrieving") {
    run.progress = 70 + run.retrieve.progress * 0.3;
    return;
  }
  const travel = clamp(
    (WORLD.start.x - run.crate.x) / (WORLD.start.x - WORLD.platform.cx),
    0,
    1,
  );
  const settleBonus = (run.settle / LIMITS.settleTime) * 15;
  run.progress = clamp(travel * 55 + settleBonus, 0, 70);
}

export function stepRun(run, dt, rawInput = EMPTY_INPUT) {
  if (run.phase !== "playing" && run.phase !== "retrieving") return run;

  const input = { ...EMPTY_INPUT, ...rawInput };
  run.inputs = input;
  const safeDt = Math.min(Math.max(dt, 0), 0.05);
  run.elapsed += safeDt;
  run.timeLeft = Math.max(0, run.timeLeft - safeDt);

  updateWind(run, safeDt);

  if (run.phase === "retrieving") {
    updateRetrieval(run, input, safeDt);
    updateTension(run);
    if (run.timeLeft <= 0) {
      failRun(run, "timeout", "回收超时", "倒计时结束前未能完成双人收索");
    }
    updateProgress(run);
    return run;
  }

  updateDrive(run, input, safeDt);
  updateGuide(run, input, safeDt);
  updateTension(run);
  applyForces(run, safeDt);
  evaluateTension(run, safeDt);
  evaluateSlackAndDrift(run, safeDt);
  evaluateLanding(run, safeDt);

  if (run.phase !== "lost") {
    if (
      run.crate.x < 150 ||
      run.crate.x > 1070 ||
      run.crate.y < 118 ||
      run.crate.y > 505
    ) {
      failRun(run, "crate-lost", "货箱坠入峡谷", "箱体越出安全边界，救援链路中断");
    } else if (run.timeLeft <= 0) {
      failRun(run, "timeout", "投送窗口关闭", "倒计时结束前物资未完成回收");
    }
  }
  updateProgress(run);
  return run;
}

export function captureSnapshot(run) {
  const ms = Math.round(run.elapsed * 1000) / 1000;
  return {
    t: ms,
    phase: run.phase,
    x: Math.round(run.crate.x * 10) / 10,
    y: Math.round(run.crate.y * 10) / 10,
    vx: Math.round(run.crate.vx * 10) / 10,
    vy: Math.round(run.crate.vy * 10) / 10,
    rotation: Math.round(run.crate.rotation * 1000) / 1000,
    tension: Math.round(run.drive.tension * 10) / 10,
    tensionDisplay: Math.round(run.drive.displayTension * 10) / 10,
    ropeIntegrity: Math.round(run.drive.integrity * 10) / 10,
    cargoIntegrity: Math.round(run.cargoIntegrity * 10) / 10,
    restLength: Math.round(run.drive.restLength * 10) / 10,
    targetX: Math.round(run.guide.targetX * 10) / 10,
    targetY: Math.round(run.guide.targetY * 10) / 10,
    guideLoad: Math.round(run.guide.load * 10) / 10,
    wind: Math.round(run.wind.total * 10) / 10,
    settle: Math.round(run.settle * 100) / 100,
    timeLeft: Math.round(run.timeLeft * 10) / 10,
    progress: Math.round(run.progress * 10) / 10,
    retrieveLeft: Math.round(run.retrieve.left * 10) / 10,
    retrieveRight: Math.round(run.retrieve.right * 10) / 10,
    retrieveProgress: Math.round(run.retrieve.progress * 10) / 10,
    result: run.result ? run.result.outcome : null,
  };
}

function chooseAutoInput(run) {
  const input = { ...EMPTY_INPUT };
  const crate = run.crate;
  const centerGap = crate.x - WORLD.platform.cx;

  let desiredTension = 54;
  if (centerGap < 70) desiredTension = 27;
  if (centerGap < 24) desiredTension = 16;
  if (centerGap < -18) desiredTension = 10;
  if (run.phase === "retrieving") desiredTension = 20;

  if (run.drive.tension < desiredTension - 2.5) input.reelIn = true;
  if (run.drive.tension > desiredTension + 2.5) input.reelOut = true;

  const brakeX = clamp(-crate.vx * 2.8, -72, 72);
  const desiredX = clamp(
    WORLD.platform.cx + brakeX,
    WORLD.platform.x + 14,
    WORLD.platform.x + WORLD.platform.w - 14,
  );
  const desiredY = clamp(
    WORLD.platform.cy - run.wind.total * 1.08 - crate.vy * 1.5,
    WORLD.platform.y + 12,
    WORLD.platform.y + WORLD.platform.h - 12,
  );

  const dx = desiredX - run.guide.targetX;
  const dy = desiredY - run.guide.targetY;
  if (dx > 3) input.guideRight = true;
  if (dx < -3) input.guideLeft = true;
  if (dy > 3) input.guideDown = true;
  if (dy < -3) input.guideUp = true;

  if (run.phase === "retrieving") {
    input.reelIn = false;
    input.reelOut = false;
    input.retrieveLeft = true;
    input.retrieveRight = true;
  }
  return input;
}

function chooseBreakInput(run) {
  if (run.phase === "retrieving") {
    return { ...EMPTY_INPUT };
  }
  const input = { ...EMPTY_INPUT, guideDown: true };
  if (run.drive.tension < 46) input.reelIn = true;
  if (run.drive.tension > 61) input.reelOut = true;
  if (run.guide.targetY < LIMITS.guideMaxY - 4) input.guideDown = true;
  return input;
}

function chooseRecoveryInput(run) {
  const input = chooseAutoInput(run);
  input.reelIn = false;
  input.reelOut = false;
  if (run.elapsed < 0.7) return input;
  if (!run.flags.recoveryStage) run.flags.recoveryStage = 1;
  if (run.flags.recoveryStage === 1) {
    if (run.drive.tension < 90) {
      input.reelIn = true;
    } else {
      run.flags.recoveryStage = 2;
    }
  }
  if (run.flags.recoveryStage === 2) {
    if (run.drive.tension > 67 || run.drive.tension >= 82) {
      input.reelOut = true;
    } else {
      run.flags.recoveryStage = 3;
    }
  }
  return input;
}

function summarizeReplay(run, meta) {
  const outcome = run.result ? run.result.outcome : "failure";
  return {
    id: meta.id,
    title: meta.title,
    subtitle: meta.subtitle,
    outcome,
    reason: run.result ? run.result.reason : "unknown",
    mode: meta.mode || "coop",
    singlePlayer: run.singlePlayer,
    swapped: run.swapped,
    startedAt: meta.startedAt,
    duration: Number(run.elapsed.toFixed(2)),
    timeLeft: Number(run.timeLeft.toFixed(1)),
    conflicts: run.stats.conflictCount,
    peakTension: Math.round(run.stats.peakTension),
    maxDrift: Math.round(run.stats.maxDrift),
    corrections: run.stats.corrections,
    snapshots: meta.snapshots,
    events: run.events,
    final: captureSnapshot(run),
    demo: Boolean(meta.demo),
  };
}

export function simulateReplay(kind = "success", options = {}) {
  const isFailure = kind === "failure";
  const isRecovery = kind === "recovery";
  const run = makeRun({
    swapped: Boolean(options.swapped),
    singlePlayer: Boolean(options.singlePlayer),
    seed: options.seed || 11,
  });
  startRun(run);
  const snapshots = [captureSnapshot(run)];
  let nextSnapshot = 0.12;
  let steps = 0;
  while (
    (run.phase === "playing" || run.phase === "retrieving") &&
    steps < 60 * 110
  ) {
    const input = isFailure
      ? chooseBreakInput(run)
      : isRecovery
        ? chooseRecoveryInput(run)
        : chooseAutoInput(run);
    stepRun(run, 1 / 60, input);
    if (isFailure && run.elapsed >= 2.1 && !run.flags.wrongGuideLogged) {
      run.flags.wrongGuideLogged = true;
      addEvent(
        run,
        "guide-error",
        "右岸落点误设",
        "引导手将落点持续压向峡谷下缘，箱体未进入平台窗口",
        "danger",
        true,
      );
    }
    steps += 1;
    if (run.elapsed >= nextSnapshot || run.phase === "lost" || run.phase === "won") {
      snapshots.push(captureSnapshot(run));
      nextSnapshot += 0.12;
    }
  }
  const labels = {
    success: ["协作送达 · 完整回放", "左岸收索 / 右岸引导"],
    failure: ["单侧过载 · 断裂回放", "左岸持续收索，未及时放索"],
    recovery: ["临界恢复 · 完整回放", "张力告警后降压并完成送达"],
  };
  const title = options.title || labels[kind === "failure" ? "failure" : kind === "recovery" ? "recovery" : "success"][0];
  const subtitle = labels[kind === "failure" ? "failure" : kind === "recovery" ? "recovery" : "success"][1];
  return summarizeReplay(run, {
    id: options.id || `demo-${kind}${options.swapped ? "-swap" : ""}`,
    title,
    subtitle,
    startedAt: options.startedAt || "2026-11-16T00:00:00.000Z",
    snapshots,
    demo: true,
    mode: options.singlePlayer ? "solo" : "coop",
  });
}

export function createDemoReplays() {
  return [
    simulateReplay("success", {
      id: "demo-success",
      startedAt: "2026-11-16T08:42:19.000Z",
    }),
    simulateReplay("success", {
      id: "demo-swap",
      title: "岸位轮换 · 完整回放",
      subtitle: "P1 右岸引导 / P2 左岸收索",
      swapped: true,
      startedAt: "2026-11-16T08:47:03.000Z",
    }),
    simulateReplay("recovery", {
      id: "demo-recovery",
      startedAt: "2026-11-16T08:51:37.000Z",
    }),
    simulateReplay("failure", {
      id: "demo-failure",
      startedAt: "2026-11-16T08:54:11.000Z",
    }),
  ];
}
