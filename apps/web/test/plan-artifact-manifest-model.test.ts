import type { ArtifactManifestEntry } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import type {
  PlanArtifactDataProfileReceipt,
  PlanArtifactDriftCheckReceipt,
  PlanArtifactTextPreviewReceipt,
} from "../src/artifact-file-api";
import {
  planArtifactDetails,
  projectPlanArtifactManifestItem,
  shortPlanArtifactId,
} from "../src/plan-artifact-manifest-model";
import type { PlanArtifactManifestState } from "../src/plan-artifact-manifest-types";
import { planCopy } from "../src/plan-copy";

describe("Plan artifact manifest model", () => {
  it("isolates every receipt to its owning artifact", () => {
    const state = artifactState({
      textPreview: receipt({
        artifactId: "artifact_current",
        text: "current",
      }) as unknown as PlanArtifactTextPreviewReceipt,
      dataProfile: receipt({
        artifactId: "artifact_other",
      }) as unknown as PlanArtifactDataProfileReceipt,
      driftCheck: receipt({
        artifactId: "artifact_current",
        result: "drifted",
      }) as unknown as PlanArtifactDriftCheckReceipt,
    });

    expect(planArtifactDetails("artifact_current", state)).toMatchObject({
      textPreview: { text: "current" },
      dataProfile: undefined,
      driftCheck: { result: "drifted" },
    });
    expect(planArtifactDetails("artifact_other", state)).toMatchObject({
      textPreview: undefined,
      dataProfile: { artifactId: "artifact_other" },
      driftCheck: undefined,
    });
  });

  it("projects verified drift follow-up copy and action", () => {
    const artifact = artifactFixture();
    const details = planArtifactDetails(
      artifact.id,
      artifactState({
        driftCheck: receipt({
          artifactId: artifact.id,
          result: "drifted",
        }) as unknown as PlanArtifactDriftCheckReceipt,
      }),
    );

    expect(projectPlanArtifactManifestItem(artifact, details)).toMatchObject({
      verifyLabel: planCopy.artifactActions.recheck,
      verifyingLabel: planCopy.artifactActions.rechecking,
      missingLabel: planCopy.artifactActions.markDrifted,
      markingMissingLabel: planCopy.artifactActions.markingDrifted,
      driftCheckAction: {
        canRecheck: false,
        canMarkDrifted: true,
        nextAction: "missing",
        hasAction: true,
      },
    });
  });

  it("does not expose drift follow-up for an unrelated receipt", () => {
    const artifact = artifactFixture();
    const details = planArtifactDetails(
      artifact.id,
      artifactState({
        driftCheck: receipt({
          artifactId: "artifact_other",
          result: "current",
        }) as unknown as PlanArtifactDriftCheckReceipt,
      }),
    );

    expect(
      projectPlanArtifactManifestItem(artifact, details).driftCheckAction,
    ).toEqual({
      canRecheck: false,
      canMarkDrifted: false,
      hasAction: false,
    });
  });

  it("shortens source identities without changing short values", () => {
    expect(shortPlanArtifactId("run_short")).toBe("run_short");
    expect(shortPlanArtifactId("run_artifact_1234567890")).toBe(
      "run_art...67890",
    );
  });
});

function artifactState(
  overrides: Partial<PlanArtifactManifestState> = {},
): PlanArtifactManifestState {
  return {
    busyId: undefined,
    error: undefined,
    fileDownload: undefined,
    fileVerification: undefined,
    textPreview: undefined,
    dataProfile: undefined,
    dataProfileVerification: undefined,
    directoryManifest: undefined,
    directoryManifestVerification: undefined,
    driftCheck: undefined,
    ...overrides,
  };
}

function artifactFixture(
  overrides: Partial<ArtifactManifestEntry> = {},
): ArtifactManifestEntry {
  return {
    id: "artifact_current",
    path: "artifacts/report.md",
    kind: "file",
    description: "Generated report.",
    status: "verified",
    evidence: "Verified from workspace bytes.",
    sha256: "a".repeat(64),
    sizeBytes: 128,
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    ...overrides,
  };
}

function receipt(value: Record<string, unknown>): Record<string, unknown> {
  return {
    ledgerEventId: "event_artifact",
    ledgerEventSeq: 7,
    ledgerEventSha256: "b".repeat(64),
    ...value,
  };
}
