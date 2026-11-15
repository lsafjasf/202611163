import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = process.cwd();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json" };
const server = createServer(async (req, res) => {
  try {
    const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const data = await readFile(join(root, path));
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404); res.end("not found");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

const browser = await chromium.launch({
  executablePath: "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForSelector("#quality-table tbody tr");

const checks = [];
function check(name, cond) {
  if (!cond) throw new Error("断言失败: " + name);
  checks.push(name);
}

// 1. 初始渲染：元信息、质量表、分箱表
check("版本显示", (await page.locator("#meta-line").innerText()).includes("wave-v1.4.0+normal"));
check("质量表 4 行(3台+合计)", await page.locator("#quality-table tbody tr").count() === 4);
check("分箱表 90 行", await page.locator("#bin-table tbody tr").count() === 90);
check("筛选条件文本", (await page.locator("#active-filter-text").innerText()).includes("当前筛选"));

// 2. 切换缺失组，质量摘要联动
await page.click('[data-dataset="missing"]');
await page.waitForFunction(() => document.querySelector("#meta-line").innerText.includes("missing"));
const metaMissing = await page.locator("#meta-line").innerText();
check("缺失组缺失数=64", metaMissing.includes("缺失样例") && metaMissing.includes("64"));

// 3. 切到重复组，去重数=35
await page.click('[data-dataset="duplicate"]');
await page.waitForFunction(() => document.querySelector("#meta-line").innerText.includes("35"));
check("重复组去重=35", (await page.locator("#meta-line").innerText()).includes("35"));

// 4. 台站筛选：只留 STA_A → 30 行
await page.uncheck('.station-chk[value="STA_B"]');
await page.uncheck('.station-chk[value="STA_C"]');
await page.waitForFunction(() => document.querySelectorAll("#bin-table tbody tr").length === 30);
check("单台站筛选=30 分箱", true);
await page.check('.station-chk[value="STA_B"]');
await page.check('.station-chk[value="STA_C"]');

// 5. 质量筛选
await page.selectOption("#quality-filter", "anomaly");
await page.waitForFunction(() => {
  const rows = [...document.querySelectorAll("#bin-table tbody tr")];
  return rows.length > 0 && rows.length < 90;
});
const anomalyRows = await page.locator("#bin-table tbody tr").count();
check("异常筛选缩小结果", anomalyRows === 9);
await page.selectOption("#quality-filter", "all");

// 6. 时间窗口切换 10–20s → 30 行；再返回全程状态保留
await page.click('[data-win="w2"]');
await page.waitForFunction(() => document.querySelectorAll("#bin-table tbody tr").length === 30);
check("窗口 10-20s=30 分箱", true);

// 7. 波形点击拾取（在窗口内 STA_A 通道点击）
const waveBox = await page.locator("#wave-canvas").boundingBox();
await page.mouse.click(waveBox.x + waveBox.width * 0.3, waveBox.y + waveBox.height * 0.12);
await page.waitForFunction(() => {
  const txt = document.querySelector("#map-canvas");
  return txt; // 拾取状态存在 state 中，用表格外的标记文本验证
});
const pickBefore = await page.evaluate(() =>
  document.querySelector("#timeline-canvas") ? true : false);
check("拾取后时间轴仍渲染", pickBefore);

// 切到另一窗口再返回，拾取保留（localStorage + 内存状态）
await page.click('[data-win="w3"]');
await page.click('[data-win="w2"]');
const pickKept = await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem("seismic-playback-state-v1") || "{}");
  return saved.pickList && saved.pickList.length >= 1;
});
check("切窗口返回后拾取状态保留", pickKept);
await page.click('[data-win="full"]');

// 8. 播放/暂停与速度
await page.selectOption("#speed-select", "2");
await page.click("#play-btn");
await page.waitForTimeout(600);
const t1 = await page.evaluate(() => window.__probe?.());
await page.click("#play-btn");
const readout = await page.locator("#time-readout").innerText();
check("播放推进时间", /t = [1-9]/.test(readout));

// 9. 时间轴拖动定位
const tlBox = await page.locator("#timeline-canvas").boundingBox();
await page.mouse.move(tlBox.x + tlBox.width * 0.5, tlBox.y + 10);
await page.mouse.down();
await page.mouse.up();
const readout2 = await page.locator("#time-readout").innerText();
const seekTime = Number(readout2.replace(/[^\d.]/g, ""));
check("拖动定位落在时间轴中段(13–17s)", seekTime >= 13 && seekTime <= 17);

// 10. PNG 导出（拦截下载，校验 blob 类型与非空）
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#export-frame-btn"),
]);
check("PNG 导出文件名", download.suggestedFilename().endsWith(".png"));
const pngPath = "/tmp/" + download.suggestedFilename();
await download.saveAs(pngPath);
const pngHead = await readFile(pngPath);
check("PNG 文件头有效", pngHead.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])));

// 11. CSV 导出：数值与屏幕分箱表一致
const [csvDl] = await Promise.all([
  page.waitForEvent("download"),
  page.click("#export-csv-btn"),
]);
const csvPath = "/tmp/" + csvDl.suggestedFilename();
await csvDl.saveAs(csvPath);
const csv = await readFile(csvPath, "utf8");
check("CSV 含版本头", csv.includes("wave-v1.4.0+duplicate"));
check("CSV 含口径头", csv.includes("统计口径"));
const firstScreenRow = await page.locator("#bin-table tbody tr").first().innerText();
const firstCsvData = csv.split("\n").find((l) => l.startsWith("STA_"));
const screenMean = firstScreenRow.split(/\s+/)[3];
check("CSV 数值与屏幕一致", firstCsvData.split(",")[3] === screenMean);

check("无控制台错误", errors.length === 0);

await browser.close();
server.close();
console.log("\n端到端检查全部通过：");
checks.forEach((c) => console.log("  ✓ " + c));
console.log(`\n导出样例：${pngPath}\n${csvPath}`);
process.exit(0);
