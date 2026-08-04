import type {
  ExecutionPlan,
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ExecutionPlanBlueprintRecordQualification,
  ReceiptTrustAnchor,
} from "@napier/contracts";

import { NapierApiError } from "./api-error";
import type {
  PlanBlueprintLibraryBusyAction,
  PlanBlueprintLibraryReceipt,
} from "./plan-blueprint-library-panel-types";

export interface BlueprintLibraryControlAvailability {
  busy: boolean;
  canApplyPolicyOverride: boolean;
  canRetirePolicyOverride: boolean;
}

export function blueprintLibraryControlAvailability(input: {
  busyAction: PlanBlueprintLibraryBusyAction | undefined;
  receipt: PlanBlueprintLibraryReceipt | undefined;
}): BlueprintLibraryControlAvailability {
  return {
    busy: Boolean(input.busyAction),
    canApplyPolicyOverride:
      input.receipt?.action === "policyBacktested" &&
      Boolean(input.receipt.topSelectedFamilySha256),
    canRetirePolicyOverride:
      input.receipt?.action === "policyOverrideDriftReviewed" &&
      input.receipt.reviewedRecommendation === "retire" &&
      Boolean(
        input.receipt.reviewedFamilySha256 &&
        input.receipt.reviewedOverrideSha256,
      ),
  };
}

export function blueprintLibraryRecordCounts(
  records: ExecutionPlanBlueprintRecord[],
): { active: number; archived: number } {
  const active = records.filter((record) => record.status === "active").length;
  return { active, archived: records.length - active };
}

export function upsertBlueprintRecord(
  records: ExecutionPlanBlueprintRecord[],
  record: ExecutionPlanBlueprintRecord,
): ExecutionPlanBlueprintRecord[] {
  return [
    ...records.filter((candidate) => candidate.id !== record.id),
    record,
  ].toSorted(compareBlueprintRecords);
}

export function firstSigningAnchor(
  anchors: ReceiptTrustAnchor[],
): ReceiptTrustAnchor | undefined {
  return anchors.find(
    (anchor) => anchor.status === "trusted" && Boolean(anchor.signingSource),
  );
}

export function signingAnchorAvailable(
  anchors: ReceiptTrustAnchor[],
  anchorId: string,
): boolean {
  return anchors.some(
    (anchor) =>
      anchor.id === anchorId &&
      anchor.status === "trusted" &&
      Boolean(anchor.signingSource),
  );
}

export function replayHistoryRecordId(history: unknown): string | undefined {
  if (!isPlainRecord(history)) return undefined;
  const recordId = history["recordId"];
  return typeof recordId === "string" && recordId.length > 0
    ? recordId
    : undefined;
}

export function replayOutcomesRecordId(outcomes: unknown): string | undefined {
  if (
    !isPlainRecord(outcomes) ||
    outcomes["kind"] !== "napier.execution-plan-blueprint-replay-outcomes"
  ) {
    return undefined;
  }
  const recordId = outcomes["recordId"];
  return typeof recordId === "string" && recordId.length > 0
    ? recordId
    : undefined;
}

export function planBlueprintPreviewFromError(
  error: unknown,
): ExecutionPlanBlueprintRecordPreview | undefined {
  if (!(error instanceof NapierApiError) || error.status !== 409) {
    return undefined;
  }
  return isExecutionPlanBlueprintRecordPreview(error.payload)
    ? error.payload
    : undefined;
}

function isExecutionPlanBlueprintRecordPreview(
  value: unknown,
): value is ExecutionPlanBlueprintRecordPreview {
  if (!isPlainRecord(value)) return false;
  const qualification = value["qualification"];
  const plan = value["plan"];
  return (
    isPlanBlueprintPreviewStatus(value["status"]) &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].every(
      (diagnostic) => typeof diagnostic === "string",
    ) &&
    typeof value["threadId"] === "string" &&
    typeof value["recordId"] === "string" &&
    typeof value["hasOpenPlan"] === "boolean" &&
    isSha256(value["previewSha256"]) &&
    isExecutionPlanBlueprintRecordQualificationShape(qualification) &&
    (plan === undefined || isExecutionPlanPreviewShape(plan))
  );
}

function isExecutionPlanBlueprintRecordQualificationShape(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification {
  return (
    isPlainRecord(value) &&
    isPlanBlueprintQualificationStatus(value["status"]) &&
    Array.isArray(value["diagnostics"]) &&
    value["diagnostics"].every(
      (diagnostic) => typeof diagnostic === "string",
    ) &&
    typeof value["recordId"] === "string" &&
    typeof value["stepCount"] === "number" &&
    typeof value["artifactCount"] === "number"
  );
}

function isExecutionPlanPreviewShape(value: unknown): value is ExecutionPlan {
  return (
    isPlainRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["threadId"] === "string" &&
    Array.isArray(value["steps"]) &&
    Array.isArray(value["artifacts"])
  );
}

function isPlanBlueprintPreviewStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordPreview["status"] {
  return value === "ready" || value === "not_qualified" || value === "blocked";
}

function isPlanBlueprintQualificationStatus(
  value: unknown,
): value is ExecutionPlanBlueprintRecordQualification["status"] {
  return (
    value === "qualified" ||
    value === "archived" ||
    value === "source_missing" ||
    value === "source_drift" ||
    value === "invalid"
  );
}

function compareBlueprintRecords(
  left: ExecutionPlanBlueprintRecord,
  right: ExecutionPlanBlueprintRecord,
): number {
  const leftRank = left.status === "active" ? 0 : 1;
  const rightRank = right.status === "active" ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.name.localeCompare(right.name)
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
