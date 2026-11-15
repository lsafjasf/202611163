import { getFontString, getMeasurementContext, shapeBounds } from "./layout.js";

function issue(severity, type, title, detail, fix, extra = {}) {
  return { id: `${type}-${extra.shapeId || extra.paragraphIndex || "doc"}`, severity, type, title, detail, fix, ...extra };
}

function intersects(a, b) {
  return (
    a.x < b.x + b.w - 0.5 &&
    a.x + a.w > b.x + 0.5 &&
    a.y < b.y + b.h - 0.5 &&
    a.y + a.h > b.y + 0.5
  );
}

function safeRect(doc) {
  return {
    x: doc.canvas.margin,
    y: doc.canvas.margin,
    w: doc.canvas.width - doc.canvas.margin * 2,
    h: doc.canvas.height - doc.canvas.margin * 2,
  };
}

function outside(rect, container, tolerance = 0.5) {
  return (
    rect.x < container.x - tolerance ||
    rect.y < container.y - tolerance ||
    rect.x + rect.w > container.x + container.w + tolerance ||
    rect.y + rect.h > container.y + container.h + tolerance
  );
}

function textWidth(doc, text, size, weight = doc.font.weight) {
  if (!text) return 0;
  const ctx = getMeasurementContext();
  ctx.save();
  ctx.font = `${weight} ${size}px ${doc.font.family}`;
  const width = ctx.measureText(text).width;
  ctx.restore();
  return width;
}

function headerIssues(doc) {
  const results = [];
  const safe = safeRect(doc);
  const headerItems = [
    ["眉题", doc.content.kicker, doc.header.kickerSize, 700],
    ["标题", doc.content.title, doc.header.titleSize, 400],
    ["副题", doc.content.subtitle, doc.header.subtitleSize, 400],
    ["页脚", doc.content.footer, doc.header.footerSize || 9, 400],
  ];
  for (const [label, text, size, weight] of headerItems) {
    const width = textWidth(doc, text, size, weight);
    if (width > safe.w + 0.5) {
      results.push(
        issue(
          "error",
          "header-clipped",
          `${label}超出安全区`,
          `“${label}”需要 ${Math.ceil(width)}px，但安全宽度只有 ${Math.round(safe.w)}px。`,
          `缩短${label}、减小字号，或扩大画布与安全边距。`,
        ),
      );
    }
  }
  return results;
}

function collectShapeIssues(doc) {
  const results = [];
  const safe = safeRect(doc);
  if (safe.w <= 0 || safe.h <= 0) {
    results.push(
      issue(
        "error",
        "invalid-margin",
        "安全边距大于画布",
        "当前安全边距没有留下可排版的内部区域。",
        "减小安全边距，或增加画布宽高。",
      ),
    );
    return results;
  }

  for (const shape of doc.shapes) {
    const bounds = shapeBounds(shape);
    if (outside(bounds, safe)) {
      results.push(
        issue(
          "error",
          "safe-area",
          `“${shape.name}”越过安全边距`,
          `对象位于 (${Math.round(bounds.x)}, ${Math.round(bounds.y)})，尺寸 ${Math.round(bounds.w)}×${Math.round(bounds.h)}；安全区为 ${Math.round(safe.w)}×${Math.round(safe.h)}。`,
          "将对象移回带安全线的中心区域，或在检查面板调整画布与边距。",
          { shapeId: shape.id },
        ),
      );
    }
    if (shape.type === "image" && !shape.src) {
      results.push(
        issue(
          "error",
          "missing-image",
          `“${shape.name}”没有可恢复的图片数据`,
          "图片地址为空或不是内嵌数据，重新载入后可能无法显示。",
          "在对象面板重新选择图片；图片会以 data URL 保存。",
          { shapeId: shape.id },
        ),
      );
    }
    if ((shape.textFlow || shape.type === "image") && (shape.w < 8 || shape.h < 8)) {
      results.push(
        issue(
          "error",
          "tiny-shape",
          `“${shape.name}”尺寸过小`,
          "图形宽或高小于 8px，文字与描边无法稳定显示。",
          "在对象面板增大宽度和高度，或删除该对象。",
          { shapeId: shape.id },
        ),
      );
    }
  }

  for (let i = 0; i < doc.shapes.length; i += 1) {
    const a = doc.shapes[i];
    for (let j = i + 1; j < doc.shapes.length; j += 1) {
      const b = doc.shapes[j];
      if (!intersects(shapeBounds(a), shapeBounds(b))) continue;
      if ((a.textFlow && b.textFlow) || (!a.textFlow && !b.textFlow && !a.type.includes("line"))) {
        results.push(
          issue(
            "warning",
            "shape-overlap",
            "图形重叠",
            `“${a.name}”与“${b.name}”的边界相交。文字绕排可以处理图片压在框内，但两个绕排框重叠会让阅读顺序不确定。`,
            "移动其中一个图形，或在绕排顺序中明确先后；图片绕排属于允许的覆盖，可忽略此类提示。",
            { shapeId: a.id },
          ),
        );
      }
    }
  }
  return results;
}

function collectOverflowIssues(layout) {
  if (!layout.overflowSegments.length) return [];
  const total = layout.overflowSegments.reduce((sum, segment) => sum + segment.chars, 0);
  const reasons = [...new Set(layout.overflowSegments.map((segment) => segment.reason))].join("；");
  return [
    issue(
      "error",
      "text-overflow",
      "正文未能全部排入",
      `${total} 个字符没有落点。原因：${reasons}。内容仍保留在文档中，但不会被导出，因此导出已锁定。`,
      "增加绕排框、扩大已有图形、减小字号或增加画布尺寸，然后点击“重新绕排”；也可使用“自动修复”。",
    ),
  ];
}

function collectLineIssues(doc, layout) {
  const results = [];
  const frameMap = new Map(layout.frames.map((frame) => [frame.id, frame]));
  const clipped = [];
  for (const line of layout.lines) {
    const frame = frameMap.get(line.frameId);
    if (!frame) {
      clipped.push(line);
      continue;
    }
    const frameBox = {
      x: frame.x + frame.padding,
      y: frame.y + frame.padding,
      w: frame.w - frame.padding * 2,
      h: frame.h - frame.padding * 2,
    };
    const lineBox = { x: line.x, y: line.top, w: line.width, h: line.height };
    if (outside(lineBox, frameBox, 0.5)) clipped.push(line);
  }
  if (clipped.length) {
    results.push(
      issue(
        "error",
        "text-clipped",
        "文字越过图形边界",
        `${clipped.length} 行文字超出所属绕排框，导出的 SVG 可能会被裁切。首行示例：“${clipped[0].text.slice(0, 20)}”。`,
        "扩大对应图形、减小内边距或字号，再重新绕排。",
        { paragraphIndex: clipped[0].paragraphIndex },
      ),
    );
  }

  const overlaps = [];
  for (let i = 0; i < layout.lines.length; i += 1) {
    const a = layout.lines[i];
    const boxA = { x: a.x, y: a.top, w: a.width, h: a.height };
    for (let j = i + 1; j < layout.lines.length; j += 1) {
      const b = layout.lines[j];
      if (intersects(boxA, { x: b.x, y: b.top, w: b.width, h: b.height })) {
        overlaps.push([a, b]);
        break;
      }
    }
  }
  for (const line of layout.lines) {
    const lineBox = { x: line.x, y: line.top, w: line.width, h: line.height };
    for (const shape of doc.shapes) {
      if (shape.textFlow || shape.type !== "image") continue;
      if (intersects(lineBox, shapeBounds(shape))) {
        overlaps.push([line, { text: shape.name, pinned: false }]);
        break;
      }
    }
  }
  if (overlaps.length) {
    results.push(
      issue(
        "error",
        "text-overlap",
        "文字发生重叠",
        `${overlaps.length} 处文字与另一行文字或图片相交。固定段落被移动后最常出现此类问题。`,
        "移动重叠对象、解除对应段落的固定，或点击“重新绕排”让周围内容避开。",
        { paragraphIndex: overlaps[0][0].paragraphIndex },
      ),
    );
  }
  return results;
}

function collectParagraphIssues(layout) {
  const results = [];
  const widows = [];
  const orphans = [];
  for (const paragraph of layout.paragraphs) {
    if (paragraph.lines.length < 2) continue;
    const first = paragraph.lines[0].text.trim();
    const last = paragraph.lines[paragraph.lines.length - 1].text.trim();
    if (Array.from(last).length <= 2) widows.push(paragraph.index + 1);
    if (Array.from(first).length <= 2) orphans.push(paragraph.index + 1);
  }
  if (widows.length) {
    results.push(
      issue(
        "warning",
        "widow",
        "检测到孤字或寡行",
        `第 ${widows.join("、")} 段的末行只剩 1–2 个字符。`,
        "微调图形宽度、字号或段落文字，让末行至少保留一个短词组。",
        { paragraphIndex: widows[0] - 1 },
      ),
    );
  }
  if (orphans.length) {
    results.push(
      issue(
        "warning",
        "orphan",
        "检测到过短的段首行",
        `第 ${orphans.join("、")} 段的首行只有 1–2 个字符。`,
        "检查首行缩进与图形左侧内边距，或调整图形宽度。",
        { paragraphIndex: orphans[0] - 1 },
      ),
    );
  }
  return results;
}

function collectTypographyIssues(doc, layout) {
  const results = [];
  if (doc.font.size < 9) {
    results.push(
      issue(
        "warning",
        "tiny-type",
        "字号偏小",
        `当前正文仅 ${doc.font.size}px，打印或小屏查看时可能难以辨认。`,
        "将字号提高到至少 9px；若为了塞入内容，请改为增加图形或画布。",
      ),
    );
  }
  if (doc.canvas.width < 360 || doc.canvas.height < 260) {
    results.push(
      issue(
        "warning",
        "tiny-canvas",
        "画布处于极小尺寸",
        `画布为 ${doc.canvas.width}×${doc.canvas.height}px，安全边距和文字可用空间非常有限。`,
        "将画布扩大到至少 360×260px，或减小字号与边距。",
      ),
    );
  }
  if (!layout.frames.length && doc.content.text.trim()) {
    results.push(
      issue(
        "error",
        "no-flow-frame",
        "没有文字绕排框",
        "文档有正文，但所有图形都未启用“文字绕排框”。",
        "选择一个图形，将绕排方式改为“文字绕排框”。",
      ),
    );
  }
  return results;
}

export function validateLayout(doc, layout) {
  const issues = [
    ...collectShapeIssues(doc),
    ...headerIssues(doc),
    ...collectOverflowIssues(layout),
    ...collectLineIssues(doc, layout),
    ...collectParagraphIssues(layout),
    ...collectTypographyIssues(doc, layout),
  ];
  const unique = [];
  const seen = new Set();
  for (const item of issues) {
    const key = `${item.severity}:${item.type}:${item.shapeId || ""}:${item.paragraphIndex ?? ""}:${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  const counts = {
    error: unique.filter((item) => item.severity === "error").length,
    warning: unique.filter((item) => item.severity === "warning").length,
    info: unique.filter((item) => item.severity === "info").length,
  };
  return {
    issues: unique,
    counts,
    ok: counts.error === 0,
    summary:
      counts.error > 0
        ? `${counts.error} 个问题会阻止导出`
        : counts.warning > 0
          ? `可导出，但有 ${counts.warning} 项提醒`
          : "所有文字与对象均通过检查",
  };
}
