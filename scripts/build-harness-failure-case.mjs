import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { buildFailureCase } from "./harness-campaign-evidence.mjs";

const { values } = parseArgs({
  options: {
    report: { type: "string" },
    "case-root": { type: "string" },
    output: { type: "string" },
    "observed-workspace": { type: "string" },
  },
});
if (!values.report || !values["case-root"] || !values.output)
  throw new Error("Specify --report, --case-root and a new --output directory");
const evidence = await buildFailureCase({
  report: JSON.parse(await readFile(values.report, "utf8")),
  caseRoot: values["case-root"],
  output: values.output,
  ...(values["observed-workspace"]
    ? { observedWorkspaceRoot: values["observed-workspace"] }
    : {}),
});
console.log(
  JSON.stringify({
    output: values.output,
    runId: evidence.originalRunId,
    failure: evidence.failure,
    reportSha256: evidence.reportSha256,
  }),
);
