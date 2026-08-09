import { createHash } from "node:crypto";

import type { JsonValue, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  skillLoadEventEvidence,
  skillLoadSummaryParts,
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
});

function toolEvent(details: JsonValue): RunEvent {
  return {
    id: "event_skill_load_12345678",
    threadId: "thread_skillload12345678",
    runId: "run_skill_load_12345678",
    seq: 5,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-07T00:00:00.000Z",
    payload: {
      callId: "call_skill_load_12345678",
      toolName: "skill_load",
      status: "completed",
      effect: "read",
      details,
      output: "PRIVATE_SKILL_BODY",
    },
  };
}
