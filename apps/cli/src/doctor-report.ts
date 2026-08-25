import type { ModelRef } from "@napier/contracts";
import { canonicalJson, sha256 } from "@napier/runtime/core";

import {
  type DoctorCheck,
  type DoctorCheckStatus,
} from "./doctor-check-model.js";
import {
  createDoctorRemediations,
  type DoctorRemediation,
} from "./doctor-remediation.js";

export type { DoctorCheck, DoctorCheckStatus };

export interface DoctorReport {
  kind: "napier.doctor-report";
  schemaVersion: 2;
  status: "ready" | "degraded" | "blocked";
  online: boolean;
  workspaceSha256: string;
  model?: ModelRef;
  checkCount: number;
  passedCount: number;
  warningCount: number;
  failedCount: number;
  skippedCount: number;
  checks: DoctorCheck[];
  remediationCount: number;
  remediations: DoctorRemediation[];
  contentSha256: string;
}

export function createDoctorReport(input: {
  online: boolean;
  workspace: string;
  model?: ModelRef;
  checks: DoctorCheck[];
}): DoctorReport {
  const counts = countStatuses(input.checks);
  const remediations = createDoctorRemediations(input.checks);
  const status: DoctorReport["status"] = input.checks.some(
    (check) => check.required && check.status === "failed",
  )
    ? "blocked"
    : counts.warning > 0 || counts.failed > 0 || counts.skipped > 0
      ? "degraded"
      : "ready";
  const reportWithoutHash = {
    kind: "napier.doctor-report" as const,
    schemaVersion: 2 as const,
    status,
    online: input.online,
    workspaceSha256: sha256(input.workspace),
    ...(input.model ? { model: input.model } : {}),
    checkCount: input.checks.length,
    passedCount: counts.passed,
    warningCount: counts.warning,
    failedCount: counts.failed,
    skippedCount: counts.skipped,
    checks: input.checks,
    remediationCount: remediations.length,
    remediations,
  };
  return {
    ...reportWithoutHash,
    contentSha256: sha256(canonicalJson(reportWithoutHash)),
  };
}

export function formatDoctorReport(report: DoctorReport): string {
  return [
    `Napier Doctor: ${report.status.toUpperCase()}`,
    ...report.checks.map(
      (check) =>
        `${statusIcon(check.status)} ${check.id}: ${check.message} [${check.code}]`,
    ),
    ...(report.remediations.length > 0
      ? [
          "Remediation:",
          ...report.remediations.map(
            (remediation) =>
              `${remediation.priority === "required" ? "REQUIRED" : "OPTIONAL"} ${remediation.id}: ${remediation.instruction} Verify: ${remediation.verifyCommand}`,
          ),
        ]
      : []),
    `Summary: ${String(report.passedCount)} passed, ${countLabel(report.warningCount, "warning")}, ${String(report.failedCount)} failed, ${String(report.skippedCount)} skipped`,
    `Report SHA-256: ${report.contentSha256}`,
  ].join("\n");
}

function countStatuses(
  checks: DoctorCheck[],
): Record<DoctorCheckStatus, number> {
  const counts: Record<DoctorCheckStatus, number> = {
    passed: 0,
    warning: 0,
    failed: 0,
    skipped: 0,
  };
  for (const check of checks) counts[check.status] += 1;
  return counts;
}

function statusIcon(status: DoctorCheckStatus): string {
  if (status === "passed") return "PASS";
  if (status === "warning") return "WARN";
  if (status === "failed") return "FAIL";
  return "SKIP";
}

function countLabel(count: number, label: string): string {
  return `${String(count)} ${label}${count === 1 ? "" : "s"}`;
}
