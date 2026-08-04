import type {
  ExecutionPlanBlueprintRecord,
  ExecutionPlanBlueprintRecordPreview,
  ReceiptTrustAnchor,
} from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { NapierApiError } from "../src/api-error";
import {
  blueprintLibraryControlAvailability,
  blueprintLibraryRecordCounts,
  firstSigningAnchor,
  planBlueprintPreviewFromError,
  replayHistoryRecordId,
  replayOutcomesRecordId,
  signingAnchorAvailable,
  upsertBlueprintRecord,
} from "../src/plan-blueprint-panel-model";
import type { PlanBlueprintLibraryReceipt } from "../src/plan-blueprint-library-panel-types";

describe("Plan blueprint panel model", () => {
  it("upserts records in active, recency, and name order", () => {
    const archived = blueprintRecord({
      id: "blueprint_archived",
      name: "Archived",
      status: "archived",
      updatedAt: "2026-08-04T00:00:03.000Z",
    });
    const existing = blueprintRecord({
      id: "blueprint_existing",
      name: "Zulu",
      status: "active",
      updatedAt: "2026-08-04T00:00:01.000Z",
    });
    const replacement = blueprintRecord({
      id: existing.id,
      name: "Alpha",
      status: "active",
      updatedAt: "2026-08-04T00:00:02.000Z",
    });

    expect(
      upsertBlueprintRecord([existing, archived], replacement).map(
        (record) => `${record.id}:${record.name}`,
      ),
    ).toEqual(["blueprint_existing:Alpha", "blueprint_archived:Archived"]);
  });

  it("selects only trusted anchors with local signing sources", () => {
    const publicOnly = receiptAnchor("anchor_public", "trusted");
    const revoked = receiptAnchor("anchor_revoked", "revoked", true);
    const signer = receiptAnchor("anchor_signer", "trusted", true);
    const anchors = [publicOnly, revoked, signer];

    expect(firstSigningAnchor(anchors)).toBe(signer);
    expect(signingAnchorAvailable(anchors, signer.id)).toBe(true);
    expect(signingAnchorAvailable(anchors, publicOnly.id)).toBe(false);
    expect(signingAnchorAvailable(anchors, revoked.id)).toBe(false);
  });

  it("derives policy control availability from the latest receipt", () => {
    expect(
      blueprintLibraryControlAvailability({
        busyAction: "backtestPolicy",
        receipt: {
          action: "policyBacktested",
          topSelectedFamilySha256: "a".repeat(64),
        } as PlanBlueprintLibraryReceipt,
      }),
    ).toEqual({
      busy: true,
      canApplyPolicyOverride: true,
      canRetirePolicyOverride: false,
    });
    expect(
      blueprintLibraryControlAvailability({
        busyAction: undefined,
        receipt: {
          action: "policyOverrideDriftReviewed",
          reviewedRecommendation: "retire",
          reviewedFamilySha256: "b".repeat(64),
          reviewedOverrideSha256: "c".repeat(64),
        } as PlanBlueprintLibraryReceipt,
      }),
    ).toEqual({
      busy: false,
      canApplyPolicyOverride: false,
      canRetirePolicyOverride: true,
    });
  });

  it("counts active and archived Blueprint records", () => {
    expect(
      blueprintLibraryRecordCounts([
        blueprintRecord({
          id: "blueprint_active",
          name: "Active",
          status: "active",
          updatedAt: "2026-08-04T00:00:00.000Z",
        }),
        blueprintRecord({
          id: "blueprint_archived",
          name: "Archived",
          status: "archived",
          updatedAt: "2026-08-04T00:00:01.000Z",
        }),
      ]),
    ).toEqual({ active: 1, archived: 1 });
  });

  it("reads replay ownership without accepting malformed outcomes", () => {
    expect(replayHistoryRecordId({ recordId: "blueprint_history" })).toBe(
      "blueprint_history",
    );
    expect(replayHistoryRecordId({ recordId: "" })).toBeUndefined();
    expect(
      replayOutcomesRecordId({
        kind: "napier.execution-plan-blueprint-replay-outcomes",
        recordId: "blueprint_outcomes",
      }),
    ).toBe("blueprint_outcomes");
    expect(
      replayOutcomesRecordId({
        kind: "wrong",
        recordId: "blueprint_outcomes",
      }),
    ).toBeUndefined();
  });

  it("recovers only shape-valid conflict previews", () => {
    const preview = blueprintPreview();
    expect(
      planBlueprintPreviewFromError(
        new NapierApiError("conflict", {
          status: 409,
          payload: preview,
        }),
      ),
    ).toEqual(preview);
    expect(
      planBlueprintPreviewFromError(
        new NapierApiError("conflict", {
          status: 400,
          payload: preview,
        }),
      ),
    ).toBeUndefined();
    expect(
      planBlueprintPreviewFromError(
        new NapierApiError("conflict", {
          status: 409,
          payload: { ...preview, previewSha256: "short" },
        }),
      ),
    ).toBeUndefined();
    expect(
      planBlueprintPreviewFromError(
        new NapierApiError("conflict", {
          status: 409,
          payload: {
            ...preview,
            plan: { id: "plan_invalid", steps: [], artifacts: [] },
          },
        }),
      ),
    ).toBeUndefined();
  });
});

function blueprintRecord(
  input: Pick<
    ExecutionPlanBlueprintRecord,
    "id" | "name" | "status" | "updatedAt"
  >,
): ExecutionPlanBlueprintRecord {
  return input as ExecutionPlanBlueprintRecord;
}

function receiptAnchor(
  id: string,
  status: ReceiptTrustAnchor["status"],
  signing = false,
): ReceiptTrustAnchor {
  return {
    id,
    status,
    ...(signing
      ? {
          signingSource: {
            type: "environment" as const,
            variable: "TEST_SIGNING_KEY",
          },
        }
      : {}),
  } as ReceiptTrustAnchor;
}

function blueprintPreview(): ExecutionPlanBlueprintRecordPreview {
  return {
    status: "ready",
    diagnostics: [],
    threadId: "thread_preview",
    recordId: "blueprint_preview",
    qualification: {
      status: "qualified",
      diagnostics: [],
      recordId: "blueprint_preview",
      stepCount: 1,
      artifactCount: 0,
      qualifiedAt: "2026-08-04T00:00:00.000Z",
    },
    hasOpenPlan: false,
    plan: {
      id: "plan_preview",
      threadId: "thread_preview",
      steps: [],
      artifacts: [],
    } as unknown as NonNullable<ExecutionPlanBlueprintRecordPreview["plan"]>,
    previewSha256: "a".repeat(64),
  };
}
