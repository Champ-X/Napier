import type { ArtifactManifestEntry, ExecutionPlan } from "@napier/contracts";

import { planCopy } from "./plan-copy";

export const MAX_PLAN_ARCHIVE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_PLAN_BLUEPRINT_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PLAN_BLUEPRINT_REPLAY_HISTORY_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PLAN_BLUEPRINT_REPLAY_OUTCOMES_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_PLAN_BLUEPRINT_POLICY_OVERRIDE_RETIREMENT_HISTORY_FILE_BYTES =
  2 * 1024 * 1024;

export function parsePlanModelKey(value: string): {
  provider: string;
  id: string;
} {
  const separator = value.indexOf("/");
  if (separator < 1 || separator === value.length - 1) {
    return { provider: "napier", id: "demo" };
  }
  return {
    provider: value.slice(0, separator),
    id: value.slice(separator + 1),
  };
}

export function planArtifactActionEvidence(
  artifact: ArtifactManifestEntry,
  action: "produced" | "verified" | "missing",
): string {
  if (artifact.evidence?.trim()) {
    return `${artifact.evidence.trim()} / ${planCopy.artifactActions.evidence[action]}`;
  }
  return planCopy.artifactActions.evidence[action];
}

export function downloadPlanJson(value: unknown, filename: string): void {
  downloadPlanBlob(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {
      type: "application/json",
    }),
    filename,
  );
}

export function downloadPlanBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function shortPlanId(value: string): string {
  return value.length > 15
    ? `${value.slice(0, 7)}...${value.slice(-5)}`
    : value;
}

export function currentPlan(plans: ExecutionPlan[]): ExecutionPlan | undefined {
  return (
    plans.findLast((candidate) => candidate.status === "active") ??
    plans.findLast((candidate) => candidate.status === "blocked") ??
    plans.at(-1)
  );
}
