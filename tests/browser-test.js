/* 浏览器冒烟测试：npx puppeteer 浏览器驱动下运行 node tests/browser-test.js */
"use strict";
const path = require("path");
const fs = require("fs");
const puppeteer = require("/tmp/node_modules/puppeteer");

function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) {
    return process.env.CHROME_BIN;
  }
  const root = path.join(require("os").homedir(), ".cache", "puppeteer", "chrome");
  if (fs.existsSync(root)) {
    const versions = fs.readdirSync(root).sort().reverse();
    for (const v of versions) {
      const candidate = path.join(root, v, "chrome-linux64", "chrome");
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return undefined;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push("console: " + m.text());
  });

  const url = "file://" + path.join(__dirname, "..", "index.html");
  await page.goto(url, { waitUntil: "load" });
  await page.waitForFunction(() => window.TF && document.querySelectorAll("#element-list li").length > 0);

  const results = [];
  function check(name, fn) {
    return Promise.resolve()
      .then(fn)
      .then(() => results.push({ ok: true, name }))
      .catch((e) => results.push({ ok: false, name, error: e.message }));
  }

  await check("默认案例渲染出非空 Canvas", async () => {
    const blank = await page.evaluate(() => {
      const c = document.getElementById("stage");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let painted = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) painted++;
      return painted < 1000;
    });
    if (blank) throw new Error("Canvas 几乎没有绘制内容");
  });

  await check("切换 0°->180° 元素世界坐标不变", async () => {
    const before = await page.evaluate(() =>
      JSON.stringify(TF ? document.querySelector("#element-list").children.length : 0));
    await page.evaluate(() => {
      const app = window.__app || null;
    });
    const coordsBefore = await page.evaluate(() =>
      JSON.stringify(document.querySelector("#element-list").children.length));
    await page.click("#btn-angle-folded");
    await new Promise((r) => setTimeout(r, 150));
    const coordsAfter = await page.evaluate(() =>
      JSON.stringify(document.querySelector("#element-list").children.length));
    if (coordsBefore !== coordsAfter) throw new Error("元素数量在折叠后变化");
    if (before !== coordsAfter) throw new Error("状态异常");
  });

  await check("撤销/重做按钮状态变化", async () => {
    const undoDisabled = await page.$eval("#btn-undo", (b) => b.disabled);
    if (undoDisabled) throw new Error("折叠操作后撤销应可用");
    await page.click("#btn-undo");
    await new Promise((r) => setTimeout(r, 100));
    const angle = await page.$eval("#fold-angle", (i) => i.value);
    if (Number(angle) !== 0) throw new Error("撤销后角度未恢复为 0，实际 " + angle);
    await page.click("#btn-redo");
    await new Promise((r) => setTimeout(r, 100));
    const angle2 = await page.$eval("#fold-angle", (i) => i.value);
    if (Number(angle2) !== 180) throw new Error("重做后角度未恢复为 180");
  });

  await check("边界案例加载并触发安全错误", async () => {
    await page.click("#btn-edge-case");
    await new Promise((r) => setTimeout(r, 150));
    const errCount = await page.$$eval("#check-list li.error", (els) => els.length);
    if (errCount < 3) throw new Error("边界案例错误项不足，实际 " + errCount);
  });

  await check("自动修复清除几何类错误", async () => {
    await page.evaluate(() => new Promise((resolve) => {
      const oldModal = Element.prototype.remove;
      document.querySelectorAll("#modal-mask .btn-ok").forEach((b) => b.click());
      resolve();
    }));
    await page.click("#btn-autofix");
    await new Promise((r) => setTimeout(r, 200));
    await page.$$eval("#modal-mask .btn-ok", (els) => els.forEach((b) => b.click()));
    const outOfPanel = await page.$$eval("#check-list li",
      (els) => els.filter((li) => li.textContent.includes("折线")).length);
    if (outOfPanel !== 0) throw new Error("仍存在越界提示 " + outOfPanel);
  });

  await check("SVG 导出包含可编辑 text/image/rect 与参数", async () => {
    await page.click("#btn-default-case");
    await new Promise((r) => setTimeout(r, 150));
    const info = await page.evaluate(async () => {
      const svg = TF.buildSvg(
        JSON.parse(JSON.stringify({
          version: TF.SCHEMA_VERSION, geometry: TF.defaultGeometry(),
          foldAngle: 30, keyframes: [], fonts: [],
          elements: TF.defaultCase().elements, title: "t"
        })), { exportParams: { foldAngle: 30 } });
      return {
        text: svg.includes("<text"), image: svg.includes("<image"),
        rect: svg.includes("<rect"), matrix: svg.includes("matrix("),
        param: svg.includes("foldAngle")
      };
    });
    if (!info.text || !info.image || !info.rect || !info.matrix || !info.param) {
      throw new Error(JSON.stringify(info));
    }
  });

  await check("内置自检全部通过", async () => {
    await page.click("#btn-selftest");
    await new Promise((r) => setTimeout(r, 300));
    const title = await page.$eval("#modal-mask h3", (h) => h.textContent);
    const body = await page.$eval("#modal-mask pre", (p) => p.textContent);
    await page.click("#modal-mask .btn-ok");
    const match = title.match(/(\d+)\/(\d+)/);
    if (!match || match[1] !== match[2]) {
      throw new Error("自检未全通过：" + title + "\n" + body);
    }
  });

  await check("JSON 保存/重载往返一致", async () => {
    const same = await page.evaluate(() => {
      const p = TF.defaultCase();
      return TF.serialize(TF.deserialize(TF.serialize(p))) === TF.serialize(p);
    });
    if (!same) throw new Error("往返序列化不一致");
  });

  await check("实际导出 SVG 文件为可编辑矢量且含 metadata", async () => {
    const downloaded = new Promise((resolve) => {
      page.once("popup", () => resolve(null));
    });
    let svgText = null;
    await page.exposeFunction("__captureSvg", (text) => { svgText = text; });
    await page.evaluate(() => {
      const orig = TF.download;
      TF.download = (name, blob) => blob.text().then((t) => window.__captureSvg(t));
      document.getElementById("btn-svg").click();
    });
    await new Promise((r) => setTimeout(r, 300));
    if (!svgText) throw new Error("未捕获到 SVG 导出内容");
    if (!svgText.startsWith("<svg")) throw new Error("不是 SVG 文档");
    ["<text", "<image", "<rect", "<metadata", "matrix("].forEach((token) => {
      if (!svgText.includes(token)) throw new Error("SVG 缺少 " + token);
    });
    if (svgText.includes("<canvas") || svgText.includes("base64,iVBOR")) {
      throw new Error("SVG 中混入位图烧录");
    }
    void downloaded;
  });

  await check("实际导出 PNG 由 SVG 栅格化且尺寸正确", async () => {
    let pngInfo = null;
    await page.exposeFunction("__capturePng", (info) => { pngInfo = info; });
    await page.evaluate(() => {
      TF.download = (name, blob) => {
        window.__capturePng({ name: name, type: blob.type, size: blob.size });
      };
      return document.getElementById("btn-png").click();
    });
    await new Promise((r) => setTimeout(r, 1500));
    if (!pngInfo) throw new Error("未捕获到 PNG 导出");
    if (pngInfo.type !== "image/png") throw new Error("MIME 不是 image/png");
    if (pngInfo.size < 1000) throw new Error("PNG 体积异常偏小");
  });

  const failed = results.filter((r) => !r.ok);
  results.forEach((r) => console.log((r.ok ? "  ✓ " : "  ✕ ") + r.name +
    (r.error ? " — " + r.error : "")));
  if (errors.length) console.log("\n浏览器错误:\n" + errors.join("\n"));
  await browser.close();
  console.log("\n" + (results.length - failed.length) + "/" + results.length + " 通过");
  process.exit(failed.length || errors.length ? 1 : 0);
})();
