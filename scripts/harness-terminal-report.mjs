import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { trialResultPath } from "./harness-trial-result-path.mjs";

/** Only a complete driver report AND its durable terminal Run authorize
 * cleanup. A workspace result, partial JSON or another trial is insufficient. */
export async function readTerminalReportProof(job) {
  const reportPath = trialResultPath(job);
  let bytes, report;
  try {
    bytes = await readFile(reportPath);
    assert.ok(bytes.length <= 16 * 1024 * 1024, "Terminal report exceeds size limit");
    report = JSON.parse(bytes);
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return undefined;
    throw error;
  }
  for (const field of ["caseId", "arm", "trial"]) assert.equal(report[field], job[field], "Terminal report identity mismatch");
  if (!["completed", "failed", "cancelled", "interrupted"].includes(report.status) ||
      !Number.isInteger(report.graderExitCode) || report.graderExitCode < 0) return undefined;
  const db = new DatabaseSync(path.join(path.dirname(reportPath), "data", "ledger.sqlite"), { readOnly: true });
  let terminal;
  try {
    terminal = db.prepare("SELECT event_json FROM ledger_events WHERE run_id=? AND json_extract(event_json,'$.type')=? ORDER BY seq DESC LIMIT 1")
      .get(report.runId, `run.${report.status}`);
  } finally { db.close(); }
  if (!terminal) return undefined;
  return { reportPath, reportSha256: createHash("sha256").update(bytes).digest("hex"),
    runId: report.runId, caseId: report.caseId, arm: report.arm, trial: report.trial,
    status: report.status, graderExitCode: report.graderExitCode,
    terminalAt: JSON.parse(terminal.event_json).createdAt };
}
