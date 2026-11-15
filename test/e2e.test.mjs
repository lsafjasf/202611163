// 端到端验证：真实浏览器中运行片头工作室。
// 覆盖：传输控制、一致性自检、WebM 导出（含时长校验与落盘）、
// 取消导出无残片、工程保存/重载后关键帧与字幕恢复、场景切换。
import { chromium } from "playwright";
import http from "node:http";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.join(root, "artifacts");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };

const server = http.createServer(async (req, res) => {
  try {
    const file = path.join(root, req.url === "/" ? "index.html" : req.url);
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;

const browser = await chromium.launch({
  args: ["--autoplay-policy=no-user-gesture-required", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error") errors.push(`console: ${m.text()}`); });

let passed = 0;
function ok(name, cond, extra = "") {
  if (!cond) throw new Error(`FAIL: ${name} ${extra}`);
  passed++;
  console.log(`ok - ${name}`);
}

await mkdir(artifacts, { recursive: true });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector("#preview");

// 1. 初始状态：10 秒时间线、三层关键帧轨道、字幕与音频片段
const timecode = await page.textContent("#timecode");
ok("初始时间线为 10 秒", timecode.includes("00:10.000"), timecode);
ok("关键帧已渲染到轨道", (await page.locator(".kf").count()) >= 12);
ok("字幕片段已渲染", (await page.locator(".clip:not(.audio)").count()) >= 2);
ok("音频片段已渲染", (await page.locator(".clip.audio").count()) >= 4);

// 2. 播放/暂停/拖动/循环
await page.click("#btnPlay");
await page.waitForTimeout(600);
const t1 = await page.textContent("#timecode");
await page.click("#btnPlay");
await page.waitForTimeout(150); // 等暂停后的第一帧渲染完成
const t2 = await page.textContent("#timecode");
await page.waitForTimeout(300);
const t3 = await page.textContent("#timecode");
ok("播放推进", !t1.startsWith("00:00.0"), t1);
ok("暂停冻结", t2 === t3, `${t2} vs ${t3}`);
await page.click("#ruler", { position: { x: 480, y: 10 } });
const t4 = await page.textContent("#timecode");
ok("拖动定位到 ~5s", /00:0[45]\./.test(t4), t4);
await page.check("#chkLoop");
await page.click("#btnStop");
await page.click("#btnPlay");
await page.waitForTimeout(10500);
const t5 = await page.textContent("#timecode");
ok("循环回绕（越过出点仍在播放）", !t5.startsWith("00:10.0"), t5);
await page.click("#btnPlay");
await page.uncheck("#chkLoop");
await page.click("#btnStop");

// 3. 一致性自检（暂停截图 vs 重放截图 + 音频事件）
await page.click("#btnSelfTest");
await page.waitForFunction(
  () => document.getElementById("selfTestOut").textContent.includes("全部通过"),
  null, { timeout: 60000 },
);
ok("自检：帧确定性与音频事件一致", true);

// 4. 导出 WebM：音视频同步写入，时长校验通过，文件落盘
const downloadPromise = page.waitForEvent("download", { timeout: 30000 });
await page.click("#btnExport");
await page.waitForFunction(
  () => document.getElementById("exportStatus").textContent.includes("校验通过"),
  null, { timeout: 30000 },
);
const download = await downloadPromise;
const webmPath = path.join(artifacts, "intro-export.webm");
await download.saveAs(webmPath);
const status = await page.textContent("#exportStatus");
ok("导出时长校验通过", status.includes("校验通过"), status);
const head = await readFile(webmPath);
ok("WebM 文件非空且为 EBML", head.length > 100000 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3, `size=${head.length}`);

// 5. 取消导出：无下载、无残片
let cancelDownload = null;
page.on("download", (d) => { cancelDownload = d; });
await page.click("#btnExport");
await page.waitForTimeout(2000);
await page.click("#btnCancelExport");
await page.waitForFunction(
  () => document.getElementById("exportStatus").textContent.includes("已取消"),
);
await page.waitForTimeout(500);
ok("取消导出未产生文件", cancelDownload === null);

// 6. 编辑后持久化：加关键帧 + 字幕，重载页面后恢复
await page.click("#ruler", { position: { x: 672, y: 10 } });
await page.selectOption("#layerSelect", "title");
await page.selectOption("#propSelect", "opacity");
await page.fill("#propValue", "0.5");
await page.click("#btnSetKey");
await page.fill("#subText", "持久化验证字幕");
await page.click("#btnAddSub");
const keysBefore = await page.textContent("#keyList");
ok("新关键帧已加入", keysBefore.includes("0.5"), keysBefore);
await page.reload();
await page.waitForSelector("#preview");
await page.selectOption("#layerSelect", "title");
await page.selectOption("#propSelect", "opacity");
const keysAfter = await page.textContent("#keyList");
ok("重载后关键帧保留", keysAfter.includes("0.5"), keysAfter);
const subsAfter = await page.textContent("#subList");
ok("重载后字幕保留", subsAfter.includes("持久化验证字幕"), subsAfter);
const audioAfter = await page.textContent("#audioList");
ok("重载后音频起始位置保留", audioAfter.includes("@0.40s"), audioAfter);

// 7. 场景切换：新增场景并切换，时间线复位且无报错
await page.click("#btnAddScene");
const tc = await page.textContent("#timecode");
ok("切场景后时间线复位", tc.startsWith("00:00.000"), tc);
ok("场景下拉有两个场景", (await page.locator("#sceneSelect option").count()) === 2);

// 8. 工程 JSON 保存与重新打开
const jsonDownloadPromise = page.waitForEvent("download");
await page.click("#btnSaveJson");
const jsonDownload = await jsonDownloadPromise;
const jsonPath = path.join(artifacts, "project-saved.json");
await jsonDownload.saveAs(jsonPath);
const saved = JSON.parse(await readFile(jsonPath, "utf8"));
ok("JSON 含两个场景与完整图层", saved.scenes.length === 2 && saved.scenes[0].layers.wave && saved.scenes[1].layers.title);
await page.setInputFiles("#fileInput", jsonPath);
await page.waitForFunction(
  () => document.getElementById("exportStatus").textContent.includes("已载入工程"),
);
ok("工程重新打开成功", true);

ok("全程无页面错误", errors.length === 0, errors.join("; "));

console.log(`\n${passed} 项端到端验证全部通过`);
await browser.close();
server.close();
process.exit(0);
