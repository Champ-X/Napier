import { createHash } from "node:crypto";

import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  skillLoadEventEvidence,
  skillLoadSummaryParts,
  skillResourceEventEvidence,
  skillResourceSummaryParts,
} from "../src/skill-load-event-view";
import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown): string => {
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
};
const withHash = <T extends Record<string, unknown>>(value: T) => ({
  ...value,
  contentSha256: hash(canonical(value)),
});

describe("Skill load Trace projection", () => {
  it("renders selected and loaded safe evidence without Skill content or paths", () => {
    const selected = withHash({
      kind: "napier.skill-load-selection",
      schemaVersion: 1,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "selected",
      name: "research-brief",
      requestedNameSha256: hash("research-brief"),
      source: "project",
      catalogSha256: "1".repeat(64),
      availabilitySetSha256: "2".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      inputSha256: hash(canonical({ name: "research-brief" })),
    });
    expect(skillLoadEventEvidence(selected)).toEqual({
      skillLoadName: "research-brief",
      skillLoadState: "selected",
      skillLoadSource: "project",
      skillLoadCatalogSha256: "1".repeat(64),
      skillLoadAvailabilitySetSha256: "2".repeat(64),
      skillLoadSnapshotManifestSha256: "3".repeat(64),
    });

    const loaded = withHash({
      kind: "napier.skill-load-receipt",
      schemaVersion: 1,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "loaded",
      name: "research-brief",
      requestedNameSha256: hash("research-brief"),
      source: "project",
      relativePath: "skills/research-brief/SKILL.md",
      sizeBytes: 123,
      lineCount: 9,
      rawContentSha256: "4".repeat(64),
      invocationSha256: "5".repeat(64),
      catalogSha256: "1".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
    });
    const view = toolEventTraceView(toolEvent(loaded));
    expect(view).toEqual(
      expect.objectContaining({
        skillLoadName: "research-brief",
        skillLoadState: "loaded",
        skillLoadReceiptSha256: loaded.contentSha256,
        skillLoadRawContentSha256: "4".repeat(64),
        skillLoadInvocationSha256: "5".repeat(64),
      }),
    );
    expect(skillLoadSummaryParts(view!)).toContain("skill research-brief");
    expect(toolEventTraceSummary(toolEvent(loaded))).toContain(
      `skill-receipt ${loaded.contentSha256.slice(0, 12)}`,
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE_SKILL_BODY");
    expect(JSON.stringify(view)).not.toContain("/Users/");
  });

  it("rejects malformed receipts instead of projecting attacker fields", () => {
    const malformed = {
      kind: "napier.skill-load-receipt",
      schemaVersion: 1,
      name: "research-brief",
      state: "loaded",
      absolutePath: "/Users/private/SKILL.md",
      content: "PRIVATE_SKILL_BODY",
    };
    expect(skillLoadEventEvidence(malformed)).toBeUndefined();
    expect(toolEventTraceView(toolEvent(malformed))).toEqual({
      toolName: "skill_load",
      status: "completed",
      effect: "read",
    });
  });

  it("renders V2 user roots and composite conflict candidates", () => {
    const loaded = withHash({
      kind: "napier.skill-load-receipt",
      schemaVersion: 2,
      operation: "skill.load",
      agentToolName: "skill_load",
      state: "loaded",
      name: "user-brief",
      requestedNameSha256: hash("user-brief"),
      source: "user",
      rootKind: "user_standard",
      relativePath: ".agents/skills/user-brief/SKILL.md",
      sizeBytes: 123,
      lineCount: 9,
      rawContentSha256: "4".repeat(64),
      invocationSha256: "5".repeat(64),
      catalogSha256: "1".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
    });
    const view = skillLoadEventEvidence(loaded);
    expect(view).toEqual(
      expect.objectContaining({
        skillLoadSource: "user",
        skillLoadRootKind: "user_standard",
      }),
    );
    expect(skillLoadSummaryParts(view!)).toContain("skill-root user_standard");

    const failure = withHash({
      kind: "napier.skill-load-failure",
      schemaVersion: 2,
      operation: "skill.load",
      agentToolName: "skill_load",
      source: "composite",
      subject: "skill_request",
      state: "unavailable",
      failureCode: "skill_ambiguous",
      requestedNameSha256: hash("shared-brief"),
      canonicalName: "shared-brief",
      candidateRootKinds: ["project_standard", "user_standard"],
      catalogSha256: "1".repeat(64),
      diagnosticSha256: "2".repeat(64),
    });
    const conflict = skillLoadEventEvidence(failure);
    expect(conflict).toEqual(
      expect.objectContaining({
        skillLoadSource: "composite",
        skillLoadCandidateRootKinds: ["project_standard", "user_standard"],
      }),
    );
    expect(skillLoadSummaryParts(conflict!)).toContain(
      "skill-candidates project_standard,user_standard",
    );
  });

  it("renders resource provenance without projecting private resource content", () => {
    const bindingInput = {
      skillName: "user-brief",
      resourcePath: "references/checklist.md",
      rawContentSha256: "4".repeat(64),
      catalogSha256: "1".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
    };
    const loaded = withHash({
      kind: "napier.skill-resource-load-receipt",
      schemaVersion: 1,
      operation: "skill.resource.load",
      agentToolName: "skill_resource",
      state: "loaded",
      skillName: "user-brief",
      requestedNameSha256: hash("user-brief"),
      source: "user",
      rootKind: "user_standard",
      resourcePath: "references/checklist.md",
      requestedResourcePathSha256: hash("references/checklist.md"),
      relativePath: ".agents/skills/user-brief/references/checklist.md",
      virtualPath: "/user/.agents/skills/user-brief/references/checklist.md",
      sizeBytes: 81,
      lineCount: 4,
      rawContentSha256: "4".repeat(64),
      catalogSha256: "1".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      resourceBindingSha256: hash(canonical(bindingInput)),
    });
    const event = toolEvent(loaded, "skill_resource");
    const view = toolEventTraceView(event);

    expect(skillResourceEventEvidence(loaded)).toEqual(
      expect.objectContaining({
        skillResourceName: "user-brief",
        skillResourcePath: "references/checklist.md",
        skillResourceState: "loaded",
        skillResourceSource: "user",
        skillResourceRootKind: "user_standard",
        skillResourceReceiptSha256: loaded.contentSha256,
      }),
    );
    expect(skillResourceSummaryParts(view!)).toContain(
      "resource-root user_standard",
    );
    expect(toolEventTraceSummary(event)).toContain(
      `resource-binding ${loaded.resourceBindingSha256.slice(0, 12)}`,
    );
    expect(JSON.stringify(view)).not.toContain("PRIVATE_RESOURCE_BODY");
    expect(JSON.stringify(view)).not.toContain("/Users/");

    const failure = withHash({
      kind: "napier.skill-resource-load-failure",
      schemaVersion: 1,
      operation: "skill.resource.load",
      agentToolName: "skill_resource",
      source: "composite",
      state: "failed",
      failureCode: "resource_untrusted",
      requestedNameSha256: hash("user-brief"),
      requestedResourcePathSha256: hash("references/checklist.md"),
      skillName: "user-brief",
      resourcePath: "references/checklist.md",
      candidateRootKinds: ["user_standard"],
      catalogSha256: "1".repeat(64),
      snapshotManifestSha256: "3".repeat(64),
      diagnosticSha256: "5".repeat(64),
    });
    const failureView = toolEventTraceView(
      toolEvent(failure, "skill_resource", "failed"),
    );
    expect(failureView).toEqual(
      expect.objectContaining({
        skillResourceState: "failed",
        skillResourceFailureCode: "resource_untrusted",
        skillResourceCandidateRootKinds: ["user_standard"],
      }),
    );
    expect(skillResourceSummaryParts(failureView!)).toContain(
      "resource-failure-code resource_untrusted",
    );
  });
});

function toolEvent(
  details: JsonValue,
  toolName = "skill_load",
  state: "completed" | "failed" = "completed",
): RunEvent {
  return {
    id: "event_skill_load_12345678",
    threadId: "thread_skillload12345678",
    runId: "run_skill_load_12345678",
    seq: 5,
    type: state === "completed" ? "tool.completed" : "tool.failed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-07T00:00:00.000Z",
    payload: {
      callId: "call_skill_load_12345678",
      toolName,
      status: state,
      effect: "read",
      details,
      output: "PRIVATE_SKILL_BODY",
    },
  };
}
