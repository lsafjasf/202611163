/* Main controller: wires physics kernel to canvas, controls, audio and logs. */
(function () {
  "use strict";

  const P = window.GyroPhysics;
  const R = window.GyroRender;
  const AudioFeedback = window.GyroAudio;
  const Store = window.GyroStorage;
  const { SCENARIOS } = window.GyroScenarios;

  const SLIDER_DEFS = [
    { key: "m", step: 0.05 },
    { key: "wsCmd", step: 1 },
    { key: "biasX", step: 0.01 },
    { key: "biasY", step: 0.01 },
    { key: "biasZ", step: 0.01 },
    { key: "kp", step: 0.5 },
    { key: "kd", step: 0.1 }
  ];

  const TRACE_LEN = 160;
  const state = {
    sim: null,
    paused: false,
    replaying: false,
    replayIndex: 0,
    audio: new AudioFeedback(),
    prev: {},
    traces: { omega: [[], [], []], error: [[], []] },
    lastLogCount: 0
  };

  const el = (id) => document.getElementById(id);
  const fmt = (x, d = 3) =>
    Number.isFinite(x) ? x.toFixed(d) : "—";

  function currentParams() {
    const p = Object.assign({}, P.DEFAULTS);
    SLIDER_DEFS.forEach((def) => {
      p[def.key] = parseFloat(el("sl_" + def.key).value);
    });
    return p;
  }

  function buildSliders() {
    const host = el("sliders");
    host.innerHTML = "";
    SLIDER_DEFS.forEach((def) => {
      const lim = P.LIMITS[def.key];
      const row = document.createElement("div");
      row.className = "slider-row";
      row.id = "row_" + def.key;
      row.innerHTML =
        '<label><span>' +
        lim.label +
        "</span><span class=\"val\" id=\"val_" +
        def.key +
        '"></span></label>' +
        '<input type="range" id="sl_' +
        def.key +
        '" min="' +
        lim.min +
        '" max="' +
        lim.max +
        '" step="' +
        def.step +
        '" value="' +
        P.DEFAULTS[def.key] +
        '">' +
        '<div class="lim">范围 ' +
        lim.min +
        " ~ " +
        lim.max +
        " " +
        lim.unit +
        "</div>";
      host.appendChild(row);
      const input = el("sl_" + def.key);
      input.addEventListener("input", () => {
        el("val_" + def.key).textContent =
          input.value + " " + lim.unit;
        validateLive();
      });
      el("val_" + def.key).textContent =
        input.value + " " + lim.unit;
    });
    validateLive();
  }

  function validateLive() {
    const params = currentParams();
    const res = P.validateParams(params);
    SLIDER_DEFS.forEach((def) => {
      const bad = res.violations.some((v) => v.key === def.key);
      el("row_" + def.key).classList.toggle("violate", bad);
    });
    return res;
  }

  function setSliders(params) {
    SLIDER_DEFS.forEach((def) => {
      if (params[def.key] === undefined) return;
      el("sl_" + def.key).value = params[def.key];
      el("val_" + def.key).textContent =
        params[def.key] + " " + P.LIMITS[def.key].unit;
    });
    validateLive();
  }

  function newSim(params) {
    state.sim = new P.Simulation(params || currentParams());
    state.paused = false;
    state.replaying = false;
    state.prev = {};
    state.traces = { omega: [[], [], []], error: [[], []] };
    state.lastLogCount = 0;
    el("btnReplay").disabled = true;
    hideBanner();
    el("limitWarn").classList.add("hidden");
    renderLog(true);
    updateStatusPill();
  }

  window.addEventListener("DOMContentLoaded", () => {
    buildSliders();
    newSim();
    bindControls();
    bindScenarios();
    requestAnimationFrame(loop);
  });

  function bindControls() {
    el("btnPause").addEventListener("click", togglePause);
    el("btnStep").addEventListener("click", singleStep);
    el("btnReset").addEventListener("click", () => {
      newSim(currentParams());
      pushLog("手动重置，初始条件已恢复", "info");
    });
    el("btnAudio").addEventListener("click", toggleAudio);
    el("btnSave").addEventListener("click", saveCalibration);
    el("btnLoad").addEventListener("click", loadCalibration);
    el("btnReplay").addEventListener("click", startReplay);
    el("btnSelftest").addEventListener("click", runSelftest);
    el("btnInject").addEventListener("click", injectOutOfLimit);
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        togglePause();
      } else if (e.key === "s" || e.key === "S") {
        singleStep();
      } else if (e.key === "r" || e.key === "R") {
        newSim(currentParams());
      }
    });
  }

  function togglePause() {
    if (state.sim.status !== "running") return;
    state.paused = !state.paused;
    el("btnPause").textContent = state.paused ? "继续" : "暂停";
    updateStatusPill();
    pushLog(state.paused ? "仿真暂停" : "仿真继续", "info");
  }

  function singleStep() {
    if (state.sim.status !== "running") return;
    if (!state.paused) {
      state.paused = true;
      el("btnPause").textContent = "继续";
    }
    for (let i = 0; i < P.STEPS_PER_FRAME; i++) state.sim.step();
    updateStatusPill();
    pushLog(
      "单步推进一帧 (" +
        P.STEPS_PER_FRAME +
        " 个物理步, t=" +
        state.sim.state.t.toFixed(3) +
        "s)",
      "info"
    );
  }

  window.__gyroApp = { state, newSim, currentParams, setSliders };

  let lastFrame = performance.now();

  function loop(now) {
    const dtMs = Math.min(50, now - lastFrame);
    lastFrame = now;
    const sim = state.sim;

    if (state.replaying) {
      advanceReplay();
    } else if (!state.paused && sim.status === "running") {
      const steps = Math.round((dtMs / 1000) / P.DT);
      for (let i = 0; i < steps && sim.status === "running"; i++) sim.step();
      if (sim.status !== "running") onTerminal();
    }

    render();
    requestAnimationFrame(loop);
  }

  function onTerminal() {
    const sim = state.sim;
    el("btnReplay").disabled = sim.history.length < 2;
    if (sim.status === "success") {
      state.audio.success();
      showBanner(true);
    } else {
      state.audio.trip();
      showBanner(false);
    }
    updateStatusPill();
    renderLog(false);
  }

  function pushTrace(arr, v) {
    arr.push(v);
    if (arr.length > TRACE_LEN) arr.shift();
  }

  function render() {
    const sim = state.sim;
    const st = state.replaying
      ? sim.history[state.replayIndex]
      : sim.state;

    R.drawSphere(el("sphere"), st, { x: st.trqX, y: st.trqY });
    if (!state.replaying) {
      pushTrace(state.traces.omega[0], st.wx);
      pushTrace(state.traces.omega[1], st.wy);
      pushTrace(state.traces.omega[2], st.ws);
      pushTrace(state.traces.error[0], st.qx);
      pushTrace(state.traces.error[1], st.qy);
    }
    R.drawTrace(
      el("omegaChart"),
      [
        { data: state.traces.omega[0], color: "#5aa2ff", label: "ωx" },
        { data: state.traces.omega[1], color: "#ffb347", label: "ωy" },
        { data: state.traces.omega[2], color: "#46d68c", label: "自旋ωs" }
      ],
      { title: "角速度 (rad/s)", min: -40, max: 460, digits: 0 }
    );
    R.drawTrace(
      el("errorChart"),
      [
        { data: state.traces.error[0], color: "#ff8fa3", label: "qx" },
        { data: state.traces.error[1], color: "#b18cff", label: "qy" }
      ],
      { title: "姿态误差 (rad)", min: -0.36, max: 0.36, digits: 2 }
    );

    renderReadouts(st);
    state.audio.update(st.qx, st.qy, st.tilt);
    renderLog(false);
  }

  const METRICS = [
    { k: "时间 t", key: "t", d: 2, unit: "s" },
    { k: "倾角 |q|", key: "tilt", d: 4, unit: "rad" },
    { k: "qx", key: "qx", d: 4, unit: "rad" },
    { k: "qy", key: "qy", d: 4, unit: "rad" },
    { k: "ωx", key: "wx", d: 3, unit: "rad/s" },
    { k: "ωy", key: "wy", d: 3, unit: "rad/s" },
    { k: "自旋 ωs", key: "ws", d: 1, unit: "rad/s" },
    { k: "温度", key: "temp", d: 1, unit: "°C" },
    { k: "轴承压力", key: "pressure", d: 0, scale: 1e-6, unit: "MPa" },
    { k: "校正力矩 X", key: "trqX", d: 3, unit: "N·m" },
    { k: "校正力矩 Y", key: "trqY", d: 3, unit: "N·m" },
    { k: "保持计时", key: "hold", d: 1, unit: "s" }
  ];

  function renderReadouts(st) {
    const host = el("readouts");
    if (host.childElementCount !== METRICS.length) {
      host.innerHTML = METRICS.map(
        (m) =>
          '<div class="metric" id="m_' +
          m.key +
          '"><div class="k">' +
          m.k +
          '</div><div class="v"></div><div class="delta"></div></div>'
      ).join("");
    }
    METRICS.forEach((m) => {
      const raw = st[m.key];
      const value = m.scale ? raw * m.scale : raw;
      const box = el("m_" + m.key);
      box.querySelector(".v").textContent = fmt(value, m.d) + " " + m.unit;
      const prev = state.prev[m.key];
      if (prev !== undefined && Math.abs(raw - prev) > 1e-9) {
        const delta = m.scale ? (raw - prev) * m.scale : raw - prev;
        box.querySelector(".delta").textContent =
          "Δ " + (delta >= 0 ? "+" : "") + delta.toExponential(2);
        box.classList.add("flash");
        setTimeout(() => box.classList.remove("flash"), 220);
      }
      state.prev[m.key] = raw;
    });
  }

  function updateStatusPill() {
    const pill = el("statusPill");
    const sim = state.sim;
    pill.className = "status-pill";
    if (state.replaying) {
      pill.textContent = "回放中";
      pill.classList.add("paused");
    } else if (sim.status === "tripped") {
      pill.textContent = "已触发停止";
      pill.classList.add("tripped");
    } else if (sim.status === "success") {
      pill.textContent = "校准成功";
      pill.classList.add("success");
    } else if (state.paused) {
      pill.textContent = "已暂停";
      pill.classList.add("paused");
    } else {
      pill.textContent = "运行中";
      pill.classList.add("running");
    }
  }

  function showBanner(ok) {
    const banner = el("tripBanner");
    const sim = state.sim;
    banner.className = "trip-banner" + (ok ? " success" : "");
    if (ok) {
      banner.innerHTML =
        "<strong>✅ 校准成功</strong><br>目标姿态已连续保持 10 秒。可点击「保存校准」固化参数。";
      return;
    }
    const ev = sim.event;
    const s = ev.snap;
    banner.innerHTML =
      "<strong>⛔ 触发停止：" +
      ev.msg +
      "</strong><br>触发时间 t=" +
      s.t.toFixed(3) +
      "s<br>位置 qx=" +
      fmt(s.qx, 4) +
      " qy=" +
      fmt(s.qy, 4) +
      " rad<br>速度 ωx=" +
      fmt(s.wx, 3) +
      " ωy=" +
      fmt(s.wy, 3) +
      " ωs=" +
      fmt(s.ws, 2) +
      " rad/s<br>压力 " +
      (s.pressure / 1e6).toFixed(3) +
      " MPa，温度 " +
      fmt(s.temp, 2) +
      " °C<br>越限量 <em>" +
      ev.limit.label +
      "</em>，限值 " +
      ev.limit.min +
      " ~ " +
      ev.limit.max +
      " " +
      ev.limit.unit +
      "，实际 " +
      fmt(ev.value, 4);
  }

  function hideBanner() {
    el("tripBanner").className = "trip-banner hidden";
  }

  function pushLog(msg, kind) {
    state.sim.log.push({
      t: state.sim.state.t,
      kind: kind || "info",
      msg
    });
  }

  function renderLog(reset) {
    const host = el("eventLog");
    const log = state.sim.log;
    if (reset || state.lastLogCount > log.length) {
      host.innerHTML = "";
      state.lastLogCount = 0;
    }
    for (let i = state.lastLogCount; i < log.length; i++) {
      const e = log[i];
      const li = document.createElement("li");
      li.className = "new";
      li.innerHTML =
        '<span class="t">' +
        e.t.toFixed(3) +
        's</span><span class="k">[' +
        e.kind +
        "]</span><span>" +
        e.msg +
        "</span>";
      host.appendChild(li);
      host.scrollTop = host.scrollHeight;
      setTimeout(() => li.classList.remove("new"), 600);
    }
    state.lastLogCount = log.length;
  }

  function bindScenarios() {
    const host = el("scenarioBtns");
    SCENARIOS.forEach((sc) => {
      const b = document.createElement("button");
      b.className = "btn ghost";
      b.textContent = sc.name;
      b.title = sc.description;
      b.addEventListener("click", () => {
        setSliders(sc.params);
        newSim(sc.params);
        pushLog("载入工况：" + sc.name + "（" + sc.description + "）", "scenario");
      });
      host.appendChild(b);
    });
  }

  function startReplay() {
    const sim = state.sim;
    if (sim.history.length < 2) return;
    state.replaying = true;
    state.replayIndex = 0;
    state.paused = false;
    el("btnPause").textContent = "暂停";
    updateStatusPill();
    pushLog("开始回放，共 " + sim.history.length + " 个快照", "replay");
  }

  function advanceReplay() {
    const hist = state.sim.history;
    // replay at ~1x speed: snapshots are 20 ms apart, advance one per frame
    state.replayIndex++;
    if (state.replayIndex >= hist.length) {
      state.replaying = false;
      state.replayIndex = hist.length - 1;
      updateStatusPill();
      pushLog("回放结束", "replay");
    }
  }

  async function toggleAudio() {
    const btn = el("btnAudio");
    if (state.audio.enabled) {
      state.audio.disable();
      btn.textContent = "开启音频";
    } else {
      try {
        await state.audio.enable();
        btn.textContent = "关闭音频";
      } catch (e) {
        pushLog("音频初始化失败：" + e.message, "error");
      }
    }
  }

  function saveCalibration() {
    const params = currentParams();
    const check = P.validateParams(params);
    if (!check.ok) {
      pushLog(
        "保存被拦截：参数越限 " +
          check.violations.map((v) => v.label).join(", "),
        "error"
      );
      return;
    }
    const payload = Store.save({
      params,
      note: "tilt/ws/temp/pressure within limits"
    });
    pushLog(
      "校准参数已保存 (" +
        new Date(payload.savedAt).toLocaleTimeString() +
        ")",
      "storage"
    );
  }

  function loadCalibration() {
    const payload = Store.load();
    if (!payload || !payload.params) {
      pushLog("没有已保存的校准参数", "error");
      return;
    }
    const params = Object.assign({}, P.DEFAULTS, payload.params);
    const check = P.validateParams(params);
    if (!check.ok) {
      pushLog("读取失败：保存的参数已越限", "error");
      return;
    }
    setSliders(params);
    newSim(params);
    pushLog("已读取并应用校准参数", "storage");
  }

  function injectOutOfLimit() {
    const badParams = Object.assign(currentParams(), { m: 2.4 });
    const check = P.validateParams(badParams);
    const warn = el("limitWarn");
    warn.classList.remove("hidden");
    if (check.ok) {
      warn.textContent = "参数未越限，无法注入。";
      return;
    }
    const v = check.violations[0];
    // Out-of-limit input is rejected: show the trigger point instead of running.
    warn.innerHTML =
      "⛔ 已拦截越限输入，仿真不启动计算。<br>" +
      v.label +
      " = " +
      v.value +
      " " +
      v.unit +
      "，允许范围 " +
      v.min +
      " ~ " +
      v.max +
      " " +
      v.unit +
      "<br>触发点: 参数设置阶段 (t=0.000s)，物理状态保持初始值。";
    pushLog(
      "越限输入被拦截: " +
        v.label +
        "=" +
        v.value +
        " 超出 [" +
        v.min +
        "," +
        v.max +
        "]，未继续计算",
      "limit"
    );
  }

  async function runSelftest() {
    const out = el("selftestOut");
    out.textContent = "自检运行中…";
    try {
      const mod = await import("./selftest-browser.js");
      const report = mod.runBrowser({
        Physics: P,
        Scenarios: SCENARIOS
      });
      out.textContent = report;
    } catch (e) {
      out.textContent = "自检模块加载失败: " + e.message;
    }
  }
})();
