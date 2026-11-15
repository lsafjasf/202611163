import assert from "node:assert/strict";
import fs from "node:fs/promises";
import process from "node:process";

const playwrightModule =
  process.env.PLAYWRIGHT_MODULE || "/tmp/pw/node_modules/playwright-core/index.mjs";
const executablePath =
  process.env.CHROME_PATH ||
  "/tmp/chrome-test/chrome-headless-shell-linux64/chrome-headless-shell";
const { chromium } = await import(playwrightModule);
const browser = await chromium.launch({
  executablePath,
  args: ["--no-sandbox", "--disable-gpu"],
});
const page = await browser.newPage({
  viewport: { width: 1480, height: 980 },
  acceptDownloads: true,
});
page.setDefaultTimeout(8000);
const errors = [];
const requestedUrls = [];
page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
page.on("request", (request) => requestedUrls.push(request.url()));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(`console: ${message.text()}`);
});

try {
  await page.goto("http://127.0.0.1:4327/", { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => window.fieldnote && document.querySelectorAll(".paragraph-card").length > 0,
  );
  assert.equal(errors.length, 0, errors.join("\n"));

  const initial = await page.evaluate(() => ({
    document: window.fieldnote.getDocument(),
    layout: window.fieldnote.getLayout(),
    validation: window.fieldnote.getValidation(),
    textIntegrity: (() => {
      const documentValue = window.fieldnote.getDocument();
      const layout = window.fieldnote.getLayout();
      const source = documentValue.content.text
        .trim()
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s+/g, ""))
        .filter(Boolean);
      return layout.paragraphs.every(
        (paragraph, index) =>
          paragraph.lines.map((line) => line.text.replace(/\s+/g, "")).join("") === source[index],
      );
    })(),
  }));
  console.log("initial stats", initial.layout.stats, "issues", initial.validation.issues);
  await page.screenshot({ path: "/tmp/fieldnote-default.png", fullPage: true });
  assert.equal(initial.document.caseName, "default");
  assert.equal(initial.document.shapes.filter((shape) => shape.textFlow).length, 3);
  assert.ok(initial.layout.lines.length >= 24);
  assert.ok(initial.layout.stats.placedCharacters > 500);
  assert.equal(initial.layout.overflowSegments.length, 0);
  assert.equal(initial.validation.counts.error, 0);
  assert.equal(initial.textIntegrity, true);
  assert.equal(
    requestedUrls.some((url) => /\.(woff2?|ttf|otf)(\?|$)/i.test(url)),
    false,
  );

  const imageCountBefore = await page.evaluate(
    () => window.fieldnote.getDocument().shapes.filter((shape) => shape.type === "image").length,
  );
  await page.locator("#add-image-file").setInputFiles({
    name: "pixel.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await page.waitForTimeout(150);
  const imageAdded = await page.evaluate(() => {
    const shapes = window.fieldnote.getDocument().shapes.filter((shape) => shape.type === "image");
    return { count: shapes.length, embedded: shapes.at(-1).src.startsWith("data:image/png") };
  });
  assert.equal(imageAdded.count, imageCountBefore + 1);
  assert.equal(imageAdded.embedded, true);
  await page.locator("#undo-btn").click();

  await page.locator("#tab-object").click();
  await page.locator('[data-flow-shape="flow-middle"]').click();
  await page.locator("#shape-x").fill("120");
  await page.locator("#shape-x").press("Tab");
  await page.waitForTimeout(150);
  const overlapIssues = await page.evaluate(() =>
    window.fieldnote.getValidation().issues.map((item) => item.type),
  );
  assert.ok(overlapIssues.includes("shape-overlap"));
  assert.ok(overlapIssues.includes("text-overlap"));
  await page.locator("#undo-btn").click();
  assert.equal(
    await page.evaluate(
      () => window.fieldnote.getDocument().shapes.find((shape) => shape.id === "flow-middle").x,
    ),
    440,
  );

  const artificialWidow = await page.evaluate(async () => {
    const { validateLayout } = await import("/js/validation.js");
    const documentValue = window.fieldnote.getDocument();
    const layout = JSON.parse(JSON.stringify(window.fieldnote.getLayout()));
    layout.paragraphs = [
      {
        index: 0,
        text: "足够长的段落文字与孤字",
        pinned: false,
        lines: [
          { text: "足够长的段落文字", width: 100, x: 90, top: 220, height: 16, frameId: "flow-left" },
          { text: "孤", width: 16, x: 90, top: 247, height: 16, frameId: "flow-left" },
        ],
        frameIds: ["flow-left"],
        bounds: { x: 90, y: 220, w: 100, h: 43 },
      },
    ];
    layout.lines = layout.paragraphs[0].lines;
    return validateLayout(documentValue, layout).issues.some((item) => item.type === "widow");
  });
  assert.equal(artificialWidow, true);

  await page.locator("#tab-text").click();
  await page.locator('[data-pin-paragraph="0"]').click();
  const pinnedBefore = await page.evaluate(() => {
    const document = window.fieldnote.getDocument();
    const paragraph = window.fieldnote.getLayout().paragraphs[0];
    return {
      pinCount: document.pinned.length,
      x: paragraph.lines[0].x,
      y: paragraph.lines[0].top,
      middleX: document.shapes.find((shape) => shape.id === "flow-middle").x,
    };
  });
  assert.equal(pinnedBefore.pinCount, 1);

  await page.locator("#tab-object").click();
  await page.locator('[data-flow-shape="flow-middle"]').click();
  await page.locator("#shape-x").fill(String(pinnedBefore.middleX + 18));
  await page.locator("#shape-x").press("Tab");
  await page.waitForTimeout(150);
  const pinnedAfter = await page.evaluate(() => {
    const paragraph = window.fieldnote.getLayout().paragraphs[0];
    return {
      x: paragraph.lines[0].x,
      y: paragraph.lines[0].top,
      middleX: window.fieldnote.getDocument().shapes.find((shape) => shape.id === "flow-middle").x,
    };
  });
  assert.equal(pinnedAfter.middleX, pinnedBefore.middleX + 18);
  assert.equal(pinnedAfter.x, pinnedBefore.x);
  assert.equal(pinnedAfter.y, pinnedBefore.y);

  await page.locator("#undo-btn").click();
  assert.equal(
    await page.evaluate(
      () => window.fieldnote.getDocument().shapes.find((shape) => shape.id === "flow-middle").x,
    ),
    pinnedBefore.middleX,
  );
  await page.locator("#redo-btn").click();
  assert.equal(
    await page.evaluate(
      () => window.fieldnote.getDocument().shapes.find((shape) => shape.id === "flow-middle").x,
    ),
    pinnedBefore.middleX + 18,
  );

  await page.locator("#save-btn").click();
  await page.locator("#doc-name").fill("临时改名");
  await page.locator("#reload-btn").click();
  await page.waitForTimeout(100);
  assert.equal(
    await page.evaluate(() => window.fieldnote.getDocument().name),
    "在水线与街角之间",
  );

  await page.locator("#tab-check").click();
  await page.selectOption("#font-weight", "600");
  const templateImageSrc = await page.evaluate(
    () => window.fieldnote.getDocument().shapes.find((shape) => shape.type === "image").src,
  );
  await page.locator("#library-btn").click();
  await page.locator("#save-template-btn").click();
  assert.ok((await page.locator("#template-list .archive-item").count()) >= 1);
  await page.locator("#library-dialog .modal-actions button[value=cancel]").click();
  await page.locator("#tab-check").click();
  await page.selectOption("#font-weight", "400");
  await page.locator("#tab-text").click();
  await page.locator("#title-input").fill("临时标题");
  await page.locator("#library-btn").click();
  await page.locator("#template-list .archive-item").first().locator("button").first().click();
  await page.waitForTimeout(100);
  const restoredTemplate = await page.evaluate(() => {
    const documentValue = window.fieldnote.getDocument();
    return {
      title: documentValue.content.title,
      weight: documentValue.font.weight,
      imageSrc: documentValue.shapes.find((shape) => shape.type === "image").src,
    };
  });
  assert.equal(restoredTemplate.title, "在水线与街角之间");
  assert.equal(restoredTemplate.weight, 600);
  assert.equal(restoredTemplate.imageSrc, templateImageSrc);

  await page.locator("#library-btn").click();
  await page.locator("#save-keyframe-btn").click();
  assert.ok((await page.locator("#keyframe-list .archive-item").count()) >= 1);
  await page.locator("#library-dialog .modal-actions button[value=cancel]").click();
  await page.locator("#zoom-in-btn").click();
  const zoomedWidth = await page.locator("#editor-canvas").evaluate((node) => node.style.width);
  await page.locator("#library-btn").click();
  await page.locator("#keyframe-list .archive-item").first().locator("button").first().click();
  await page.waitForTimeout(100);
  assert.notEqual(await page.locator("#editor-canvas").evaluate((node) => node.style.width), zoomedWidth);

  await page.locator("#export-svg-btn").click();
  assert.equal(await page.locator("#export-confirm-btn").isDisabled(), false);
  const svgProbe = await page.evaluate(() => window.fieldnote.exportSvg());
  assert.match(svgProbe, /<tspan/);
  let svgDownload;
  try {
    [svgDownload] = await Promise.all([
      page.waitForEvent("download"),
      page.locator("#export-confirm-btn").click(),
    ]);
  } catch (error) {
    console.log("toast", await page.locator("#toast-region").innerText());
    console.log("dialog", await page.locator("#export-dialog").evaluate((node) => node.open));
    console.log("errors", errors);
    throw error;
  }
  const svgPath = await svgDownload.path();
  const svg = await fs.readFile(svgPath, "utf8");
  await svgDownload.saveAs("/tmp/fieldnote-export.svg");
  assert.match(svg, /<svg[^>]+viewBox=/);
  assert.match(svg, /<g id="text-flow" data-editable="text">/);
  assert.match(svg, /<text[^>]+font-family=/);
  assert.match(svg, /<tspan[^>]+data-line-id=/);
  assert.match(svg, /<metadata id="fieldnote-project">/);
  assert.ok((svg.match(/<tspan/g) || []).length > 30);
  assert.ok(!/<foreignObject/.test(svg));
  const metadataText = svg.match(/<metadata id="fieldnote-project">([^<]+)<\/metadata>/)?.[1];
  const metadata = JSON.parse(Buffer.from(metadataText, "base64").toString("utf8"));
  assert.equal(metadata.viewport.safeMargin, 46);
  assert.equal(metadata.document.font.size, 16);
  assert.ok(metadata.document.shapes.some((shape) => shape.type === "image" && shape.src.startsWith("data:image/")));

  await page.locator("#export-png-btn").click();
  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#export-confirm-btn").click(),
  ]);
  const pngPath = await pngDownload.path();
  const png = await fs.readFile(pngPath);
  await pngDownload.saveAs("/tmp/fieldnote-export.png");
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.includes(Buffer.from("iTXt")));
  assert.ok(png.includes(Buffer.from("Fieldnote")));

  await page.selectOption("#case-select", "boundary");
  await page.waitForTimeout(150);
  const boundary = await page.evaluate(() => ({
    layout: window.fieldnote.getLayout(),
    validation: window.fieldnote.getValidation(),
  }));
  assert.ok(boundary.layout.overflowSegments.length > 0);
  assert.ok(boundary.layout.stats.overflowCharacters > 0);
  assert.ok(boundary.validation.counts.error > 0);
  assert.ok(
    boundary.validation.issues.some((item) => item.type === "text-overflow"),
  );
  assert.ok(boundary.validation.issues.some((item) => item.type === "safe-area"));
  await page.screenshot({ path: "/tmp/fieldnote-boundary.png", fullPage: true });

  await page.locator("#tab-check").click();
  await page.locator("#canvas-w").fill("240");
  await page.locator("#canvas-w").press("Tab");
  await page.locator("#canvas-h").fill("180");
  await page.locator("#canvas-h").press("Tab");
  await page.waitForTimeout(150);
  const extremelySmall = await page.evaluate(() => ({
    width: window.fieldnote.getDocument().canvas.width,
    height: window.fieldnote.getDocument().canvas.height,
    types: window.fieldnote.getValidation().issues.map((item) => item.type),
  }));
  assert.equal(extremelySmall.width, 240);
  assert.equal(extremelySmall.height, 180);
  assert.ok(extremelySmall.types.includes("tiny-canvas"));
  assert.ok(extremelySmall.types.includes("text-overflow"));

  await page.locator("#export-svg-btn").click();
  assert.equal(await page.locator("#export-confirm-btn").isDisabled(), true);
  assert.match(await page.locator("#export-dialog-body").innerText(), /修复|绕排框|安全/);
  await page.locator("#export-cancel-btn").click();

  await page.locator("#tab-check").click();
  await page.locator("#auto-repair-btn").click();
  await page.waitForTimeout(250);
  const repaired = await page.evaluate(() => ({
    layout: window.fieldnote.getLayout(),
    validation: window.fieldnote.getValidation(),
    textIntegrity: (() => {
      const documentValue = window.fieldnote.getDocument();
      const layout = window.fieldnote.getLayout();
      const source = documentValue.content.text
        .trim()
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.replace(/\s+/g, ""))
        .filter(Boolean);
      return layout.paragraphs.every(
        (paragraph, index) =>
          paragraph.lines.map((line) => line.text.replace(/\s+/g, "")).join("") === source[index],
      );
    })(),
  }));
  console.log("repaired", repaired.layout.stats, repaired.validation.issues);
  assert.equal(repaired.layout.overflowSegments.length, 0);
  assert.equal(repaired.validation.counts.error, 0);
  assert.ok(repaired.layout.stats.overflowCharacters === 0);
  assert.equal(repaired.textIntegrity, true);
  assert.ok(
    await page.evaluate(() => window.fieldnote.getDocument().canvas.width >= 360),
  );

  await page.locator("#zoom-in-btn").click();
  assert.equal(
    await page.evaluate(() => window.fieldnote.getValidation().counts.error),
    0,
  );
  await page.screenshot({ path: "/tmp/fieldnote-repaired.png", fullPage: true });

  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("browser smoke: OK");
} finally {
  await browser.close();
}
