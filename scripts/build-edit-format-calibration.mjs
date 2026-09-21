import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { calibrationEntryFromReports } from "./edit-format-calibration-evidence.mjs";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    report: { type: "string", multiple: true },
    output: { type: "string" },
    "runtime-root": { type: "string", default: process.cwd() },
  },
});
if (!values.id || !values.output || !values.report?.length)
  throw new Error("Specify --id, repeated --report, and new --output");
const reports = await Promise.all(
  values.report.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
);
const { createEditFormatCalibrationCatalog } = await import(
  pathToFileURL(
    path.resolve(
      values["runtime-root"],
      "packages/runtime/dist/edit-format-calibration.js",
    ),
  )
);
const entry = calibrationEntryFromReports(values.id, reports);
const catalog = createEditFormatCalibrationCatalog([entry]);
await writeFile(values.output, JSON.stringify(catalog, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify({
    output: values.output,
    catalogSha256: catalog.contentSha256,
    assessment: entry.assessment,
  }),
);
