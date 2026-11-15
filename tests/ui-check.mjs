import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

const port = 4197;
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(
  "npx",
  ["vite", "preview", "--port", String(port), "--strictPort"],
  { stdio: "ignore" },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Preview server did not start");
}

async function setSlider(page, value) {
  await page.locator("#gateSlider").evaluate((slider, nextValue) => {
    slider.value = String(nextValue);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
    slider.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  await page.waitForTimeout(120);
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.hydroApp));
  await page.waitForTimeout(250);

  const initial = await page.evaluate(() => window.hydroApp.getViewModel());
  assert.equal(initial.rows.length, 24);
  assert.equal(initial.datasetMeta.version, "QL-HYD-261116-A");
  assert.equal(await page.locator("#detailCount").textContent(), "24");
  assert.match(await page.locator("#checkStatus").textContent(), /聚合与导出一致/);

  const canvasInk = await page.evaluate(() => {
    const result = {};
    ["hydroChart", "damChart"].forEach((id) => {
      const canvas = document.getElementById(id);
      const data = canvas
        .getContext("2d")
        .getImageData(0, 0, canvas.width, canvas.height).data;
      let colored = 0;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] > 0) colored += 1;
      }
      result[id] = colored;
    });
    return result;
  });
  assert.ok(canvasInk.hydroChart > 1000);
  assert.ok(canvasInk.damChart > 1000);
  await page.screenshot({ path: "artifacts/dashboard.png", fullPage: true });

  await page.click('[data-dataset="missing"]');
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#qualityMissing").textContent(), "5");
  assert.equal(await page.locator("#qualityAnomaly").textContent(), "2");
  assert.equal(await page.locator("#qualityClean").textContent(), "48");

  await page.click('[data-dataset="duplicate"]');
  await page.waitForTimeout(100);
  assert.equal(await page.locator("#qualityDedup").textContent(), "5");
  assert.equal(await page.locator("#qualityRawTag").textContent(), "原始 53 条");
  assert.equal(await page.locator("#qualityAnomaly").textContent(), "1");

  await page.click('[data-dataset="normal"]');
  await page.waitForTimeout(100);
  await setSlider(page, 0);
  assert.match(await page.locator("#alarmText").textContent(), /警戒水位/);
  assert.match(await page.locator("#gateStatus").textContent(), /阈值预警/);
  await page.screenshot({
    path: "artifacts/dashboard-alert.png",
    fullPage: true,
  });

  await setSlider(page, 100);
  assert.match(await page.locator("#alarmText").textContent(), /下游峰值/);
  assert.match(await page.locator("#alarmText").textContent(), /超过上限/);

  await page.click('[data-window="6h"]');
  assert.equal(await page.locator("#detailCount").textContent(), "6");
  assert.equal(await page.evaluate(() => window.hydroApp.getState().gates.normal), 100);
  await page.click('[data-window="24h"]');
  assert.equal(await page.locator("#detailCount").textContent(), "24");
  assert.equal(await page.evaluate(() => window.hydroApp.getState().gates.normal), 100);

  await page.locator("[data-replay]").first().click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.hydroApp.getState().gates.normal), 100);
  assert.match(await page.locator("#alarmText").textContent(), /超过上限/);

  const downloadPromise = page.waitForEvent("download");
  await page.click("#exportBtn");
  const download = await downloadPromise;
  const csvPath = await download.path();
  const csv = await readFile(csvPath, "utf8");
  const lines = csv.split("\r\n");
  const headerIndex = lines.findIndex((line) => line.startsWith("时刻,"));
  assert.ok(headerIndex > 0);
  const dataLines = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (!lines[index]) break;
    dataLines.push(lines[index]);
  }
  assert.equal(dataLines.length, 24);
  const firstScreenRow = await page.$$eval(
    "#dataTableBody tr:first-child td",
    (cells) => cells.map((cell) => cell.textContent.trim()),
  );
  const csvLatest = dataLines.at(-1).split(",");
  for (let index = 1; index <= 6; index += 1) {
    assert.equal(csvLatest[index], firstScreenRow[index]);
  }

  await setSlider(page, 57.5);
  await page.click('[data-window="6h"]');
  await page.click('[data-window="24h"]');
  assert.equal(
    await page.evaluate(() => window.hydroApp.getState().gates.normal),
    57.5,
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.hydroApp));
  assert.equal(
    await page.evaluate(() => window.hydroApp.getState().gates.normal),
    57.5,
  );
  assert.equal(await page.evaluate(() => window.hydroApp.getState().windowKey), "24h");
  await page.click("#resetInitialBtn");
  assert.equal(
    await page.evaluate(() => window.hydroApp.getState().gates.normal),
    35.8,
  );
  assert.ok(
    (await page.locator(".history-row").count()) >= 3,
    "reset keeps replayable adjustment history",
  );
  await page.click("#audioToggle");
  assert.equal(await page.locator("#audioToggle").getAttribute("aria-pressed"), "true");
  await page.click("#audioToggle");
  assert.equal(await page.locator("#audioToggle").getAttribute("aria-pressed"), "false");

  assert.deepEqual(errors, []);
  console.log("UI check passed: filters, alerts, replay, persistence, export sync.");
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
