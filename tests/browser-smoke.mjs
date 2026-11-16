import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const port = 47000 + Math.floor(Math.random() * 1000);
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["server.mjs"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"]
});

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(origin);
      if (response.ok) return;
    } catch {
      // The server may still be binding its port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Local test server did not start");
}

async function setRange(page, selector, value) {
  await page.locator(selector).evaluate((element, nextValue) => {
    element.value = String(nextValue);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function exportFile(page, type) {
  await page.locator("#exportButton").click();
  await page.waitForTimeout(250);
  const button = type === "svg" ? "#exportSvgButton" : "#exportPngButton";
  if (await page.locator(button).isDisabled()) {
    throw new Error(`${type.toUpperCase()} export unexpectedly blocked`);
  }
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(button).click()
  ]);
  return readFileSync(await download.path());
}

let browser;
try {
  await waitForServer();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  assert.equal(await page.locator("#safetyLabel").textContent(), "安全区通过");
  assert.match(await page.locator("#cellCount").textContent(), /^1\d\d 枚色片/);

  await page.locator("#safeAreaButton").click();
  const previewData = await page.locator("#previewCanvas").evaluate((canvas) =>
    canvas.toDataURL("image/png")
  );
  const svgBytes = await exportFile(page, "svg");
  const svg = svgBytes.toString("utf8");
  assert.match(svg, /class="glass-cell"/);
  assert.match(svg, /class="editable-text/);
  assert.match(svg, /<metadata id="aurelia-project"/);
  assert.doesNotMatch(svg, /<canvas/);
  assert.match(svg, /晨光玫瑰/);

  const svgBase64 = svgBytes.toString("base64");
  const pixelDiff = await page.evaluate(async ({ previewData, svgBase64 }) => {
    const load = (source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = source;
    });
    const [preview, exported] = await Promise.all([
      load(previewData),
      load(`data:image/svg+xml;base64,${svgBase64}`)
    ]);
    const width = 900;
    const height = 1120;
    const first = new OffscreenCanvas(width, height);
    const second = new OffscreenCanvas(width, height);
    const firstContext = first.getContext("2d");
    const secondContext = second.getContext("2d");
    firstContext.drawImage(preview, 0, 0, width, height);
    secondContext.drawImage(exported, 0, 0, width, height);
    const firstPixels = firstContext.getImageData(0, 0, width, height).data;
    const secondPixels = secondContext.getImageData(0, 0, width, height).data;
    let total = 0;
    let highDifference = 0;
    for (let index = 0; index < firstPixels.length; index += 4) {
      const difference = (
        Math.abs(firstPixels[index] - secondPixels[index]) +
        Math.abs(firstPixels[index + 1] - secondPixels[index + 1]) +
        Math.abs(firstPixels[index + 2] - secondPixels[index + 2])
      ) / 3;
      total += difference;
      if (difference > 30) highDifference += 1;
    }
    return {
      mean: total / (width * height),
      highFraction: highDifference / (width * height)
    };
  }, { previewData, svgBase64 });
  assert.ok(pixelDiff.mean < 8, `preview/export mean diff ${pixelDiff.mean}`);
  assert.ok(pixelDiff.highFraction < 0.03, "preview/export has too many high-difference pixels");

  await page.waitForTimeout(250);
  const png = await exportFile(page, "png");
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.includes(Buffer.from("iTXt")));
  assert.ok(png.includes(Buffer.from("aurelia:project")));

  await page.locator('[data-shape="star"]').click();
  assert.match(await page.locator('[data-shape="star"]').getAttribute("class"), /selected/);
  await page.locator("#undoButton").click();
  assert.match(await page.locator('[data-shape="rose"]').getAttribute("class"), /selected/);
  await page.locator("#redoButton").click();
  assert.match(await page.locator('[data-shape="star"]').getAttribute("class"), /selected/);
  await setRange(page, "#textYInput", 500);
  assert.equal(await page.locator("#safetyLabel").textContent(), "需修复");
  await setRange(page, "#textYInput", 0);
  assert.equal(await page.locator("#safetyLabel").textContent(), "安全区通过");

  await page.locator("#fontFileInput").setInputFiles("assets/fonts/noto-sans-sc-400.woff2");
  await page.waitForFunction(
    () => document.querySelector("#customFontNote").textContent.includes("已嵌入"),
    null,
    { timeout: 15000 }
  );
  const imageBuffer = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lM2nWQAAAABJRU5ErkJggg==",
    "base64"
  );
  await page.locator("#imageFileInput").setInputFiles({
    name: "smoke.png",
    mimeType: "image/png",
    buffer: imageBuffer
  });
  await page.waitForFunction(
    () => document.querySelector("#imageName").textContent.includes("smoke.png"),
    null,
    { timeout: 10000 }
  );
  await setRange(page, "#lightXInput", 0.88);
  await page.locator("#recordFrameButton").click();
  await page.locator("#projectName").fill("浏览器验收");
  await page.locator("#projectName").blur();
  await page.locator("#saveButton").click();
  await page.waitForTimeout(500);
  const record = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("aurelia.studio.projects.v1"))[0]
  );
  assert.equal(record.name, "浏览器验收");
  assert.equal(record.state.typography.customFont.name, "noto-sans-sc-400");
  assert.equal(record.state.image.name, "smoke.png");
  assert.equal(record.state.light.keyframes[0].x, 0.88);

  await page.locator('[data-preset="narrow-choir"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#safetyLabel").textContent(), "安全区通过");
  assert.equal(await page.locator("#canvasDims").textContent(), "360 × 720");
  const frameBox = await page.locator("#canvasFrame").boundingBox();
  assert.ok(Math.abs(frameBox.width / frameBox.height - 0.5) < 0.02);

  await page.locator("#libraryButton").click();
  await page.waitForTimeout(200);
  await page.locator("[data-load-project]").first().click();
  await page.waitForTimeout(900);
  assert.equal(await page.locator("#fontSelect").inputValue(), "custom");
  assert.match(await page.locator("#imageName").textContent(), /smoke\.png/);
  assert.match(await page.locator("#keyframeList").innerText(), /X 88/);

  await page.locator('[data-preset="overflow-check"]').click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#safetyLabel").textContent(), "需修复");
  await page.locator("#exportButton").click();
  await page.waitForTimeout(250);
  assert.equal(await page.locator("#exportSvgButton").isDisabled(), true);
  assert.match(await page.locator("#exportGate").innerText(), /修复：/);
  await page.locator('[data-close-overlay="exportOverlay"]').click();

  assert.deepEqual(errors, []);
  console.log("Browser smoke passed", {
    previewExportMeanDifference: Number(pixelDiff.mean.toFixed(2)),
    svgBytes: svgBytes.length,
    pngBytes: png.length
  });
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
