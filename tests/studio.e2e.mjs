import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.beforeEach(async ({ page }) => {
  page.on("pageerror", (error) => {
    throw new Error(`页面运行时错误：${error.message}`);
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => document.fonts.ready);
});

test("默认案例可调色、撤销、保存预设与关键帧", async ({ page }) => {
  await expect(page.locator("#safeStatusText")).toHaveText("安全区域检查通过");
  await expect(page.locator(".preset-card")).toHaveCount(6);

  const exposure = page.locator("#exposure");
  const before = await page.locator("#exposureValue").textContent();
  await exposure.focus();
  await exposure.press("ArrowRight");
  await page.locator("#contrast").focus();
  await expect(page.locator("#exposureValue")).not.toHaveText(before);
  await page.locator("#undoBtn").click();
  await expect(page.locator("#exposureValue")).toHaveText(before);
  await page.locator("#redoBtn").click();
  await expect(page.locator("#exposureValue")).not.toHaveText(before);

  await page.locator(".preset-card").filter({ hasText: "冷雾青灰" }).click();
  await expect(page.locator("#temperatureValue")).toHaveText("-27");
  await page.locator("#newPresetBtn").click();
  await page.locator("#presetName").fill("测试胶片");
  await page.locator("#confirmPresetBtn").click();
  await expect(page.locator(".preset-card").filter({ hasText: "测试胶片" })).toBeVisible();

  await page.locator("#addKeyframeBtn").click();
  await expect(page.locator(".keyframe-item")).toHaveCount(1);
  await page.locator("#templateSelect").selectOption("tidal-blue");
  await expect(page.locator("#templateSelect")).toHaveValue("tidal-blue");
  await page.locator(".keyframe-actions button").first().click();
  await expect(page.locator("#templateSelect")).toHaveValue("dune-dusk");
  await expect(page.locator("#temperatureValue")).toHaveText("-27");
});

test("保存后重新载入恢复模板、字体、图像与关键帧", async ({ page }) => {
  await page.locator("#templateSelect").selectOption("tidal-blue");
  await page.locator("#regenerateBtn").click();
  await page.getByRole("tab", { name: "图层" }).click();
  await page.locator(".layer-item").filter({ hasText: "主标题" }).click();
  await page.locator(".layer-editor select").first().selectOption("mono");
  await page.locator("#addKeyframeBtn").click();
  const seed = await page.locator("#seedValue").textContent();
  await page.locator("#saveBtn").click();
  await expect(page.locator("#saveState")).toContainText("已保存");

  await page.locator("#templateSelect").selectOption("dune-dusk");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#reloadBtn").click();
  await expect(page.locator("#templateSelect")).toHaveValue("tidal-blue");
  await expect(page.locator("#seedValue")).toHaveText(seed);
  await expect(page.locator(".keyframe-item")).toHaveCount(1);
});

test("边界案例阻止导出并给出修复建议，自动适配后可导出 SVG 与 PNG", async ({ page }) => {
  await page.locator('[data-case="boundary"]').click();
  await expect(page.locator("#safeStatusText")).toContainText("超出安全区域");
  await page.getByRole("tab", { name: "导出" }).click();
  await expect(page.locator("#exportHealth")).toHaveText("2 项待修复");

  await page.locator("#exportMainBtn").click();
  await expect(page.locator("#exportDialog")).toBeVisible();
  await expect(page.locator("#exportIssueList")).toContainText("导出尺寸过小");
  await expect(page.locator("#exportIssueList")).toContainText("长");
  await page.locator("#autoFixBtn").click();
  await expect(page.locator("#exportDialog")).toBeHidden();
  await expect(page.locator("#safeStatusText")).toHaveText("安全区域检查通过");
  await expect(page.locator("#exportWidth")).toHaveValue("1200");

  await page.locator('[data-format="svg"]').click();
  const svgDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportMainBtn").click();
  const svgDownload = await svgDownloadPromise;
  const svgBytes = await readFile(await svgDownload.path());
  const svg = svgBytes.toString("utf8");
  expect(svg).toContain('<metadata id="lumen-project">');
  expect(svg).toContain('data-editable="text"');
  expect(svg).toContain('data-editable="shape"');
  expect(svg).toContain("@font-face");
  expect(svg).toContain("data:font/woff2;base64");
  expect(svg).not.toContain("foreignObject");

  await page.locator('[data-format="png"]').click();
  const pngDownloadPromise = page.waitForEvent("download");
  await page.locator("#exportMainBtn").click();
  const pngDownload = await pngDownloadPromise;
  const png = await readFile(await pngDownload.path());
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const text = png.toString("latin1");
  expect(text).toContain("tEXt");
  expect(text).toContain("lumen-state");
  expect(png.readUInt32BE(16)).toBe(1200);
  expect(png.readUInt32BE(20)).toBe(1500);

  await page.locator("#safeGuidesBtn").click();
  await page.locator("#artCanvas").click({ position: { x: 5, y: 5 } });
  await page.waitForTimeout(500);
  const compare = async (bytes, mime) =>
    page.evaluate(
      async ({ data, mime }) => {
        const image = new Image();
        await new Promise((resolve, reject) => {
          image.onload = resolve;
          image.onerror = reject;
          image.src = `data:${mime};base64,${data}`;
        });
        const exportCanvas = document.createElement("canvas");
        exportCanvas.width = 1200;
        exportCanvas.height = 1500;
        const exportContext = exportCanvas.getContext("2d", { willReadFrequently: true });
        exportContext.drawImage(image, 0, 0, 1200, 1500);
        const exported = exportContext.getImageData(0, 0, 1200, 1500).data;
        const preview = document
          .querySelector("#artCanvas")
          .getContext("2d", { willReadFrequently: true })
          .getImageData(0, 0, 1200, 1500).data;
        let total = 0;
        let changed = 0;
        let samples = 0;
        for (let y = 0; y < 1500; y += 8) {
          for (let x = 0; x < 1200; x += 8) {
            const index = (y * 1200 + x) * 4;
            const delta = Math.max(
              Math.abs(exported[index] - preview[index]),
              Math.abs(exported[index + 1] - preview[index + 1]),
              Math.abs(exported[index + 2] - preview[index + 2]),
            );
            total += delta;
            if (delta > 2) changed += 1;
            samples += 1;
          }
        }
        return { mean: total / samples, changedRatio: changed / samples };
      },
      { data: bytes.toString("base64"), mime },
    );

  const pngComparison = await compare(png, "image/png");
  expect(pngComparison.mean).toBe(0);
  expect(pngComparison.changedRatio).toBe(0);
  const svgComparison = await compare(svgBytes, "image/svg+xml");
  expect(svgComparison.mean).toBeLessThan(0.6);
  expect(svgComparison.changedRatio).toBeLessThan(0.03);
});

test("移动、缩放与重排后持续检查安全区", async ({ page }) => {
  await page.locator("#zoomInBtn").click();
  await expect(page.locator("#zoomFitBtn")).toHaveText("110%");
  await expect(page.locator("#safeStatusText")).toHaveText("安全区域检查通过");

  const canvas = page.locator("#artCanvas");
  const box = await canvas.boundingBox();
  await canvas.click({ position: { x: box.width * 0.3, y: box.height * 0.62 } });
  await expect(page.locator("#selectionBadge")).toContainText("主标题");
  await page.getByRole("tab", { name: "图层" }).click();
  await page.locator(".layer-order-actions button").first().click();
  await expect(page.locator("#safeStatusText")).toHaveText("安全区域检查通过");

  await page.locator(".layer-editor input[data-field='x']").fill("8");
  await page.locator(".layer-editor input[data-field='y']").focus();
  await expect(page.locator("#safeStatusText")).toContainText("超出安全区域");
  await page.locator("#undoBtn").click();
  await expect(page.locator("#safeStatusText")).toHaveText("安全区域检查通过");
});
