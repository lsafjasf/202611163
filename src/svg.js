import { mm } from "./geometry.js";
import { COLORS, createScene } from "./scene.js";

export function escapeXml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function n(value) {
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(2)) : 0;
}

function pointsAttr(points) {
  return points.map((point) => `${n(point.x)},${n(point.y)}`).join(" ");
}

function rectAttr(rect) {
  return `x="${n(rect.x)}" y="${n(rect.y)}" width="${n(rect.w)}" height="${n(rect.h)}"`;
}

function lineAttr(line) {
  return `x1="${n(line.x1)}" y1="${n(line.y1)}" x2="${n(line.x2)}" y2="${n(line.y2)}"`;
}

function textEl(text, x, y, options = {}) {
  const attrs = [
    `x="${n(x)}"`,
    `y="${n(y)}"`,
    `fill="${escapeXml(options.color || COLORS.muted)}"`,
    `font-family="${escapeXml(options.family || "DejaVu Sans, sans-serif")}"`,
    `font-size="${n(options.size || 10)}"`,
    `font-weight="${escapeXml(options.weight || 600)}"`,
    `text-anchor="${options.anchor || "start"}"`,
  ];
  if (options.tracking) attrs.push(`letter-spacing="${n(options.tracking)}"`);
  if (options.id) attrs.push(`id="${escapeXml(options.id)}"`);
  if (options.className) attrs.push(`class="${escapeXml(options.className)}"`);
  return `<text ${attrs.join(" ")}>${escapeXml(text)}</text>`;
}

function roundedRect(rect, radius, attrs = "") {
  return `<rect ${rectAttr(rect)} rx="${n(radius)}" ${attrs}/>`;
}

function buildDefs(scene) {
  const custom = scene.state.typography?.customFont;
  let fontFace = "";
  if (custom?.dataUrl) {
    fontFace = `<style><![CDATA[
@font-face {
  font-family: "${String(custom.name).replaceAll('"', "")}";
  src: url("${custom.dataUrl}");
}
]]></style>`;
  }
  return `<defs>
    ${fontFace}
    <pattern id="dot-grid" width="22" height="22" patternUnits="userSpaceOnUse">
      <circle cx="4" cy="4" r="1" fill="#1f4339" fill-opacity=".105"/>
    </pattern>
    <filter id="paper-shadow" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="6" stdDeviation="7" flood-color="#4b391a" flood-opacity=".17"/>
    </filter>
    <filter id="card-shadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="5" stdDeviation="10" flood-color="#18322b" flood-opacity=".1"/>
    </filter>
  </defs>`;
}

function buildFlatHeader(scene) {
  const { frame, dieline } = scene.flat;
  return `<g id="flat-header" data-layer="interface">
    ${textEl("FLAT DIELINE", frame.x + 18, frame.y + 28, {
      size: 11,
      weight: 800,
      color: COLORS.ink,
      tracking: 0.8,
    })}
    ${textEl("PRODUCTION NET · MM · 1:1 MODEL", frame.x + 18, frame.y + 42, {
      size: 8,
      family: "DejaVu Sans Mono, monospace",
      color: COLORS.faint,
      tracking: 0.35,
    })}
    ${
      frame.w >= 400
        ? textEl(`L ${dieline.length} × W ${dieline.width} × H ${dieline.height}`, frame.x + frame.w - 18, frame.y + 29, {
            size: 9,
            family: "DejaVu Sans Mono, monospace",
            color: COLORS.muted,
            anchor: "end",
          }) +
          textEl("4 PANELS / 8 FLAPS", frame.x + frame.w - 18, frame.y + 42, {
            size: 8,
            family: "DejaVu Sans Mono, monospace",
            color: COLORS.faint,
            anchor: "end",
          })
        : ""
    }
  </g>`;
}

function buildPaper(scene) {
  const { outline, panels, topFlaps, bottomFlaps, cuts, folds, print, dieline } = scene.flat;
  const showSafe = scene.state.view.showSafeAreas;
  return `<g id="dieline-artboard" data-units="mm" filter="url(#paper-shadow)">
    <polygon points="${pointsAttr(outline)}" fill="${COLORS.paper}" stroke="none"/>
    <g id="panel-tints">
      ${panels
        .map(
          (panel, index) =>
            `<rect ${rectAttr(panel.screen)} fill="${
              index % 2 === 0 ? "#fff6df" : "#705827"
            }" fill-opacity="${index % 2 === 0 ? ".13" : ".03"}"/>`,
        )
        .join("")}
      ${[...topFlaps, ...bottomFlaps]
        .map(
          (flap, index) =>
            `<rect ${rectAttr(flap)} fill="#fff5df" fill-opacity="${
              index % 2 === 0 ? ".06" : ".12"
            }"/>`,
        )
        .join("")}
    </g>
    ${
      showSafe
        ? `<g id="safe-area-guides" data-guides="true" fill="none" stroke="${COLORS.safe}" stroke-opacity=".5" stroke-width="1" stroke-dasharray="4 4">
      ${panels
        .map((panel) => `<rect ${rectAttr(panel.safeScreen)}/>`)
        .join("")}
    </g>`
        : ""
    }
    <polygon id="cut-outline" points="${pointsAttr(outline)}" fill="none" stroke="${COLORS.cut}" stroke-width="1.5" stroke-linejoin="round"/>
    <g id="flap-cuts" stroke="#20463b" stroke-opacity=".8" stroke-width="1">
      ${cuts.map((line) => `<line ${lineAttr(line)}/>`).join("")}
    </g>
    <g id="fold-lines" fill="none" stroke-width="${n(Math.max(1, dieline.foldWidth * scene.flat.transform.scale * 1.55))}" stroke-dasharray="${scene.state.structure.foldStyle === "solid" ? "none" : "5 4"}">
      ${folds
        .map(
          (line) =>
            `<line ${lineAttr(line)} stroke="${line.kind === "glue" ? COLORS.accent : COLORS.fold}" data-fold="${line.kind}"/>`,
        )
        .join("")}
    </g>
    ${panels
      .map((panel) => {
        if (Math.min(panel.screen.w, panel.screen.h) < 52) return "";
        return textEl(panel.label, panel.screen.x + panel.screen.w / 2, panel.screen.y + panel.screen.h - 8, {
          size: 7,
          family: "DejaVu Sans Mono, monospace",
          weight: 700,
          color: "rgba(23,59,50,.72)",
          anchor: "middle",
          tracking: 0.4,
        });
      })
      .join("")}
    ${svgDimensionLine(print.x, print.y - 16, print.x + print.w, print.y - 16, mm(dieline.netWidth))}
    ${svgDimensionLine(print.x - 17, print.y, print.x - 17, print.y + print.h, mm(dieline.netHeight))}
  </g>`;
}

function buildFoldPlan(scene) {
  const { frame } = scene.flat;
  if (frame.h < 300) return "";
  const frames = [...(scene.state.foldKeyframes || [])].sort(
    (a, b) => a.progress - b.progress,
  );
  if (!frames.length) return "";
  const x = frame.x + 24;
  const width = frame.w - 48;
  const compact = frame.w < 360;
  const y = frame.y + frame.h - 35;
  return `<g id="fold-keyframes-plan" data-saved-keyframes="${frames.length}">
    ${textEl("FOLD KEYFRAMES", x, y - 27, {
      size: 8,
      weight: 800,
      color: COLORS.muted,
      tracking: 0.6,
    })}
    ${
      compact
        ? ""
        : textEl("CUT  ·  FOLD  ·  SAFE AREA", x + width, y - 27, {
            size: 7,
            family: "DejaVu Sans Mono, monospace",
            color: COLORS.faint,
            tracking: 0.3,
            anchor: "end",
          })
    }
    <line x1="${n(x)}" y1="${n(y)}" x2="${n(x + width)}" y2="${n(y)}" stroke="#2f483f" stroke-opacity=".25"/>
    ${frames
      .map((frameItem) => {
        const pointX = x + (Math.max(0, Math.min(100, Number(frameItem.progress) || 0)) / 100) * width;
        const active = frameItem.id === scene.state.preview.activeKeyframe;
        return `<g data-keyframe-id="${escapeXml(frameItem.id)}" data-progress="${n(
          frameItem.progress,
        )}">
          <rect x="${n(pointX - 5)}" y="${n(y - 5)}" width="10" height="10" rx="1" transform="rotate(45 ${n(
            pointX,
          )} ${n(y)})" fill="${active ? COLORS.accent : COLORS.yellow}" stroke="${COLORS.paperCard}" stroke-width="1.5"/>
          ${textEl(compact ? `${Math.round(frameItem.progress)}%` : frameItem.label, pointX, y + 16, {
            size: 7,
            family: "DejaVu Sans Mono, monospace",
            weight: 600,
            color: "#416157",
            anchor: "middle",
          })}
        </g>`;
      })
      .join("")}
  </g>`;
}

function svgDimensionLine(x1, y1, x2, y2, value) {
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const width = value.length * 5.2 + 10;
  return `<g id="dimension-${escapeXml(value)}" data-dynamic="dimension">
    <line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="#2b483e" stroke-opacity=".45"/>
    <rect x="${n(midX - width / 2)}" y="${n(midY - 7)}" width="${n(width)}" height="14" rx="4" fill="${COLORS.paperCard}"/>
    ${textEl(value, midX, midY + 3, {
      size: 8,
      family: "DejaVu Sans Mono, monospace",
      weight: 600,
      color: COLORS.muted,
      anchor: "middle",
    })}
  </g>`;
}

function elementTransform(element) {
  const cx = element.box.x + element.box.w / 2;
  const cy = element.box.y + element.box.h / 2;
  const rotation = Number(element.rotation) || 0;
  return {
    cx,
    cy,
    transform: rotation ? `rotate(${n(rotation)} ${n(cx)} ${n(cy)})` : "",
  };
}

function buildTextElement(element) {
  const { cx, transform } = elementTransform(element);
  const lineHeight = element.lines.length
    ? element.totalHeight / element.lines.length
    : element.lineHeight;
  const startY = element.box.y + element.box.h / 2 - element.totalHeight / 2;
  const tspans = element.lines
    .map((line, index) => {
      const y = startY + lineHeight * (index + 0.5);
      return `<tspan x="${n(cx)}" y="${n(y)}">${escapeXml(line || " ")}</tspan>`;
    })
    .join("");
  return `<text id="element-${escapeXml(element.id)}" data-element-id="${escapeXml(
    element.id,
  )}" data-type="text" data-panel="${escapeXml(element.panel)}" x="${n(cx)}" y="${n(
    startY + lineHeight / 2,
  )}" fill="${escapeXml(element.color)}" font-family="${escapeXml(
    element.fontFamily,
  )}, sans-serif" font-size="${n(element.fontSize * sceneScale(element))}" font-weight="${escapeXml(
    element.fontWeight,
  )}" text-anchor="middle" dominant-baseline="middle" xml:space="preserve" letter-spacing="${n(
    (element.letterSpacing || 0) * sceneScale(element),
  )}" transform="${transform}" opacity="${n(element.opacity ?? 1)}">${tspans}</text>`;
}

function sceneScale(element) {
  return element.rawBox ? element.box.w / element.rawBox.w : 1;
}

function buildShapeElement(element) {
  const box = element.box;
  const { transform } = elementTransform(element);
  const color = escapeXml(element.color || COLORS.accent);
  const common = `id="element-${escapeXml(element.id)}" data-element-id="${escapeXml(
    element.id,
  )}" data-type="${escapeXml(element.type)}" data-panel="${escapeXml(
    element.panel,
  )}" fill="${color}" transform="${transform}" opacity="${n(element.opacity ?? 1)}"`;
  if (element.type === "circle") {
    return `<ellipse ${common} cx="${n(box.x + box.w / 2)}" cy="${n(
      box.y + box.h / 2,
    )}" rx="${n(box.w / 2)}" ry="${n(box.h / 2)}"/>`;
  }
  if (element.type === "diamond") {
    const points = [
      [box.x + box.w / 2, box.y],
      [box.x + box.w, box.y + box.h / 2],
      [box.x + box.w / 2, box.y + box.h],
      [box.x, box.y + box.h / 2],
    ];
    return `<polygon ${common} points="${points.map((p) => `${n(p[0])},${n(p[1])}`).join(" ")}"/>`;
  }
  if (element.type === "rule") {
    return `<rect ${common} x="${n(box.x)}" y="${n(box.y + box.h / 2 - 1.5)}" width="${n(
      box.w,
    )}" height="3" rx="1.5"/>`;
  }
  return `<rect ${common} ${rectAttr(box)} rx="${n(
    Math.min((element.radius || 0) * box.w, box.w / 2, box.h / 2),
  )}"/>`;
}

function buildImageElement(element) {
  const { transform } = elementTransform(element);
  return `<image id="element-${escapeXml(element.id)}" data-element-id="${escapeXml(
    element.id,
  )}" data-type="image" data-panel="${escapeXml(element.panel)}" ${rectAttr(
    element.box,
  )} href="${escapeXml(element.src)}" preserveAspectRatio="xMidYMid meet" transform="${transform}" opacity="${n(
    element.opacity ?? 1,
  )}"/>`;
}

function buildElements(scene) {
  return `<g id="artwork" data-editable="true">
    ${scene.flat.elements
      .filter((element) => element.visible !== false)
      .map((element) => {
        if (element.type === "text") return buildTextElement(element);
        if (element.type === "image") return buildImageElement(element);
        return buildShapeElement(element);
      })
      .join("")}
  </g>`;
}

function buildFold(scene) {
  const { frame, quads, flaps, progress, top, seamLine, glueLine } = scene.fold;
  return `<g id="live-fold" data-schematic="cuboid" data-fold-progress="${n(progress)}">
    ${roundedRect(frame, 16, `fill="${COLORS.dark}" filter="url(#card-shadow)"`)}
    <g id="fold-grid" stroke="#b5d7c5" stroke-opacity=".1">
      ${Array.from({ length: 6 }, (_, index) => {
        const x = frame.x + 20 + index * 28;
        return `<line x1="${n(x)}" y1="${n(frame.y + 50)}" x2="${n(x)}" y2="${n(
          frame.y + frame.h - 12,
        )}"/>`;
      }).join("")}
      ${Array.from({ length: 6 }, (_, index) => {
        const y = frame.y + 58 + index * 28;
        return `<line x1="${n(frame.x + 10)}" y1="${n(y)}" x2="${n(
          frame.x + frame.w - 10,
        )}" y2="${n(y)}"/>`;
      }).join("")}
    </g>
    ${textEl("LIVE FOLD", frame.x + 18, frame.y + 29, {
      size: 11,
      weight: 800,
      color: "#f6f0df",
      tracking: 0.8,
    })}
    ${
      frame.w >= 210
        ? textEl("ISOMETRIC · GLUE SEAM", frame.x + 18, frame.y + 43, {
            size: 8,
            family: "DejaVu Sans Mono, monospace",
            color: "#c2d9cc",
            tracking: 0.2,
          })
        : ""
    }
    ${roundedRect(
      { x: frame.x + frame.w - 62, y: frame.y + 16, w: 46, h: 22 },
      11,
      `fill="${progress >= 99.5 ? COLORS.yellow : "#31584d"}"`,
    )}
    ${textEl(`${Math.round(progress)}%`, frame.x + frame.w - 39, frame.y + 30, {
      size: 9,
      family: "DejaVu Sans Mono, monospace",
      weight: 700,
      color: progress >= 99.5 ? COLORS.dark : "#f6f0df",
      anchor: "middle",
    })}
    <ellipse cx="${n(frame.x + frame.w * 0.53)}" cy="${n(frame.y + frame.h * 0.76)}" rx="${n(
      frame.w * 0.29,
    )}" ry="${n(frame.h * 0.045)}" fill="#071a15" fill-opacity=".25"/>
    ${quads
      .map(
        (quad) =>
          `<polygon points="${pointsAttr(quad.points)}" fill="${quad.fill}" fill-opacity="${n(
            quad.opacity,
          )}" stroke="${quad.stroke}" stroke-width="1"/>`,
      )
      .join("")}
    ${
      progress >= 99.5
        ? `<polygon points="${pointsAttr(top.front)}" fill="#e5c98c" stroke="#b9895e" stroke-width="1"/>
           <line ${lineAttr(seamLine)} stroke="${COLORS.accent}" stroke-width="1.5" stroke-dasharray="4 3"/>`
        : ""
    }
    ${flaps
      .map(
        (flap) =>
          `<polygon points="${pointsAttr(flap.points)}" fill="${flap.fill}" fill-opacity="${n(
            flap.opacity,
          )}" stroke="${flap.stroke}" stroke-width="1.2"/>`,
      )
      .join("")}
    <line ${lineAttr(glueLine)} stroke="#f0a366" stroke-width="1.8" data-fold="glue-seam"/>
    ${
      frame.w < 235
        ? textEl(
            `${scene.state.dimensions.length} × ${scene.state.dimensions.width} × ${scene.state.dimensions.height} mm`,
            frame.x + 18,
            frame.y + frame.h - 35,
            {
              size: 8,
              family: "DejaVu Sans Mono, monospace",
              color: "#b8cfc3",
            },
          )
        : textEl(
            `L ${mm(scene.state.dimensions.length)}  ·  W ${mm(scene.state.dimensions.width)}`,
            frame.x + 18,
            frame.y + frame.h - 35,
            {
              size: 8,
              family: "DejaVu Sans Mono, monospace",
              color: "#b8cfc3",
            },
          ) +
          textEl(
            `H ${mm(scene.state.dimensions.height)}`,
            frame.x + frame.w - 18,
            frame.y + frame.h - 35,
            {
              size: 8,
              family: "DejaVu Sans Mono, monospace",
              color: "#b8cfc3",
              anchor: "end",
            },
          )
    }
    ${roundedRect(
      { x: frame.x + 16, y: frame.y + frame.h - 24, w: 116, h: 16 },
      8,
      `fill="${progress >= 99.5 ? "#4b4426" : "#25483f"}"`,
    )}
    ${textEl(
      progress >= 99.5 ? "✓  SEAM CLOSED" : "FOLD IN PROGRESS",
      frame.x + 74,
      frame.y + frame.h - 14,
      {
        size: 8,
        family: "DejaVu Sans Mono, monospace",
        weight: 700,
        color: progress >= 99.5 ? COLORS.yellow : "#c4d8cc",
        anchor: "middle",
      },
    )}
  </g>`;
}

function safeMetadata(state) {
  const copy = JSON.parse(JSON.stringify(state));
  if (copy.typography?.customFont) {
    copy.typography.customFont = {
      name: copy.typography.customFont.name,
      embeddedInSvg: true,
    };
  }
  copy.images = (copy.images || []).map((image) => ({
    id: image.id,
    name: image.name,
    embedded: true,
  }));
  return {
    generator: "Crease Studio",
    schema: "carton-dieline/v1",
    exportedAt: new Date().toISOString(),
    units: "mm",
    boxDimensions: state.dimensions,
    structure: state.structure,
    template: state.template,
    font: state.typography,
    foldKeyframes: state.foldKeyframes,
    artwork: state.artwork.map((element) => ({
      id: element.id,
      type: element.type,
      name: element.name,
      panel: element.panel,
      text: element.text,
    })),
    parameters: copy,
  };
}

export function exportSvg(state, options = {}) {
  const width = Math.max(640, Math.round(options.width || 1400));
  const height = Math.max(520, Math.round(options.height || 900));
  const scene = createScene(state, width, height, {
    measureText: options.measureText,
    exportMode: true,
  });
  const metadata = JSON.stringify(safeMetadata(state), null, 2).replaceAll("]]>", "]]]]><![CDATA[>");
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
  role="img" aria-labelledby="title desc" data-units="mm"
  data-box-length="${escapeXml(state.dimensions.length)}"
  data-box-width="${escapeXml(state.dimensions.width)}"
  data-box-height="${escapeXml(state.dimensions.height)}"
  data-safe-margin="${escapeXml(state.structure.safeMargin)}">
  <title id="title">${escapeXml(state.title)} — editable carton dieline</title>
  <desc id="desc">${escapeXml(
    `Four-panel carton net with ${state.structure.glueTab} mm glue tongue, live fold preview and editable artwork.`,
  )}</desc>
  <metadata id="crease-parameters"><![CDATA[${metadata}]]></metadata>
  ${buildDefs(scene)}
  <rect id="background" width="${width}" height="${height}" fill="${COLORS.canvas}"/>
  <rect id="background-dot-grid" width="${width}" height="${height}" fill="url(#dot-grid)"/>
  <g id="flat-card" data-layer="interface">
    ${roundedRect(scene.flat.frame, 16, `fill="${COLORS.paperCard}" stroke="#2f483f" stroke-opacity=".13" filter="url(#card-shadow)"`)}
    ${buildFlatHeader(scene)}
    ${buildPaper(scene)}
    ${buildFoldPlan(scene)}
    ${buildElements(scene)}
  </g>
  ${buildFold(scene)}
</svg>`;
}
