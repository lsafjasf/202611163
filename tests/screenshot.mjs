import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

const root = process.cwd();
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
const server = createServer(async (req, res) => {
  const path = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  try {
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream" });
    res.end(await readFile(join(root, path)));
  } catch {
    res.writeHead(404); res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({
  executablePath: "/home/hj/.cache/ms-playwright/chromium-1255/chrome-linux64/chrome",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1400, height: 1400 } });
await page.goto(`http://127.0.0.1:${server.address().port}/`);
await page.waitForSelector("#quality-table tbody tr");
await page.click('[data-dataset="missing"]');
await page.waitForFunction(() => document.querySelector("#meta-line").innerText.includes("64"));
await page.selectOption("#speed-select", "1");
await page.evaluate(() => { window.scrollTo(0, 0); });
await page.waitForTimeout(300);
await page.screenshot({ path: "/tmp/missing-overview.png", fullPage: true });
await browser.close();
server.close();
console.log("saved /tmp/missing-overview.png");
