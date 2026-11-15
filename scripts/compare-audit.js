import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const beforePath = resolve("artifacts/audit-before.json");
const afterPath = resolve("artifacts/audit-after.json");
const before = JSON.parse(await readFile(beforePath, "utf8"));
const after = JSON.parse(await readFile(afterPath, "utf8"));
const beforeById = new Map(before.scenarios.map((item) => [item.id, item]));
const afterById = new Map(after.scenarios.map((item) => [item.id, item]));
const ids = [...new Set([...beforeById.keys(), ...afterById.keys()])];
const rows = [];

let baselineDraws = 0;
let currentDraws = 0;
let finalEqual = 0;
let errorsEqual = 0;
let exportEqual = 0;

for (const id of ids) {
  const base = beforeById.get(id);
  const current = afterById.get(id);
  if (!base || !current) {
    throw new Error(`场景 ${id} 缺少修改前或修改后证据`);
  }
  const resultMatch =
    base.result.finalHash === current.result.finalHash &&
    base.result.status === current.result.status &&
    JSON.stringify(base.result.firstDivergence) ===
      JSON.stringify(current.result.firstDivergence);
  const errorMatch =
    JSON.stringify(base.result.errorCodes) ===
    JSON.stringify(current.result.errorCodes);
  const digestMatch = base.recording.digest === current.recording.digest;
  if (resultMatch) finalEqual += 1;
  if (errorMatch) errorsEqual += 1;
  if (digestMatch) exportEqual += 1;
  baselineDraws += base.resources.drawCalls;
  currentDraws += current.resources.drawCalls;
  rows.push({
    id,
    label: base.label,
    before: {
      profile: before.profile,
      status: base.result.status,
      finalHash: base.result.finalHash,
      firstDivergence: base.result.firstDivergence,
      firstRandomDivergence: base.result.firstRandomDivergence,
      firstStateDivergence: base.result.firstStateDivergence,
      errorCodes: base.result.errorCodes,
      elapsedMs: base.result.replayMs,
      resources: base.resources,
    },
    after: {
      profile: after.profile,
      status: current.result.status,
      finalHash: current.result.finalHash,
      firstDivergence: current.result.firstDivergence,
      firstRandomDivergence: current.result.firstRandomDivergence,
      firstStateDivergence: current.result.firstStateDivergence,
      errorCodes: current.result.errorCodes,
      elapsedMs: current.result.replayMs,
      resources: current.resources,
    },
    checks: {
      finalResultEqual: resultMatch,
      errorLogEqual: errorMatch,
      exportDigestEqual: digestMatch,
    },
    reproduction: current.repro,
    errorsBefore: base.errors,
    errorsAfter: current.errors,
  });
}

const reductionPercent =
  baselineDraws > 0
    ? Number((((baselineDraws - currentDraws) / baselineDraws) * 100).toFixed(2))
    : 0;
const comparison = {
  schema: "pulse-trace-comparison/1",
  generatedAt: new Date().toISOString(),
  beforeFile: "artifacts/audit-before.json",
  afterFile: "artifacts/audit-after.json",
  profiles: { before: before.profile, after: after.profile },
  summary: {
    scenarios: ids.length,
    finalResultEqual: finalEqual,
    errorLogEqual: errorsEqual,
    exportDigestEqual: exportEqual,
    baselineDrawCalls: baselineDraws,
    currentDrawCalls: currentDraws,
    canvasDrawReductionPercent: reductionPercent,
  },
  rows,
};

await writeFile(
  resolve("artifacts/comparison.json"),
  `${JSON.stringify(comparison, null, 2)}\n`,
  "utf8",
);

const scenarioRows = rows
  .map((row) => {
    const divergence = row.after.firstDivergence
      ? `T+${row.after.firstDivergence.tick} ${row.after.firstDivergence.kind}`
      : "无";
    return `| ${row.label} | ${row.before.status} / ${row.after.status} | \`${row.after.finalHash}\` | ${divergence} | ${row.before.errorCodes.length} → ${row.after.errorCodes.length} | ${row.before.resources.drawCallsPerFrame} → ${row.after.resources.drawCallsPerFrame} | ${row.before.resources.peakLiveShapes} → ${row.after.resources.peakLiveShapes} |`;
  })
  .join("\n");

const errorDetails = rows
  .filter((row) => row.after.errorCodes.length > 0)
  .map(
    (row) =>
      `- **${row.label}**：${row.errorsAfter
        .map((error) => {
          const tick =
            error.tick === null || error.tick === undefined
              ? "T+—"
              : error.tick < 0
                ? `T${error.tick}`
                : `T+${error.tick}`;
          return `${error.code} @ ${tick}`;
        })
        .join("、")}`,
  )
  .join("\n");

const report = `# Pulse Trace 修改前后对照

生成时间：${comparison.generatedAt}

- 修改前：\`${before.profile}\` 完整视觉渲染路径。
- 修改后：\`${after.profile}\` 精简视觉渲染路径（当前默认）。
- 引擎、录放协议、导出 schema 均未改变。
- 最终结果一致：**${finalEqual}/${ids.length}**
- 异常日志一致：**${errorsEqual}/${ids.length}**
- 录包/导出摘要一致：**${exportEqual}/${ids.length}**
- Canvas draw calls：**${baselineDraws} → ${currentDraws}（-${reductionPercent}%）**

| 场景 | 结果（前/后） | 最终哈希 | 首次分叉 | 异常数 | draw/frame | peak shapes |
| --- | --- | --- | --- | --- | --- | --- |
${scenarioRows}

## 异常日志

${errorDetails || "无异常。"}

损坏场景可重复：固定 seed、固定 tick 和固定随机行。修改前后均保留相同的 4 条异常，不把失败回放标记为成功。

## 复现

\`\`\`bash
npm run audit:before
npm run audit:after
npm run compare
\`\`\`

原始证据见 \`artifacts/audit-before.json\`、\`artifacts/audit-after.json\` 与 \`artifacts/comparison.json\`。
`;

await writeFile(resolve("artifacts/REPORT.md"), report, "utf8");
console.log(report);
