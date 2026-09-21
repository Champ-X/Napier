import { createHash } from "node:crypto";
import path from "node:path";
import {
  createObservedWorkspaceReceipt,
  validateObservedWorkspaceReceipt,
} from "./harness-observed-workspace.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const validHash = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
function bound(value, kind, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { contentSha256, ...content } = value;
  return (
    value.kind === kind &&
    value.schemaVersion === 1 &&
    Object.keys(content).sort().join() === fields.split(",").sort().join() &&
    validHash(contentSha256) &&
    hash(JSON.stringify(content)) === contentSha256
  );
}

/** Legacy observations remain host observations. Partial new receipts fail closed. */
export function graderEvidenceIdentity(report) {
  if (!("graderConfiguration" in report) && !("graderExecution" in report))
    return "legacy-host";
  try {
    const config = report.graderConfiguration,
      execution = report.graderExecution;
    if (
      !bound(
        config,
        "napier.harness-grader-configuration",
        "kind,schemaVersion,mode,sandboxId,runtimes",
      ) ||
      config.mode !== "sandbox" ||
      config.sandboxId !== "oci-container" ||
      report.sandbox !== config.sandboxId ||
      !Array.isArray(config.runtimes) ||
      !config.runtimes.some((binding) => binding.runtime === "node") ||
      new Set(config.runtimes.map((binding) => binding.runtime)).size !==
        config.runtimes.length ||
      config.runtimes.some(
        (binding) =>
          Object.keys(binding).sort().join() !==
            "executable,executableSha256,runtime,runtimeIdentitySha256" ||
          !["node", "python"].includes(binding.runtime) ||
          typeof binding.executable !== "string" ||
          !path.posix.isAbsolute(binding.executable) ||
          !validHash(binding.executableSha256) ||
          !validHash(binding.runtimeIdentitySha256),
      )
    )
      return undefined;
    if (
      !bound(
        execution,
        "napier.harness-grader-execution",
        "kind,schemaVersion,runId,configurationSha256,graderSha256,graderRelativePath,observedWorkspaceSha256,workspaceBeforeSha256,workspaceAfterSha256,workspaceUnchanged,processStatus,exitCode,signal,stdoutSha256,stderrSha256,reportOutputSha256,stdoutTruncated,stderrTruncated,observationComplete,passed",
      )
    )
      return undefined;
    const observed = validateObservedWorkspaceReceipt(
      report.observedWorkspace,
      report.runId,
    );
    if (
      typeof execution.graderRelativePath !== "string" ||
      Object.hasOwn(observed.files, execution.graderRelativePath)
    )
      return undefined;
    const fullWorkspace = createObservedWorkspaceReceipt(report.runId, {
      ...observed.files,
      [execution.graderRelativePath]: execution.graderSha256,
    });
    if (
      execution.runId !== report.runId ||
      execution.configurationSha256 !== config.contentSha256 ||
      execution.graderSha256 !== report.outcomeSha256 ||
      !validHash(execution.graderSha256) ||
      execution.observedWorkspaceSha256 !== observed.contentSha256 ||
      execution.workspaceBeforeSha256 !== fullWorkspace.contentSha256 ||
      ![
        "workspaceBeforeSha256",
        "workspaceAfterSha256",
        "stdoutSha256",
        "stderrSha256",
        "reportOutputSha256",
      ].every((key) => validHash(execution[key])) ||
      execution.workspaceUnchanged !== true ||
      execution.workspaceBeforeSha256 !== execution.workspaceAfterSha256 ||
      execution.processStatus !== "exited" ||
      !Number.isInteger(execution.exitCode) ||
      execution.exitCode < 0 ||
      execution.signal !== null ||
      execution.stdoutTruncated !== false ||
      execution.stderrTruncated !== false ||
      execution.observationComplete !== true ||
      execution.passed !== (execution.exitCode === 0) ||
      report.graderExitCode !== execution.exitCode ||
      typeof report.graderOutput !== "string" ||
      hash(report.graderOutput) !== execution.reportOutputSha256 ||
      (report.taskSuccess && !execution.passed)
    )
      return undefined;
    return config.contentSha256;
  } catch {
    return undefined;
  }
}
