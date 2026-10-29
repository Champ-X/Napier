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
import { artifactVersionKey } from "../src/artifact-version-binding";
import { planCopy } from "../src/plan-copy";

describe("Plan artifact manifest model", () => {
  it.each(["revision", "digest", "path", "evidence"])(
    "discards the prior receipt after a same-id %s change",
    (field) => {
      const selected = selection(artifactFixture());
      const state = artifactState({
        selectionKey: artifactVersionKey(selected),
        driftCheck: receipt({
          artifactId: selected.artifact.id,
          result: "drifted",
        }) as unknown as PlanArtifactDriftCheckReceipt,
      });
      const next = structuredClone(selected);
      if (field === "revision") next.planRevision += 1;
      else if (field === "digest") next.artifact.sha256 = "b".repeat(64);
      else if (field === "path") next.artifact.path = "other.md";
      else next.artifact.evidence = "New assertion";
      expect(planArtifactDetails(next, state).driftCheck).toBeUndefined();
    },
  );

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

    expect(
      planArtifactDetails(selection(artifactFixture()), state),
    ).toMatchObject({
      textPreview: { text: "current" },
      dataProfile: undefined,
      driftCheck: { result: "drifted" },
    });
    expect(
      planArtifactDetails(
        selection(artifactFixture({ id: "artifact_other" })),
        state,
      ),
    ).toMatchObject({
      textPreview: undefined,
      dataProfile: undefined,
      driftCheck: undefined,
    });
  });

  it("projects verified drift follow-up copy and action", () => {
    const artifact = artifactFixture();
    const details = planArtifactDetails(
      selection(artifact),
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
      selection(artifact),
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
    selectionKey: artifactVersionKey(selection(artifactFixture())),
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

function selection(artifact: ArtifactManifestEntry) {
  return { artifact, planId: "plan_1", planRevision: 1, threadId: "thread_1" };
}
