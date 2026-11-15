import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createAuditReport } from "../src/benchmark.js";

function readArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];
    if (current === "--profile" || current === "--output" || current === "--label") {
      args[current.slice(2)] = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

const args = readArgs(process.argv.slice(2));
const profile = args.profile ?? "lean";
const output = resolve(args.output ?? `artifacts/audit-${profile}.json`);
const label = args.label ?? `${profile}-render`;
const report = createAuditReport({ profile, label });

await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");

for (const scenario of report.scenarios) {
  const result = scenario.result;
  console.log(
    [
      scenario.id.padEnd(9),
      result.status.padEnd(8),
      `hash=${result.finalHash}`,
      `errors=${result.errorCount}`,
      `first=${result.firstDivergence?.tick ?? "-"}`,
      `draw/f=${scenario.resources.drawCallsPerFrame}`,
      `peak=${scenario.resources.peakLiveShapes}`,
    ].join("  "),
  );
}
console.log(`Wrote ${output}`);
