import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const filename = path.resolve(root, `.${relative}`);
    if (!filename.startsWith(root)) throw new Error("Forbidden");
    const body = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": mime[path.extname(filename)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.documentElement.dataset.sealReady === "true",
    null,
    { timeout: 60000 }
  );

  const initial = await page.evaluate(() => ({
    name: window.sealApp.model.meta.name,
    size: window.sealApp.model.document.size,
    elements: window.sealApp.model.elements.length,
    errors: window.sealApp.validateCurrent().filter((item) => item.level === "error").length
  }));
  assert.equal(initial.size, 720);
  assert.equal(initial.elements, 8);
  assert.equal(initial.errors, 0);

  const quality = await page.evaluate(() => window.sealApp.runQualityCheck());
  assert.equal(quality.filter((item) => item.pass).length, quality.length);

  const moved = await page.evaluate(async () => {
    await window.sealApp.moveElement("date-text", 900, 900);
    const date = window.sealApp.model.elements.find((element) => element.id === "date-text");
    return {
      x: date.transform.x,
      y: date.transform.y,
      errors: window.sealApp.validateCurrent().filter((item) => item.level === "error").length
    };
  });
  assert.ok(moved.x < 300 && moved.y < 300);
  assert.equal(moved.errors, 0);
  await page.evaluate(() => window.sealApp.undo());
  assert.equal(
    await page.evaluate(() => window.sealApp.model.elements.find((element) => element.id === "date-text").transform.x),
    0
  );

  await page.evaluate(() => window.sealApp.loadBoundary());
  const boundary = await page.evaluate(() => ({
    size: window.sealApp.model.document.size,
    errors: window.sealApp.validateCurrent().filter((item) => item.level === "error").length,
    codes: window.sealApp.validateCurrent().map((item) => item.code)
  }));
  assert.equal(boundary.size, 240);
  assert.ok(boundary.errors > 0);
  assert.ok(boundary.codes.includes("ARC_OVERFLOW"));

  await page.evaluate(() => window.sealApp.autoRepair());
  await page.waitForTimeout(300);
  const repaired = await page.evaluate(() => ({
    size: window.sealApp.model.document.size,
    errors: window.sealApp.validateCurrent().filter((item) => item.level === "error").length
  }));
  assert.equal(repaired.size, 720);
  assert.equal(repaired.errors, 0);

  const exported = await page.evaluate(async () => {
    const png = await window.sealApp.getPngBlob(1);
    const bitmap = await createImageBitmap(png);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    const corner = [...context.getImageData(0, 0, 1, 1).data];
    const svg = await window.sealApp.getSvgText({ embedFonts: false });
    return {
      pngWidth: bitmap.width,
      pngAlpha: corner[3],
      svgEditable: svg.includes("<text") && svg.includes('id="stamp-model"')
    };
  });
  assert.equal(exported.pngWidth, 720);
  assert.equal(exported.pngAlpha, 0);
  assert.ok(exported.svgEditable);
  assert.deepEqual(consoleErrors, []);
  console.log(`browser checks passed: ${quality.length} quality tests, PNG ${exported.pngWidth}px, editable SVG`);
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
