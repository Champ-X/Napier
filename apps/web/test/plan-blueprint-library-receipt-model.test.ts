import { describe, expect, it } from "vitest";

import type { PlanBlueprintLibraryReceipt } from "../src/plan-blueprint-library-panel-types";
import { projectPlanBlueprintLibraryReceiptHeader } from "../src/plan-blueprint-library-receipt-model";
import { planCopy } from "../src/plan-copy";

describe("Plan blueprint library receipt model", () => {
  it("projects a basic saved receipt", () => {
    expect(
      projectPlanBlueprintLibraryReceiptHeader(
        receipt({
          action: "saved",
          recordId: "blueprint_saved",
          blueprintSha256: "a".repeat(64),
          status: "active",
          stepCount: 3,
          artifactCount: 2,
        }),
      ),
    ).toEqual({
      successful: true,
      title: planCopy.blueprint.library.receipts.saved,
      receiptHash: "a".repeat(64),
      summary: `3 ${planCopy.blueprint.steps} / 2 ${planCopy.blueprint.artifacts}`,
      identity: planCopy.blueprint.library.statuses.active,
    });
  });

  it("projects invalid replay-history verification", () => {
    expect(
      projectPlanBlueprintLibraryReceiptHeader(
        receipt({
          action: "historyVerified",
          recordId: "blueprint_history_verification",
          verificationStatus: "invalid",
          contentSha256: "b".repeat(64),
          replayCount: 4,
          threadCount: 2,
          planCount: 3,
        }),
      ),
    ).toEqual({
      successful: false,
      title: planCopy.blueprint.library.verificationStatuses.invalid,
      receiptHash: "b".repeat(64),
      summary: `4 ${planCopy.blueprint.library.replays} / 2 ${planCopy.blueprint.library.threads} / 3 ${planCopy.blueprint.library.plans}`,
      identity: "bluepri...ation",
    });
  });

  it("uses Thread identity when selection has no winning record", () => {
    expect(
      projectPlanBlueprintLibraryReceiptHeader(
        receipt({
          action: "selection",
          threadId: "thread_without_selection",
          contentSha256: "c".repeat(64),
          candidateCount: 5,
          qualifiedCandidateCount: 0,
          rejectedCandidateCount: 5,
        }),
      ),
    ).toEqual({
      successful: false,
      title: planCopy.blueprint.library.receipts.selection,
      receiptHash: "c".repeat(64),
      summary: `5 ${planCopy.blueprint.library.candidates} / 0 ${planCopy.blueprint.library.qualified} / 5 ${planCopy.blueprint.library.rejected}`,
      identity: "thread_...ction",
    });
  });

  it("projects policy drift and retirement identity", () => {
    expect(
      projectPlanBlueprintLibraryReceiptHeader(
        receipt({
          action: "policyOverrideDriftReviewed",
          contentSha256: "d".repeat(64),
          reviewSetSha256: "e".repeat(64),
          reviewedFamilySha256: "f".repeat(64),
          overrideCount: 2,
          alignedCount: 1,
          retireRecommendedCount: 1,
          missingFamilyCount: 0,
        }),
      ),
    ).toEqual({
      successful: false,
      title: planCopy.blueprint.library.receipts.policyOverrideDriftReviewed,
      receiptHash: "d".repeat(64),
      summary: `2 ${planCopy.blueprint.library.override} / 1 ${planCopy.blueprint.library.aligned} / 1 ${planCopy.blueprint.library.recommendedRetire}`,
      identity: "f".repeat(12),
    });
  });

  it("fails a created receipt with invalid replay evidence", () => {
    expect(
      projectPlanBlueprintLibraryReceiptHeader(
        receipt({
          action: "created",
          blueprintSha256: "1".repeat(64),
          planId: "plan_created",
          stepCount: 1,
          artifactCount: 0,
          replayEventVerificationStatus: "invalid",
          replayEventDiagnostics: ["event_hash_mismatch"],
        }),
      ),
    ).toEqual({
      successful: false,
      title: planCopy.blueprint.library.receipts.created,
      receiptHash: "1".repeat(64),
      summary: `1 ${planCopy.blueprint.steps} / 0 ${planCopy.blueprint.artifacts}`,
      identity: "plan_created",
    });
  });
});

function receipt(value: Record<string, unknown>): PlanBlueprintLibraryReceipt {
  return value as unknown as PlanBlueprintLibraryReceipt;
}
