import { createHash } from "node:crypto";

import type { RunEvent } from "@napier/contracts";
import { skillProofEventSetSha256 } from "@napier/contracts/skill-lifecycle";
import { describe, expect, it } from "vitest";

import {
  skillLifecycleEventTraceSummary,
  skillLifecycleEventTraceView,
} from "../src/skill-lifecycle-event-view";
import { traceEventSummaryView } from "../src/trace-event-summary-view";

describe("Skill lifecycle Trace projection", () => {
  it("renders evidence-backed applied state without private Skill content", () => {
    const applicationMode = "software_change_verified" as const;
    const proofEventSeqs = [8, 11];
    const core = {
      kind: "napier.skill-lifecycle-projection" as const,
      schemaVersion: 1 as const,
      operation: "skill.lifecycle.project" as const,
      state: "applied" as const,
      skillName: "software-delivery",
      requestedNameSha256: hash("software-delivery"),
      source: "project" as const,
      rootKind: "project_standard" as const,
      candidateRootKinds: [],
      catalogSha256: "1".repeat(64),
      availabilitySetSha256: "2".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      contextSeq: 2,
      selectedSeq: 4,
      terminalSeq: 6,
      receiptContentSha256: "4".repeat(64),
      applicationMode,
      proofEventSeqs,
      proofEventSetSha256: skillProofEventSetSha256(
        applicationMode,
        proofEventSeqs,
      ),
    };
    const projection = {
      ...core,
      contentSha256: hash(canonical(core)),
    };
    const event = skillEvent(projection);

    expect(skillLifecycleEventTraceView(event)).toEqual(
      expect.objectContaining({
        skillName: "software-delivery",
        state: "applied",
        applicationMode,
        proofEventCount: 2,
      }),
    );
    expect(skillLifecycleEventTraceSummary(event)).toContain(
      "proof software_change_verified",
    );
    expect(traceEventSummaryView(event)).toMatchObject({
      source: "bounded",
      text: expect.stringContaining("state applied"),
    });
    expect(JSON.stringify(skillLifecycleEventTraceView(event))).not.toContain(
      "PRIVATE_SKILL_CONTENT",
    );
  });

  it("renders a catalog-bound unavailable state separately from failure", () => {
    const core = {
      kind: "napier.skill-lifecycle-projection" as const,
      schemaVersion: 1 as const,
      operation: "skill.lifecycle.project" as const,
      state: "unavailable" as const,
      skillName: "research-brief",
      requestedNameSha256: hash("research-brief"),
      source: "composite" as const,
      candidateRootKinds: ["project_standard", "user_standard"],
      catalogSha256: "1".repeat(64),
      availabilitySetSha256: "2".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      contextSeq: 2,
      failureContentSha256: "4".repeat(64),
    };
    const event = skillEvent({
      ...core,
      contentSha256: hash(canonical(core)),
    });

    expect(skillLifecycleEventTraceView(event)).toMatchObject({
      state: "unavailable",
      source: "composite",
      candidateRootKinds: ["project_standard", "user_standard"],
    });
    expect(skillLifecycleEventTraceSummary(event)).toContain(
      "state unavailable",
    );
  });
});

function skillEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_skill_lifecycle_12345678",
    threadId: "thread_skill_lifecycle_12345678",
    runId: "run_skill_lifecycle_12345678",
    seq: 12,
    type: "skill.lifecycle",
    category: "system",
    visibility: "user",
    createdAt: "2026-08-10T00:00:12.000Z",
    payload,
  };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
