import {
  isSkillLifecycleProjectionV1,
  skillProofEventSetSha256,
} from "../src/skill-lifecycle.js";
import { canonical, sha256 } from "../src/skill-load-validation.js";
import { describe, expect, it } from "vitest";

describe("Skill lifecycle projection contract", () => {
  it("accepts source-bound loaded and evidence-backed applied states", () => {
    const loaded = seal({
      ...base(),
      state: "loaded" as const,
      source: "project" as const,
      rootKind: "project_standard" as const,
      selectedSeq: 10,
      terminalSeq: 12,
      receiptContentSha256: "4".repeat(64),
    });
    expect(isSkillLifecycleProjectionV1(loaded)).toBe(true);
    expect(
      isSkillLifecycleProjectionV1(
        seal({
          ...base(),
          state: "loaded" as const,
          source: "bundled" as const,
          rootKind: "bundled_standard" as const,
          selectedSeq: 10,
          terminalSeq: 12,
          receiptContentSha256: "4".repeat(64),
        }),
      ),
    ).toBe(true);

    const applicationMode = "software_change_verified" as const;
    const proofEventSeqs = [18, 24];
    const applied = seal({
      ...base(),
      state: "applied" as const,
      source: "project" as const,
      rootKind: "project_standard" as const,
      selectedSeq: 10,
      terminalSeq: 12,
      receiptContentSha256: "4".repeat(64),
      applicationMode,
      proofEventSeqs,
      proofEventSetSha256: skillProofEventSetSha256(
        applicationMode,
        proofEventSeqs,
      ),
    });
    expect(isSkillLifecycleProjectionV1(applied)).toBe(true);
    const observedMode = "software_change_observed" as const;
    expect(
      isSkillLifecycleProjectionV1(
        seal({
          ...base(),
          state: "applied" as const,
          source: "project" as const,
          rootKind: "project_standard" as const,
          selectedSeq: 10,
          terminalSeq: 12,
          receiptContentSha256: "4".repeat(64),
          applicationMode: observedMode,
          proofEventSeqs,
          proofEventSetSha256: skillProofEventSetSha256(
            observedMode,
            proofEventSeqs,
          ),
        }),
      ),
    ).toBe(true);
    expect(
      isSkillLifecycleProjectionV1({
        ...applied,
        proofEventSeqs: [24, 18],
      }),
    ).toBe(false);
  });

  it("accepts selected, unavailable, and failed states but rejects false proof", () => {
    expect(
      isSkillLifecycleProjectionV1(
        seal({
          ...base(),
          state: "selected" as const,
          source: "user" as const,
          rootKind: "user_standard" as const,
          selectedSeq: 10,
        }),
      ),
    ).toBe(true);
    expect(
      isSkillLifecycleProjectionV1(
        seal({
          ...base(),
          state: "unavailable" as const,
          source: "composite" as const,
          candidateRootKinds: ["project_standard", "user_standard"] as const,
          failureContentSha256: "5".repeat(64),
        }),
      ),
    ).toBe(true);
    expect(
      isSkillLifecycleProjectionV1(
        seal({
          ...base(),
          state: "failed" as const,
          source: "composite" as const,
          candidateRootKinds: ["project_standard", "user_standard"] as const,
          terminalSeq: 11,
          failureContentSha256: "5".repeat(64),
        }),
      ),
    ).toBe(true);
    expect(
      isSkillLifecycleProjectionV1(
        seal({
          ...base(),
          state: "loaded" as const,
          source: "project" as const,
          rootKind: "project_legacy" as const,
          selectedSeq: 10,
          terminalSeq: 11,
          receiptContentSha256: "4".repeat(64),
          applicationMode: "research_evidence_cited",
        }),
      ),
    ).toBe(false);
  });
});

function base() {
  return {
    kind: "napier.skill-lifecycle-projection" as const,
    schemaVersion: 1 as const,
    operation: "skill.lifecycle.project" as const,
    skillName: "software-delivery",
    requestedNameSha256: sha256("software-delivery"),
    candidateRootKinds: [] as const,
    catalogSha256: "1".repeat(64),
    availabilitySetSha256: "2".repeat(64),
    snapshotManifestSha256: "3".repeat(64),
    contextSeq: 2,
  };
}

function seal<T extends Record<string, unknown>>(value: T) {
  return { ...value, contentSha256: sha256(canonical(value)) };
}
