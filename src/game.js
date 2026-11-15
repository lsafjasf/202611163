import {
  ACTION_RADIUS,
  INITIAL_SCORE,
  MOVE_SPEED,
  RISK_RADIUS,
  RISK_ZONES,
  ROLES,
  ROUTE_EDGES,
  SESSION_SECONDS,
  SIDE_KEYS,
  TARGETS,
  WORLD,
} from "./config.js";

const START_CURSORS = {
  surveyor: { x: 278, y: 690 },
  cartographer: { x: 355, y: 698 },
};

const DEFAULT_ROLES = {
  left: "surveyor",
  right: "cartographer",
};

export function formatTime(seconds, withTenths = false) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  const base = `${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}`;
  return withTenths ? `${base}.${tenths}` : base;
}

export function seatLabel(side) {
  if (side === "left") return "P1 左席";
  if (side === "right") return "P2 右席";
  if (side === "debug") return "调试台";
  return "系统";
}

export class FieldLinkGame {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.runNumber = 1;
    this.state = this.createInitialState({
      debug: false,
      roleMap: { ...DEFAULT_ROLES },
    });
  }

  createInitialState(config) {
    const roleMap = { ...(config.roleMap ?? DEFAULT_ROLES) };
    const now = Date.now();
    const state = {
      sessionId: `FL-${now.toString(36).toUpperCase()}`,
      startedAt: new Date(now).toISOString(),
      runNumber: this.runNumber,
      status: "running",
      debug: Boolean(config.debug),
      debugRole: "surveyor",
      roleMap,
      elapsed: 0,
      timeLeft: SESSION_SECONDS,
      score: INITIAL_SCORE,
      signal: 100,
      points: [],
      routes: [],
      risks: [],
      selectedPointId: null,
      cursors: {
        surveyor: { ...START_CURSORS.surveyor },
        cartographer: { ...START_CURSORS.cartographer },
      },
      cursorReadout: { ...START_CURSORS.surveyor },
      lastAction: null,
      recovery: { active: false, side: null, reason: "" },
      metrics: {
        duplicates: 0,
        conflicts: 0,
        recoveries: 0,
        mistakes: 0,
        blocked: 0,
        actions: 0,
      },
      result: null,
      archived: false,
      events: [],
      revision: 0,
      renderTime: 0,
    };
    this.state = state;
    this.recordEvent("session_start", this.sessionStartMessage(state), {
      actor: "system",
      sound: "start",
    });
    return state;
  }

  sessionStartMessage(state = this.state) {
    const leftRole = ROLES[state.roleMap.left].name;
    const rightRole = ROLES[state.roleMap.right].name;
    if (state.debug) {
      return `单人调试启动：左席 P1 → ${leftRole}，右席 P2 → ${rightRole}`;
    }
    return `作业开始：左席 P1 → ${leftRole} / 右席 P2 → ${rightRole}`;
  }

  get snapshot() {
    return {
      sessionId: this.state.sessionId,
      runNumber: this.state.runNumber,
      status: this.state.status,
      debug: this.state.debug,
      debugRole: this.state.debugRole,
      roleMap: { ...this.state.roleMap },
      elapsed: this.state.elapsed,
      timeLeft: this.state.timeLeft,
      score: this.state.score,
      signal: this.state.signal,
      points: this.state.points.map((point) => ({ ...point })),
      routes: this.state.routes.map((route) => ({ ...route })),
      risks: this.state.risks.map((risk) => ({ ...risk })),
      selectedPointId: this.state.selectedPointId,
      cursors: {
        surveyor: { ...this.state.cursors.surveyor },
        cartographer: { ...this.state.cursors.cartographer },
      },
      lastAction: this.state.lastAction ? { ...this.state.lastAction } : null,
      recovery: { ...this.state.recovery },
      metrics: { ...this.state.metrics },
      result: this.state.result ? { ...this.state.result } : null,
      events: this.state.events.map((event) => ({ ...event })),
      revision: this.state.revision,
    };
  }

  notify() {
    this.state.revision += 1;
    this.callbacks.onChange?.(this.state);
  }

  toast(message, kind = "info") {
    this.callbacks.onToast?.(message, kind);
  }

  sound(name) {
    if (name) this.callbacks.onSound?.(name);
  }

  recordEvent(type, message, options = {}) {
    const {
      actor = "system",
      role = "",
      conflict = false,
      recovery = false,
      sound = null,
    } = options;
    const event = {
      id: `${this.state.sessionId}-${this.state.events.length + 1}`,
      type,
      actor,
      actorLabel: seatLabel(actor),
      role,
      message,
      conflict,
      recovery,
      t: this.state.elapsed,
      timecode: formatTime(this.state.elapsed, true),
      wallTime: new Date().toISOString(),
    };
    this.state.events.push(event);
    if (sound) this.sound(sound);
    this.notify();
    return event;
  }

  update(deltaSeconds) {
    if (this.state.status !== "running") return;
    const dt = Math.max(0, Math.min(deltaSeconds, 0.1));
    if (dt === 0) return;
    this.state.renderTime += dt;
    this.state.elapsed += dt;
    this.state.timeLeft = Math.max(0, this.state.timeLeft - dt);
    this.state.signal = Math.max(0, this.state.signal - dt * 0.075);
    if (this.state.signal <= 0) {
      this.fail("共享同步信号耗尽", "信号池归零，双方仪表已冻结。");
      return;
    }
    if (this.state.timeLeft <= 0) {
      this.fail("作业窗口已关闭", "倒计时归零，仍有标注未完成。");
    }
  }

  moveFromInput(keys, deltaSeconds) {
    if (this.state.status !== "running" || !keys?.size) return;
    const dt = Math.max(0, Math.min(deltaSeconds, 0.1));
    if (this.state.debug) {
      const codes = [
        SIDE_KEYS.left.up,
        SIDE_KEYS.left.down,
        SIDE_KEYS.left.left,
        SIDE_KEYS.left.right,
      ];
      const cursor = this.state.cursors[this.state.debugRole];
      const moved = this.moveCursor(
        cursor,
        keys.has(codes[0]) || keys.has("ArrowUp"),
        keys.has(codes[1]) || keys.has("ArrowDown"),
        keys.has(codes[2]) || keys.has("ArrowLeft"),
        keys.has(codes[3]) || keys.has("ArrowRight"),
        dt,
      );
      if (moved) {
        this.state.cursorReadout = { ...cursor };
      }
      return;
    }

    let didMove = false;
    for (const side of ["left", "right"]) {
      const role = this.state.roleMap[side];
      const mapping = SIDE_KEYS[side];
      const cursor = this.state.cursors[role];
      const moved = this.moveCursor(
        cursor,
        keys.has(mapping.up),
        keys.has(mapping.down),
        keys.has(mapping.left),
        keys.has(mapping.right),
        dt,
      );
      if (moved) {
        this.state.cursorReadout = { ...cursor };
        didMove = true;
      }
    }
    if (didMove) this.state.revision += 1;
  }

  moveCursor(cursor, up, down, left, right, dt) {
    let dx = (right ? 1 : 0) - (left ? 1 : 0);
    let dy = (down ? 1 : 0) - (up ? 1 : 0);
    if (dx === 0 && dy === 0) return false;
    const length = Math.hypot(dx, dy);
    dx /= length;
    dy /= length;
    const distance = MOVE_SPEED * dt;
    cursor.x = Math.max(18, Math.min(WORLD.width - 18, cursor.x + dx * distance));
    cursor.y = Math.max(18, Math.min(WORLD.height - 18, cursor.y + dy * distance));
    return true;
  }

  resolveActor(side) {
    if (this.state.debug) {
      return { actor: "debug", role: this.state.debugRole };
    }
    return { actor: side, role: this.state.roleMap[side] };
  }

  roleOwnerSide(role) {
    return Object.keys(this.state.roleMap).find(
      (side) => this.state.roleMap[side] === role,
    );
  }

  sideSignalValue() {
    return Math.round(this.state.signal);
  }

  setCursor(role, x, y) {
    if (!this.state.cursors[role]) return;
    this.state.cursors[role].x = Math.max(0, Math.min(WORLD.width, x));
    this.state.cursors[role].y = Math.max(0, Math.min(WORLD.height, y));
    this.state.cursorReadout = { ...this.state.cursors[role] };
    this.state.revision += 1;
  }

  togglePause(force) {
    if (this.state.status === "success" || this.state.status === "failed") return;
    const shouldPause =
      typeof force === "boolean" ? force : this.state.status === "running";
    if (shouldPause && this.state.status === "running") {
      this.state.status = "paused";
      this.recordEvent("pause", "作业暂停：计时与共享信号冻结", {
        actor: "system",
        sound: "pause",
      });
      this.toast("作业已暂停 · 双方状态保持不变");
    } else if (!shouldPause && this.state.status === "paused") {
      this.state.status = "running";
      this.recordEvent("resume", "作业恢复：双方终端重新同步", {
        actor: "system",
        sound: "resume",
      });
      this.toast("作业恢复 · 同步链路正常", "success");
    }
    this.notify();
  }

  toggleDebugRole() {
    if (!this.state.debug || this.state.status !== "running") return;
    this.state.debugRole =
      this.state.debugRole === "surveyor" ? "cartographer" : "surveyor";
    const role = ROLES[this.state.debugRole];
    this.recordEvent("debug_switch", `调试控制切换至 ${role.name}`, {
      actor: "debug",
      role: this.state.debugRole,
      sound: "ui",
    });
    this.toast(`调试控制：${role.name}`, "info");
  }

  performAction(side) {
    if (this.state.status !== "running") {
      this.toast("当前不在作业状态，请先继续或重开", "error");
      return;
    }
    const { actor, role } = this.resolveActor(side);
    if (role === "surveyor") this.placeSurveyPoint(actor);
    else this.connectRoute(actor);
  }

  performRisk(side) {
    if (this.state.status !== "running") {
      this.toast("当前不在作业状态，无法标注风险", "error");
      return;
    }
    const { actor, role } = this.resolveActor(side);
    if (role !== "cartographer") {
      this.toast("只有制图员职责可以标注风险", "error");
      this.sound("blocked");
      return;
    }
    this.markRisk(actor);
  }

  performUndo(side) {
    if (this.state.status !== "running") return;
    const { actor, role } = this.resolveActor(side);
    if (role === "surveyor") this.undoSurveyPoint(actor);
    else this.undoCartography(actor);
  }

  placeSurveyPoint(actor) {
    const cursor = this.state.cursors.surveyor;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const target of TARGETS) {
      const distance = Math.hypot(cursor.x - target.x, cursor.y - target.y);
      if (distance < ACTION_RADIUS && distance < nearestDistance) {
        nearest = target;
        nearestDistance = distance;
      }
    }

    if (!nearest) {
      this.applyMistake(
        actor,
        "surveyor",
        "wrong_place",
        `${seatLabel(actor)} 未落入测量靶区，测量点未提交`,
        2,
      );
      return;
    }

    const existing = this.state.points.find(
      (point) => point.targetId === nearest.id,
    );
    if (existing) {
      this.applyMistake(
        actor,
        "surveyor",
        "duplicate_point",
        `${seatLabel(actor)} 重复布设 ${nearest.id}，已有测量点未被覆盖`,
        4,
      );
      return;
    }

    const point = {
      id: `PT-${this.state.points.length + 1}`,
      targetId: nearest.id,
      x: nearest.x,
      y: nearest.y,
      elevation: nearest.elevation,
      ownerSide: actor,
      ownerLabel: actor === "debug" ? "DBG" : actor === "left" ? "P1" : "P2",
      createdAt: this.state.elapsed,
    };
    this.state.points.push(point);
    this.state.signal = Math.max(0, this.state.signal - 4);
    this.commitValidAction(
      actor,
      "surveyor",
      "point",
      `布设测量点 ${nearest.id} · ${this.state.points.length}/4`,
      "place",
    );
  }

  connectRoute(actor) {
    const cursor = this.state.cursors.cartographer;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const point of this.state.points) {
      const distance = Math.hypot(cursor.x - point.x, cursor.y - point.y);
      if (distance < ACTION_RADIUS && distance < nearestDistance) {
        nearest = point;
        nearestDistance = distance;
      }
    }

    if (!nearest) {
      this.applyMistake(
        actor,
        "cartographer",
        "wrong_route",
        this.state.selectedPointId
          ? `${seatLabel(actor)} 未到达相邻测量点，连线未提交`
          : `${seatLabel(actor)} 附近没有已布设测量点`,
        this.state.selectedPointId ? 2 : 1,
      );
      return;
    }

    if (!this.state.selectedPointId) {
      this.state.selectedPointId = nearest.targetId;
      this.state.lastAction = {
        actor,
        role: "cartographer",
        message: `选中 ${nearest.targetId}，等待相邻点`,
        t: this.state.elapsed,
      };
      this.recordEvent(
        "route_select",
        `${seatLabel(actor)} 选中 ${nearest.targetId}，准备连接下一测量点`,
        {
          actor,
          role: "cartographer",
          sound: "select",
        },
      );
      this.toast(`已选中 ${nearest.targetId} · 移动到相邻测量点`);
      return;
    }

    if (this.state.selectedPointId === nearest.targetId) {
      const previous = this.state.selectedPointId;
      this.state.selectedPointId = null;
      this.recordEvent("route_deselect", `${seatLabel(actor)} 取消选择 ${previous}`, {
        actor,
        role: "cartographer",
        sound: "undo",
      });
      this.toast(`已取消选择 ${previous}`);
      return;
    }

    const pair = [this.state.selectedPointId, nearest.targetId].sort();
    const edge = ROUTE_EDGES.find(
      (candidate) =>
        candidate.pair[0] === pair[0] && candidate.pair[1] === pair[1],
    );
    if (!edge) {
      this.applyMistake(
        actor,
        "cartographer",
        "wrong_route",
        `${seatLabel(actor)} 尝试连接非相邻区段 ${pair[0]}—${pair[1]}`,
        3,
      );
      return;
    }

    const duplicate = this.state.routes.find((route) => route.id === edge.id);
    if (duplicate) {
      this.state.selectedPointId = null;
      this.applyMistake(
        actor,
        "cartographer",
        "duplicate_route",
        `${seatLabel(actor)} 重复标记路线 ${edge.id}，评分下降`,
        8,
        true,
      );
      return;
    }

    this.state.routes.push({
      id: edge.id,
      from: edge.pair[0],
      to: edge.pair[1],
      label: edge.label,
      ownerSide: actor,
      ownerLabel: actor === "debug" ? "DBG" : actor === "left" ? "P1" : "P2",
      createdAt: this.state.elapsed,
    });
    this.state.selectedPointId = null;
    this.state.signal = Math.max(0, this.state.signal - 6);
    this.commitValidAction(
      actor,
      "cartographer",
      "route",
      `连接路线 ${edge.id} · ${this.state.routes.length}/3`,
      "route",
    );
  }

  markRisk(actor) {
    const cursor = this.state.cursors.cartographer;
    let nearest = null;
    let nearestDistance = Infinity;
    for (const zone of RISK_ZONES) {
      const distance = Math.hypot(cursor.x - zone.x, cursor.y - zone.y);
      if (distance < RISK_RADIUS && distance < nearestDistance) {
        nearest = zone;
        nearestDistance = distance;
      }
    }
    if (!nearest) {
      this.applyMistake(
        actor,
        "cartographer",
        "wrong_risk",
        `${seatLabel(actor)} 的风险标记偏离预定区段`,
        2,
      );
      return;
    }
    if (!this.state.routes.some((route) => route.id === nearest.routeId)) {
      this.applyMistake(
        actor,
        "cartographer",
        "risk_locked",
        `${seatLabel(actor)} 在路线 ${nearest.routeId} 连通前尝试标注风险`,
        2,
      );
      return;
    }
    if (this.state.risks.some((risk) => risk.zoneId === nearest.id)) {
      this.applyMistake(
        actor,
        "cartographer",
        "duplicate_risk",
        `${seatLabel(actor)} 重复标注风险 ${nearest.id}，评分下降`,
        10,
        true,
      );
      return;
    }
    this.state.risks.push({
      id: nearest.id,
      zoneId: nearest.id,
      routeId: nearest.routeId,
      label: nearest.label,
      x: nearest.x,
      y: nearest.y,
      ownerSide: actor,
      ownerLabel: actor === "debug" ? "DBG" : actor === "left" ? "P1" : "P2",
      createdAt: this.state.elapsed,
    });
    this.state.signal = Math.max(0, this.state.signal - 8);
    this.commitValidAction(
      actor,
      "cartographer",
      "risk",
      `标注风险 ${nearest.id} ${nearest.label} · ${this.state.risks.length}/2`,
      "risk",
    );
  }

  commitValidAction(actor, role, type, message, sound) {
    this.state.metrics.actions += 1;
    this.state.lastAction = {
      actor,
      role,
      message,
      t: this.state.elapsed,
    };
    this.recordEvent(
      type,
      `${seatLabel(actor)} ${message} · 全队信号 ${Math.round(this.state.signal)}%`,
      {
        actor,
        role,
        sound,
      },
    );
    this.toast(`${message} · 双方仪表已同步`, "success");
    if (this.state.recovery.active) this.recoverFromConflict(actor, role);
    this.checkCompletion();
    if (this.state.status === "running" && this.state.signal <= 0) {
      this.fail("共享同步信号耗尽", "信号池归零，双方仪表已冻结。");
    }
  }

  recoverFromConflict(actor, role) {
    if (!this.state.recovery.active) return;
    const seconds = formatTime(this.state.elapsed, true);
    const previousReason = this.state.recovery.reason;
    this.state.recovery = { active: false, side: null, reason: "" };
    this.state.score = Math.min(INITIAL_SCORE, this.state.score + 2);
    this.state.metrics.recoveries += 1;
    this.recordEvent(
      "recovery",
      `${seatLabel(actor)} 在 ${seconds} 完成修正并恢复“${previousReason}” · 评分 +2`,
      {
        actor,
        role,
        recovery: true,
        sound: "resume",
      },
    );
    this.toast("冲突已修正 · 评分 +2 · 双方仪表已同步", "success");
  }

  applyMistake(actor, role, type, message, penalty, duplicate = false) {
    this.state.score = Math.max(0, this.state.score - penalty);
    this.state.metrics.conflicts += 1;
    this.state.metrics.mistakes += 1;
    if (duplicate) this.state.metrics.duplicates += 1;
    this.state.recovery = {
      active: true,
      side: actor,
      reason: message,
    };
    this.state.lastAction = {
      actor,
      role,
      message: `冲突 · ${message}`,
      t: this.state.elapsed,
    };
    this.recordEvent(type, `${message} · 评分 −${penalty}`, {
      actor,
      role,
      conflict: true,
      sound: "warning",
    });
    this.toast(`${message} · 评分 −${penalty}`, "error");
  }

  checkCompletion() {
    if (this.state.status !== "running") return;
    const complete =
      this.state.points.length >= 4 &&
      this.state.routes.length >= 3 &&
      this.state.risks.length >= 2;
    if (!complete) return;
    const result = {
      success: true,
      reason: "全部标注完成，北岸测绘链路完整。",
      score: this.state.score,
      elapsed: this.state.elapsed,
      timeLeft: this.state.timeLeft,
      conflicts: this.state.metrics.conflicts,
      recoveries: this.state.metrics.recoveries,
      grade:
        this.state.score >= 95
          ? "S"
          : this.state.score >= 85
            ? "A"
            : this.state.score >= 70
              ? "B"
              : "C",
      finishedAt: new Date().toISOString(),
    };
    this.state.status = "success";
    this.state.result = result;
    this.recordEvent(
      "success",
      `全部标注完成：${this.state.points.length} 测量点 / ${this.state.routes.length} 路线 / ${this.state.risks.length} 风险 · 最终评分 ${this.state.score}`,
      {
        actor: "system",
        conflict: false,
        sound: "success",
      },
    );
    this.callbacks.onResult?.(result, this.state);
    this.archiveSession("任务成功");
  }

  fail(reason, detail) {
    if (this.state.status !== "running") return;
    const result = {
      success: false,
      reason,
      detail,
      score: this.state.score,
      elapsed: this.state.elapsed,
      timeLeft: this.state.timeLeft,
      conflicts: this.state.metrics.conflicts,
      recoveries: this.state.metrics.recoveries,
      unfinished: {
        points: 4 - this.state.points.length,
        routes: 3 - this.state.routes.length,
        risks: 2 - this.state.risks.length,
      },
      finishedAt: new Date().toISOString(),
    };
    this.state.status = "failed";
    this.state.result = result;
    this.recordEvent(
      "fail",
      `任务失败：${reason}。${detail}`,
      {
        actor: "system",
        conflict: true,
        sound: "fail",
      },
    );
    this.callbacks.onResult?.(result, this.state);
    this.archiveSession("任务失败");
  }

  undoSurveyPoint(actor) {
    const ownPoints = this.state.points.filter(
      (candidate) => candidate.ownerSide === actor,
    );
    const cursor = this.state.cursors.surveyor;
    const nearby = ownPoints
      .map((candidate) => ({
        candidate,
        distance: Math.hypot(cursor.x - candidate.x, cursor.y - candidate.y),
      }))
      .filter((entry) => entry.distance < ACTION_RADIUS)
      .sort((a, b) => a.distance - b.distance)[0]?.candidate;
    const point = nearby ?? ownPoints.at(-1);
    if (!point) {
      this.toast("没有可撤回的测量点；其他席位的标记不会被修改", "error");
      this.sound("blocked");
      return;
    }
    const linkedRoute = this.state.routes.find(
      (route) => route.from === point.targetId || route.to === point.targetId,
    );
    if (linkedRoute) {
      this.state.metrics.blocked += 1;
      this.state.metrics.conflicts += 1;
      this.recordEvent(
        "blocked_undo",
        `${seatLabel(actor)} 的撤回被拦截：${point.targetId} 已被 ${seatLabel(linkedRoute.ownerSide)} 连入路线，另一侧操作保持完整`,
        {
          actor,
          role: "surveyor",
          conflict: true,
          sound: "blocked",
        },
      );
      this.toast(
        `撤回已拦截 · ${point.targetId} 已被另一侧连接，不能单方删除`,
        "error",
      );
      return;
    }
    this.state.points = this.state.points.filter(
      (candidate) => candidate.id !== point.id,
    );
    if (this.state.selectedPointId === point.targetId) {
      this.state.selectedPointId = null;
    }
    this.state.signal = Math.min(100, this.state.signal + 4);
    this.recordEvent(
      "undo_point",
      `${seatLabel(actor)} 撤回自己的测量点 ${point.targetId}，其他侧标记未受影响`,
      {
        actor,
        role: "surveyor",
        sound: "undo",
      },
    );
    this.toast(`已撤回自己的测量点 ${point.targetId}`, "info");
  }

  undoCartography(actor) {
    const risk = [...this.state.risks]
      .reverse()
      .find((candidate) => candidate.ownerSide === actor);
    const route = [...this.state.routes]
      .reverse()
      .find((candidate) => candidate.ownerSide === actor);
    if (!risk && !route) {
      this.toast("没有可撤回的制图操作；测量点不会被修改", "error");
      this.sound("blocked");
      return;
    }
    if (risk) {
      this.state.risks = this.state.risks.filter(
        (candidate) => candidate.id !== risk.id,
      );
      this.state.signal = Math.min(100, this.state.signal + 8);
      this.recordEvent(
        "undo_risk",
        `${seatLabel(actor)} 撤回自己的风险标记 ${risk.id}，测量点及路线保持完整`,
        {
          actor,
          role: "cartographer",
          sound: "undo",
        },
      );
      this.toast(`已撤回自己的风险标记 ${risk.id}`, "info");
      return;
    }
    const dependentRisk = this.state.risks.find(
      (candidate) => candidate.routeId === route.id,
    );
    if (dependentRisk) {
      this.state.metrics.blocked += 1;
      this.state.metrics.conflicts += 1;
      this.recordEvent(
        "blocked_undo",
        `${seatLabel(actor)} 的路线撤回被拦截：${route.id} 上仍有风险标记 ${dependentRisk.id}`,
        {
          actor,
          role: "cartographer",
          conflict: true,
          sound: "blocked",
        },
      );
      this.toast("撤回已拦截 · 先移除该路线上的风险标记", "error");
      return;
    }
    this.state.routes = this.state.routes.filter(
      (candidate) => candidate.id !== route.id,
    );
    this.state.signal = Math.min(100, this.state.signal + 6);
    this.recordEvent(
      "undo_route",
      `${seatLabel(actor)} 撤回自己的路线 ${route.id}，测量点保持完整`,
      {
        actor,
        role: "cartographer",
        sound: "undo",
      },
    );
    this.toast(`已撤回自己的路线 ${route.id}`, "info");
  }

  archiveSession(reason = "手动归档") {
    if (this.state.archived) return null;
    const record = {
      id: this.state.sessionId,
      runNumber: this.state.runNumber,
      startedAt: this.state.startedAt,
      archivedAt: new Date().toISOString(),
      reason,
      outcome: this.state.status,
      debug: this.state.debug,
      roleMap: { ...this.state.roleMap },
      elapsed: this.state.elapsed,
      timeLeft: this.state.timeLeft,
      score: this.state.score,
      signal: this.state.signal,
      points: this.state.points.map((point) => ({ ...point })),
      routes: this.state.routes.map((route) => ({ ...route })),
      risks: this.state.risks.map((risk) => ({ ...risk })),
      metrics: { ...this.state.metrics },
      result: this.state.result ? { ...this.state.result } : null,
      events: this.state.events.map((event) => ({ ...event })),
    };
    this.state.archived = true;
    this.callbacks.onArchive?.(record);
    return record;
  }

  restart(options = {}) {
    const previousRoles = { ...this.state.roleMap };
    if (this.state.status !== "success" && this.state.status !== "failed") {
      this.recordEvent(
        "restart",
        options.rotation
          ? "职责轮换：归档本轮并交换双方控制职责"
          : "重新开始：归档本轮并复位全部仪表",
        {
          actor: "system",
        },
      );
    }
    this.archiveSession(options.rotation ? "职责轮换" : "重新开始");
    this.runNumber += 1;
    const nextConfig = {
      debug: options.debug ?? this.state.debug,
      roleMap: options.roleMap ?? previousRoles,
    };
    this.state = this.createInitialState(nextConfig);
    if (nextConfig.debug && options.debugRole) {
      this.state.debugRole = options.debugRole;
    }
    this.callbacks.onReset?.(this.state, options);
    const leftRole = ROLES[this.state.roleMap.left].name;
    const rightRole = ROLES[this.state.roleMap.right].name;
    if (options.rotation) {
      this.toast(`职责已轮换 · P1 → ${leftRole} / P2 → ${rightRole}`, "success");
    } else if (nextConfig.debug) {
      this.toast("单人调试已重置 · Tab 切换控制职责", "info");
    } else {
      this.toast("作业已重开 · 仪表、资源、倒计时与音效已复位", "success");
    }
    this.notify();
    return this.state;
  }

  rotateRoles() {
    const swapped = {
      left: this.state.roleMap.right,
      right: this.state.roleMap.left,
    };
    this.restart({ roleMap: swapped, debug: false, rotation: true });
  }

  toggleDebug() {
    const nextDebug = !this.state.debug;
    this.restart({
      debug: nextDebug,
      roleMap: { ...this.state.roleMap },
      debugRole: "surveyor",
    });
  }

  setTimeLeft(seconds) {
    this.state.timeLeft = Math.max(0, Math.min(SESSION_SECONDS, seconds));
    if (this.state.timeLeft <= 0 && this.state.status === "running") {
      this.fail("作业窗口已关闭", "倒计时归零，仍有标注未完成。");
    }
    this.notify();
  }

  setSignal(value) {
    this.state.signal = Math.max(0, Math.min(100, value));
    if (this.state.signal <= 0 && this.state.status === "running") {
      this.fail("共享同步信号耗尽", "信号池归零，双方仪表已冻结。");
    }
    this.notify();
  }
}
