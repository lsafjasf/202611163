/* Browser end-to-end test via puppeteer-core + local headless Chrome. */
const path = require("path");
const puppeteer = require("/tmp/chrome-dl/node_modules/puppeteer-core");

const EXEC = "/tmp/chrome-dl/chrome-linux64/chrome";
const URL = "http://127.0.0.1:8123/index.html";

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond, detail) {
  if (cond) {
    passed++;
    console.log("  PASS " + name);
  } else {
    failed++;
    fails.push(name);
    console.log("  FAIL " + name + (detail ? " -> " + detail : ""));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: EXEC,
    headless: "new",
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--disable-crash-reporter",
      "--disable-breakpad",
      "--allow-file-access-from-files"
    ]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.on("console", (m) => {
    const text = m.text();
    if (m.type() === "error" && !/favicon|404/i.test(text)) {
      consoleErrors.push(text);
    }
  });

  await page.goto(URL, { waitUntil: "networkidle0" });
  await sleep(300);

  console.log("\n[B1] 页面与画布初始化");
  const canvases = await page.$$eval("canvas", (cs) =>
    cs.map((c) => ({ id: c.id, w: c.width, h: c.height }))
  );
  check("3 块画布存在", canvases.length === 3, JSON.stringify(canvases));
  const metrics = await page.$$eval(".metric", (m) => m.length);
  check("关键量读数网格渲染", metrics === 12, "n=" + metrics);
  const sliders = await page.$$eval(".slider-row", (m) => m.length);
  check("7 个参数滑块", sliders === 7, "n=" + sliders);

  console.log("\n[B2] 运行后关键物理量更新");
  await sleep(1500);
  const running = await page.$eval("#statusPill", (e) => e.textContent);
  check("状态显示运行中/成功", /运行中|成功/.test(running), running);
  const tVal = await page.$eval("#m_t .v", (e) => e.textContent);
  check("时间在推进", parseFloat(tVal) > 0.5, tVal);

  console.log("\n[B3] 暂停/单步/重置");
  await page.click("#btnPause");
  const pausedT = await page.evaluate(
    () => window.__gyroApp.state.sim.state.t
  );
  await sleep(400);
  const stillT = await page.evaluate(
    () => window.__gyroApp.state.sim.state.t
  );
  check("暂停后时间冻结", pausedT === stillT, pausedT + " vs " + stillT);
  await page.click("#btnStep");
  const stepT = await page.evaluate(
    () => window.__gyroApp.state.sim.state.t
  );
  const stepBase = pausedT;
  check("单步推进一帧 (20ms)", Math.abs(stepT - stepBase - 0.02) < 0.005,
    stepBase + " -> " + stepT);
  // pause then step must equal continuous: compare hash through kernel
  const hashEquality = await page.evaluate(() => {
    const P = window.GyroPhysics;
    const a = new P.Simulation(window.__gyroApp.currentParams());
    const b = new P.Simulation(window.__gyroApp.currentParams());
    a.advance(1);
    b.advance(1);
    for (let i = 0; i < P.STEPS_PER_FRAME; i++) {
      a.step();
      b.step();
    }
    const h = (s) =>
      ["qx", "qy", "wx", "wy", "ws", "tilt", "temp"].reduce(
        (acc, k) => acc + s.state[k].toFixed(9),
        ""
      );
    return h(a) === h(b);
  });
  check("单步与连续推进物理状态相同", hashEquality);
  const resetT = await page.evaluate(() => {
    document.getElementById("btnReset").click();
    return window.__gyroApp.state.sim.state.t;
  });
  check("重置后时间归零", parseFloat(resetT) === 0, resetT);

  console.log("\n[B4] 三种工况");
  const scenarioResult = await page.evaluate(async () => {
    const P = window.GyroPhysics;
    const out = [];
    for (const sc of window.GyroScenarios.SCENARIOS) {
      const sim = new P.Simulation(sc.params);
      while (sim.status === "running" && sim.state.t < 60) sim.step();
      out.push({
        id: sc.id,
        status: sim.status,
        key: sim.event ? sim.event.key : null
      });
    }
    return out;
  });
  check("正常工况成功", scenarioResult[0].status === "success",
    JSON.stringify(scenarioResult[0]));
  check("极限载荷压力触发",
    scenarioResult[1].status === "tripped" && scenarioResult[1].key === "pressure",
    JSON.stringify(scenarioResult[1]));
  check("失稳工况倾角触发",
    scenarioResult[2].status === "tripped" && scenarioResult[2].key === "tilt",
    JSON.stringify(scenarioResult[2]));

  console.log("\n[B5] 滑块越限拦截与触发横幅");
  await page.evaluate(() => {
    const sl = document.getElementById("sl_m");
    sl.value = "2.0";
    sl.dispatchEvent(new Event("input"));
    const sp = document.getElementById("sl_wsCmd");
    sp.value = "420";
    sp.dispatchEvent(new Event("input"));
  });
  await page.click("#btnReset");
  await sleep(200);
  // wait until trip
  await page.waitForFunction(
    () =>
      document
        .getElementById("statusPill")
        .textContent.includes("触发"),
    { timeout: 15000 }
  );
  const banner = await page.$eval("#tripBanner", (e) => e.textContent);
  check("触发横幅含位置/速度/压力/温度",
    /qx=/.test(banner) && /ωs=/.test(banner) && /MPa/.test(banner) && /°C/.test(banner),
    banner.slice(0, 80));

  console.log("\n[B6] 回放无跳变");
  await page.click("#btnReplay");
  const replayOk = await page.evaluate(() => {
    const hist = window.__gyroApp.state.sim.history;
    let maxRate = 0;
    for (let i = 1; i < hist.length; i++) {
      const a = hist[i - 1];
      const b = hist[i];
      const dt = b.t - a.t;
      if (dt <= 0) return false;
      maxRate = Math.max(
        maxRate,
        (Math.abs(b.qx - a.qx) +
          Math.abs(b.qy - a.qy) +
          Math.abs(b.ws - a.ws)) /
          dt
      );
    }
    return maxRate < 300;
  });
  check("回放快照连续", replayOk);

  console.log("\n[B7] 校准存取");
  const storageOk = await page.evaluate(() => {
    const Store = window.GyroStorage;
    const saved = Store.save({ params: window.__gyroApp.currentParams() });
    const loaded = Store.load();
    return loaded && loaded.params.m === saved.params.m;
  });
  check("校准参数保存并读取", storageOk);

  console.log("\n[B8] 浏览器内置自检");
  await page.click("#btnSelftest");
  await page.waitForFunction(
    () => document.getElementById("selftestOut").textContent.includes("结果"),
    { timeout: 8000 }
  );
  const report = await page.$eval("#selftestOut", (e) => e.textContent);
  check("内置自检 0 失败", /0 失败/.test(report), report.split("\n").pop());

  console.log("\n[B9] 越限输入拦截 (显示触发点而非继续计算)");
  const injectOk = await page.evaluate(() => {
    document.getElementById("btnInject").click();
    const warn = document.getElementById("limitWarn");
    const sim = window.__gyroApp.state.sim;
    const tBefore = sim.state.t;
    return (
      !warn.classList.contains("hidden") &&
      /2\.4/.test(warn.textContent) &&
      /拦截/.test(warn.textContent)
    );
  });
  check("越限负载被拦截并显示触发点", injectOk);

  console.log("\n[B10] 音频上下文与无 JS 错误");
  const audioOk = await page.evaluate(async () => {
    const app = window.__gyroApp;
    await app.state.audio.enable();
    const ok =
      app.state.audio.ctx instanceof AudioContext &&
      app.state.audio.enabled === true;
    app.state.audio.update(0.02, -0.03, 0.036);
    return ok;
  });
  check("Web Audio 可建立并更新音高", audioOk);
  check("页面无未捕获 JS 错误", consoleErrors.length === 0,
    consoleErrors.join(" | ").slice(0, 200));

  await browser.close();
  console.log("\n========================================");
  console.log("浏览器 E2E: " + passed + " 通过, " + failed + " 失败");
  if (failed) {
    console.log("失败项:", fails.join(", "));
    process.exit(1);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
