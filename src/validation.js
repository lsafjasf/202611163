import { cloneModel } from "./model.js";
import { buildScene, glyphBounds } from "./scene.js";
import { normalizeAngle, shortestAngleDelta } from "./util.js";

const TEXT_TYPES = new Set(["text", "arcText"]);

function issue(level, code, title, message, fix, elementId = null) {
  return { level, code, title, message, fix, elementId };
}

function pointAngle(point, center) {
  return normalizeAngle(Math.atan2(point.y - center.y, point.x - center.x));
}

function pointRadius(point, center) {
  return Math.hypot(point.x - center.x, point.y - center.y);
}

function glyphHitsWedge(glyph, wedge, center) {
  const corners = glyphBounds(glyph);
  const samples = [
    ...corners,
    { x: glyph.x, y: glyph.y },
    ...corners.map((corner, index) => {
      const next = corners[(index + 1) % corners.length];
      return { x: (corner.x + next.x) / 2, y: (corner.y + next.y) / 2 };
    })
  ];
  for (const point of samples) {
    const radius = pointRadius(point, center);
    const angularDistance = Math.abs(shortestAngleDelta(pointAngle(point, center), wedge.angle));
    if (
      radius >= wedge.innerRadius - 0.5
      && radius <= wedge.outerRadius + 0.5
      && angularDistance <= wedge.halfAngle + 0.018
    ) {
      return true;
    }
  }
  return false;
}

function isDateGroup(group) {
  return group.type === "text"
    && (group.element.name?.includes("日期") || group.id.includes("date"));
}

export function validateScene(scene) {
  const issues = [];
  const model = scene.model;
  const size = scene.width;
  const margin = model.document.safeMargin;
  const clipRadius = size / 2;
  const safeRadius = Math.max(0, clipRadius - margin);
  const groups = scene.groups;

  if (size < 320) {
    issues.push(issue(
      "error",
      "SMALL_DOCUMENT",
      "画布尺寸过小",
      `当前为 ${size}px，日期与细线在导出后会难以辨认。`,
      "将画布尺寸提高到 512px 或 720px；提高尺寸时设计会按比例同步缩放。"
    ));
  } else if (size < 512) {
    issues.push(issue(
      "warning",
      "COMPACT_DOCUMENT",
      "画布偏小",
      `当前为 ${size}px，建议至少在 512px 下导出以保证小字清晰。`,
      "将画布尺寸提高到 512px 或更高。"
    ));
  }

  if (margin < 18) {
    issues.push(issue(
      "warning",
      "TIGHT_MARGIN",
      "安全边距偏紧",
      `当前安全边距为 ${margin}px，接近裁切风险区。`,
      "将安全边距调到至少 24px。"
    ));
  }

  if (groups.length === 0) {
    issues.push(issue(
      "error",
      "EMPTY_CANVAS",
      "没有可见元素",
      "当前画布为空，导出文件不会包含有效图章。",
      "在图层列表中开启至少一个图层，或载入默认模板。"
    ));
  }

  const textGroups = groups.filter((group) => TEXT_TYPES.has(group.type));
  const gapIssues = new Set();
  for (const group of textGroups) {
    const glyphs = group.glyphs || [];
    for (const glyph of glyphs) {
      for (const corner of glyphBounds(glyph)) {
        const radius = pointRadius(corner, scene.center);
        if (radius > clipRadius + 0.01) {
          issues.push(issue(
            "error",
            "TEXT_CLIPPED",
            "文字会被画布裁切",
            `“${group.name}”中的“${glyph.char}”超出画布。`,
            "减小字号或字距，向内移动该图层；也可增大画布尺寸。",
            group.id
          ));
        }
      }
    }
    if (group.glyphs?.length === 0 && group.element.text?.trim()) {
      issues.push(issue(
        "error",
        "TEXT_NOT_LAID_OUT",
        "文字未完成排版",
        `“${group.name}”没有生成可见字形。`,
        "检查字体是否加载完成，或重新选择字体后再试。",
        group.id
      ));
    }
  }

  for (const group of groups) {
    if (!group.bounds) continue;
    if (group.bounds.maxRadius > clipRadius + 0.01) {
      issues.push(issue(
        "error",
        "CLIPPED_ELEMENT",
        "图层超出画布",
        `“${group.name}”已经进入不可裁切区域。`,
        "向内移动并缩小该图层，或提高画布尺寸后重新导出。",
        group.id
      ));
    } else if (group.bounds.maxRadius > safeRadius + 0.5) {
      issues.push(issue(
        "error",
        "OUTSIDE_SAFE_AREA",
        "图层越过安全边界",
        `“${group.name}”距边缘只有 ${Math.max(0, clipRadius - group.bounds.maxRadius).toFixed(1)}px，小于 ${margin}px 安全边距。`,
        "向内移动或缩小该图层；也可适当减小安全边距，但不建议低于 24px。",
        group.id
      ));
    }
  }

  for (const arc of scene.arcs) {
    if (!Number.isFinite(arc.requiredSpanDeg)) continue;
    if (arc.requiredSpanDeg > arc.maxSpan + 0.1) {
      issues.push(issue(
        "error",
        "ARC_OVERFLOW",
        "弧排文字过长",
        `“${arc.elementName}”需要 ${arc.requiredSpanDeg.toFixed(1)}°，超过 ${arc.maxSpan}° 的连续弧面。文字会重叠或绕圈断裂。`,
        "减少字数或字距、减小字号；也可增大字弧半径来容纳完整文案。",
        arc.elementId
      ));
    } else if (arc.requiredSpanDeg > arc.maxSpan * 0.92) {
      issues.push(issue(
        "warning",
        "ARC_TIGHT",
        "弧排文字接近上限",
        `“${arc.elementName}”已使用 ${arc.requiredSpanDeg.toFixed(1)}° / ${arc.maxSpan}°。`,
        "留出更多字距余量，或增大字弧半径。",
        arc.elementId
      ));
    }
  }

  for (const group of textGroups) {
    const font = group.layout?.fontSize || group.element.fontSize || 0;
    if (font > 0 && font < 10) {
      issues.push(issue(
        "error",
        "TEXT_TOO_SMALL",
        "文字细部不可读",
        `“${group.name}”的字号只有 ${font.toFixed(1)}px，导入或打印时会糊成一团。`,
        "将字号提高到 10px 以上，或把画布提升到 512px / 720px。",
        group.id
      ));
    }
    if (group.type === "text" && group.bounds && group.bounds.width > size * 0.6) {
      issues.push(issue(
        "warning",
        "LINE_TEXT_WIDE",
        "横排文字过宽",
        `“${group.name}”占用了 ${Math.round((group.bounds.width / size) * 100)}% 的画布宽度。`,
        "减少文案、字号或字距，避免与内外圈相撞。",
        group.id
      ));
    }
  }

  for (const wedge of scene.wedges) {
    for (const group of textGroups) {
      if (!group.glyphs?.length) continue;
      const collision = group.glyphs.some((glyph) => glyphHitsWedge(glyph, wedge, scene.center));
      if (!collision) continue;
      const key = `${wedge.elementId}:${group.id}`;
      if (gapIssues.has(key)) continue;
      gapIssues.add(key);
      const dateCollision = isDateGroup(group);
      issues.push(issue(
        "error",
        dateCollision ? "GAP_CUTS_DATE" : "GAP_CUTS_TEXT",
        dateCollision ? "缺口切到了日期" : "缺口切到了文字",
        `“${wedge.elementName}”的缺口与“${group.name}”发生碰撞。`,
        dateCollision
          ? "旋转缺口角度避开日期，或把日期移回中心安全区。"
          : "调整缺口角度或移动文字，确保缺口不穿过任何字形。",
        group.id
      ));
    }
  }

  for (const element of scene.missingImages) {
    issues.push(issue(
      "error",
      "MISSING_IMAGE",
      "图片资源缺失",
      `“${element.name}”引用的图片无法恢复。`,
      "删除该图层并重新上传图片；项目保存时会内嵌图片数据。",
      element.id
    ));
  }

  const seen = new Set();
  return issues.filter((item) => {
    const key = `${item.code}:${item.elementId || ""}:${item.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function issueSummary(issues) {
  const errors = issues.filter((item) => item.level === "error");
  const warnings = issues.filter((item) => item.level === "warning");
  return {
    errors,
    warnings,
    ok: errors.length === 0,
    label: errors.length > 0
      ? `${errors.length} 项需修复`
      : warnings.length > 0
        ? `${warnings.length} 项提醒`
        : "可安全导出"
  };
}

export function constrainElement(model, measurer, elementId) {
  const next = cloneModel(model);
  const element = next.elements.find((item) => item.id === elementId);
  if (!element || !element.visible) return { model: next, adjusted: false };
  let adjusted = false;
  const safeRadius = Math.max(1, next.document.size / 2 - next.document.safeMargin);

  for (let iteration = 0; iteration < 5; iteration += 1) {
    const scene = buildScene(next, measurer, { onlyElementId: elementId });
    const group = scene.groups[0];
    if (!group?.bounds) break;
    const offset = Math.hypot(element.transform.x, element.transform.y);
    const maxRadius = group.bounds.maxRadius;
    if (maxRadius > safeRadius + 0.5) {
      if (offset > 0.001) {
        const factor = Math.max(0.1, safeRadius / maxRadius);
        element.transform.x *= factor;
        element.transform.y *= factor;
        adjusted = true;
        continue;
      }
      const factor = Math.max(0.05, safeRadius / maxRadius);
      element.transform.scale *= factor;
      adjusted = true;
      continue;
    }
    break;
  }
  if (adjusted) next.meta.updatedAt = new Date().toISOString();
  return { model: next, adjusted };
}

export function fitLongText(model, measurer, scene = null) {
  const next = cloneModel(model);
  const currentScene = scene || buildScene(next, measurer);
  for (const arc of currentScene.arcs) {
    const element = next.elements.find((item) => item.id === arc.elementId);
    if (!element) continue;
    let guard = 0;
    while (guard < 30) {
      const probe = buildScene(next, measurer, { onlyElementId: element.id });
      const candidate = probe.arcs[0];
      if (!candidate || candidate.requiredSpanDeg <= element.maxSpan * 0.88) break;
      element.fontSize *= 0.9;
      element.letterSpacing *= 0.9;
      guard += 1;
    }
  }
  for (const element of next.elements) {
    if (element.type !== "text") continue;
    let guard = 0;
    while (guard < 30) {
      const probe = buildScene(next, measurer, { onlyElementId: element.id });
      const group = probe.groups[0];
      if (!group?.bounds || group.bounds.width <= next.document.size * 0.56) break;
      element.fontSize *= 0.9;
      element.letterSpacing *= 0.9;
      guard += 1;
    }
  }
  next.meta.updatedAt = new Date().toISOString();
  return next;
}
