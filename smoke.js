/* smoke.js — 在 jsdom + node-canvas 中端到端运行 index.html 应用 */
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const assert = require("assert");

const ROOT = __dirname;
let html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const coreSrc = fs.readFileSync(path.join(ROOT, "core.js"), "utf8");
const appSrc = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");
html = html
  .replace('<script src="core.js"></script>', "<script>" + coreSrc + "</script>")
  .replace('<script src="app.js"></script>', "<script>" + appSrc + "</script>");

// 可控的 rAF 队列 + 音频录制
const rafQueue = [];
const beeps = [];
let stoppedOsc = 0;
let clockMs = 0;

const dom = new JSDOM(html, {
  url: "http://localhost/",
  runScripts: "dangerously",
  pretendToBeVisual: false,
  beforeParse(window) {
    window.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
    window.URL.createObjectURL = () => "blob:mock";
    window.URL.revokeObjectURL = () => {};
    window.AudioContext = class {
      constructor() {
        this.state = "running"; this.currentTime = 0;
        this.destination = {};
      }
      resume() { return Promise.resolve(); }
      createGain() {
        return { gain: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
      }
      createOscillator() {
        return {
          type: "", frequency: { value: 0 },
          connect() {},
          start(t) { beeps.push({ freq: this.frequency.value, at: clockMs / 1000 }); },
          stop() { stoppedOsc++; }
        };
      }
    };
  }
});
const { window } = dom;
const $ = (id) => window.document.getElementById(id);

function pump(frames, stepMs) {
  for (let i = 0; i < frames; i++) {
    clockMs += stepMs;
    const q = rafQueue.splice(0, rafQueue.length);
    q.forEach((cb) => cb(clockMs));
  }
}
function snap(canvas) {
  return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.slice();
}
function pixelsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

let passed = 0;
const asyncChecks = [];
function ok(name, fn) {
  const r = fn();
  if (r && typeof r.then === "function") {
    asyncChecks.push(r.then(() => { passed++; console.log("  PASS " + name); }));
  } else {
    passed++; console.log("  PASS " + name);
  }
}

// 等初始化帧
pump(2, 16);

// 拖到 t=2.0（避开开头淡入转场的全黑帧）
const scrub0 = $("scrub");
scrub0.value = "2.0";
scrub0.dispatchEvent(new window.Event("input", { bubbles: true }));
pump(1, 16);

ok("初始渲染：四视图均有内容且 A/B 不同", () => {
  const a = snap($("viewA")), b = snap($("viewB"));
  assert(!pixelsEqual(a, b), "A/B 视图应不同");
  assert(a.some((v) => v !== 0), "A 视图全黑");
  assert($("diffStat").textContent.includes("%"), "差分统计未显示");
});

ok("播放→暂停截图 == 从头重放到同一时刻", () => {
  $("playBtn").click();                 // 播放
  pump(150, 16);                        // ~2.4s
  $("playBtn").click();                 // 暂停
  const t1 = parseFloat($("timeLbl").textContent);
  const shot1 = snap($("viewA"));
  const mix1 = snap($("viewMix"));
  // 从头重放到同一时刻
  const scrub = $("scrub");
  scrub.value = "0";
  scrub.dispatchEvent(new window.Event("input", { bubbles: true }));
  $("playBtn").click();
  let guard = 0;
  while (parseFloat($("timeLbl").textContent) < t1 - 0.0005 && guard++ < 2000) pump(1, 16);
  $("playBtn").click();
  const scrub2 = $("scrub");
  scrub2.value = String(t1);
  scrub2.dispatchEvent(new window.Event("input", { bubbles: true }));
  const shot2 = snap($("viewA"));
  const mix2 = snap($("viewMix"));
  assert(pixelsEqual(shot1, shot2), "viewA 两次画面不一致");
  assert(pixelsEqual(mix1, mix2), "叠加视图两次画面不一致");
});

ok("音频事件与时间轴一致", () => {
  beeps.length = 0;
  const sc = $("scrub");
  sc.value = "0.5";
  sc.dispatchEvent(new window.Event("input", { bubbles: true }));
  $("playBtn").click();
  pump(250, 16);                        // 播放 ~4.0s → 到 ~4.5s
  $("playBtn").click();
  const freqs = beeps.map((b) => b.freq);
  // 区间 (0.5, 4.5] 内应有 2s(554) 与 4s(659) 两个事件，且各恰好一次
  assert.strictEqual(freqs.filter((f) => f === 554).length, 1, "2s 处 beep 缺失或重复: " + freqs);
  assert.strictEqual(freqs.filter((f) => f === 659).length, 1, "4s 处 beep 缺失或重复: " + freqs);
  assert(!freqs.includes(440), "0s 的 beep 不应在从 0.5s 播放时响起");
});

ok("保存→修改→重新载入：关键帧/字幕/音频位置恢复", () => {
  $("saveBtn").click();
  const savedRaw = window.localStorage.getItem("animdiff.project.v1");
  assert(savedRaw, "未写入 localStorage");
  // 先制造一个正在发声的振荡器，再切场景：必须被停止
  $("playBtn").click();
  pump(200, 16);                        // 跨越若干 beep
  const beforeSwitch = stoppedOsc;
  // 模拟用户破坏当前工程：切场景（会改 activeScene）
  const sel = $("sceneSel");
  sel.value = "1";
  sel.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert($("status").textContent.includes("夜景"));
  assert(stoppedOsc > beforeSwitch, "切场景时上一场景音频未被停止");
  // 重新载入
  $("loadBtn").click();
  const restored = JSON.parse(window.localStorage.getItem("animdiff.project.v1"));
  assert.strictEqual(restored.scenes[0].keysA.length, 4, "场景0关键帧丢失");
  assert.strictEqual(restored.scenes[1].keysB.length, 4, "场景1关键帧丢失");
  assert.strictEqual(restored.scenes[0].subtitles.length, 3, "字幕丢失");
  assert.strictEqual(restored.scenes[0].audioEvents[0].time, 0, "音频起始位置丢失");
  assert.strictEqual(restored.scenes[0].transition.type, "fade", "转场丢失");
});

ok("入点/出点/总时长导出后一致", () => {
  $("inPt").value = "1.0"; $("inPt").dispatchEvent(new window.Event("change", { bubbles: true }));
  $("outPt").value = "7.0"; $("outPt").dispatchEvent(new window.Event("change", { bubbles: true }));
  $("saveBtn").click();
  const p = JSON.parse(window.localStorage.getItem("animdiff.project.v1"));
  const s = p.scenes[p.activeScene];
  assert.strictEqual(s.inPoint, 1.0);
  assert.strictEqual(s.outPoint, 7.0);
  assert.strictEqual(s.duration, 8);
  assert.strictEqual(s.outPoint - s.inPoint, 6.0, "导出入出点跨度不一致");
});

let downloadName = null;
window.HTMLAnchorElement.prototype.click = function () { downloadName = this.download; };

ok("导出当前对比图：生成 PNG 且元数据一致", async () => {
  // 先等待一帧确保画面最新
  pump(1, 16);
  $("exportBtn").click();
  await new Promise((r) => setTimeout(r, 300));
  assert(downloadName, "未触发下载");
  assert(downloadName.includes("in1.0-out7.0"), "文件名未包含入出点: " + downloadName);
  assert($("status").textContent.includes("已导出"), "状态未确认导出");
});

ok("导出失败时保留原工程", () => {
  const before = window.localStorage.getItem("animdiff.project.v1");
  // 破坏 toBlob 使导出失败
  const orig = window.HTMLCanvasElement.prototype.toBlob;
  window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); };
  $("exportBtn").click();
  window.HTMLCanvasElement.prototype.toBlob = orig;
  assert($("status").textContent.includes("导出失败"), "未提示导出失败");
  assert.strictEqual(window.localStorage.getItem("animdiff.project.v1"), before, "原工程被覆盖");
});

ok("载入损坏存档不破坏当前工程", () => {
  const before = $("status").textContent;
  window.localStorage.setItem("animdiff.project.v1", "{corrupted!!!");
  $("loadBtn").click();
  assert($("status").textContent.includes("载入失败"), "未提示载入失败");
  // 工程仍然可渲染
  pump(1, 16);
  assert(snap($("viewA")).some((v) => v !== 0), "损坏载入后画面丢失");
});

(async () => {
  // 等待 async 测试完成
  await Promise.all(asyncChecks);
  await new Promise((r) => setTimeout(r, 600));
  console.log("\n" + passed + " smoke tests passed.");
  process.exit(0);
})();
