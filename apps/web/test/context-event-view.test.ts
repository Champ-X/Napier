import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  contextEventTraceSummary,
  contextEventTraceView,
} from "../src/context-event-view";

describe("Context event trace view", () => {
  it("projects compaction checkpoints without summary prose", () => {
    const event = contextEvent("context.compaction.completed", {
      schemaVersion: 1,
      checkpointId: "checkpoint_1234567890",
      parentCheckpointId: "checkpoint_parent",
      fromSeq: 3,
      toSeq: 18,
      retainedFromSeq: 19,
      sourceEventCount: 16,
      sourceSha256: "a".repeat(64),
      summarySha256: "b".repeat(64),
      summary: "TOP_SECRET_COMPACTION_SUMMARY",
      decisions: ["TOP_SECRET_DECISION"],
      openLoops: ["TOP_SECRET_OPEN_LOOP", "another loop"],
      artifacts: ["TOP_SECRET_ARTIFACT"],
      contentSha256: "c".repeat(64),
    });

    expect(contextEventTraceView(event)).toEqual({
      action: "compaction.completed",
      schemaVersion: 1,
      fromSeq: 3,
      toSeq: 18,
      retainedFromSeq: 19,
      sourceEventCount: 16,
      checkpointId: "checkpoint_1234567890",
      parentCheckpointId: "checkpoint_parent",
      decisionCount: 1,
      openLoopCount: 2,
      artifactCount: 1,
      contentSha256: "c".repeat(64),
      sourceSha256: "a".repeat(64),
      summarySha256: "b".repeat(64),
    });
    expect(contextEventTraceSummary(event)).toBe(
      `context / compaction.completed / schema 1 / range 3-18 / retained 19 / events 16 / checkpoint 1234567890 / parent int_parent / decisions 1 / open-loops 2 / artifacts 1 / content ${"c".repeat(12)} / source ${"a".repeat(12)} / summary ${"b".repeat(12)}`,
    );
    expect(contextEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects compaction failures without error messages", () => {
    const event = contextEvent("context.compaction.failed", {
      fromSeq: 1,
      toSeq: 8,
      retainedFromSeq: 9,
      sourceEventCount: 8,
      fallbackMessageCount: 4,
      omittedMessageCount: 2,
      message: "TOP_SECRET_PROVIDER_ERROR",
      error: "TOP_SECRET_ERROR_ALIAS",
    });

    expect(contextEventTraceSummary(event)).toBe(
      "context / compaction.failed / range 1-8 / retained 9 / events 8 / fallback 4 / omitted 2",
    );
    expect(contextEventTraceSummary(event)).not.toContain("TOP_SECRET");
  });

  it("projects prompt and skill receipts without names or values", () => {
    const promptVariables = contextEvent("context.prompt_variables", {
      schemaVersion: 1,
      definitionCount: 2,
      referencedVariableCount: 1,
      referenceCount: 3,
      unresolvedReferenceCount: 1,
      skillCatalogInjected: true,
      entries: [
        {
          name: "TOP_SECRET_VARIABLE",
          type: "literal",
          valueSha256: "d".repeat(64),
        },
      ],
      catalogSha256: "e".repeat(64),
      renderedSystemPromptSha256: "f".repeat(64),
      unresolvedNameSetSha256: "0".repeat(64),
      contentSha256: "1".repeat(64),
    });
    const skills = contextEvent("context.skills", {
      schemaVersion: 1,
      requestedSkillNames: ["TOP_SECRET_REQUESTED"],
      loadedSkillNames: ["TOP_SECRET_LOADED"],
      missingSkillNames: ["TOP_SECRET_MISSING"],
      skills: [{ name: "TOP_SECRET_SKILL", body: "TOP_SECRET_BODY" }],
      skillCatalogSha256: "2".repeat(64),
      diagnosticsSha256: "3".repeat(64),
    });

    expect(contextEventTraceSummary(promptVariables)).toBe(
      `context / prompt_variables / schema 1 / definitions 2 / referenced 1 / references 3 / unresolved 1 / skill-catalog true / content ${"1".repeat(12)} / rendered-prompt ${"f".repeat(12)} / catalog ${"e".repeat(12)} / unresolved-names ${"0".repeat(12)}`,
    );
    expect(contextEventTraceSummary(skills)).toBe(
      `context / skills / schema 1 / skills 1 / requested 1 / loaded 1 / missing 1 / skill-catalog ${"2".repeat(12)} / diagnostics ${"3".repeat(12)}`,
    );
    expect(contextEventTraceSummary(promptVariables)).not.toContain("TOP_SECRET");
    expect(contextEventTraceSummary(skills)).not.toContain("TOP_SECRET");
  });

  it("fails closed for malformed and unknown context receipts", () => {
    expect(
      contextEventTraceSummary(
        contextEvent("context.compaction.completed", ["TOP_SECRET_SUMMARY"]),
      ),
    ).toBe("context receipt");
    expect(
      contextEventTraceSummary(
        contextEvent("context.unknown", { summary: "TOP_SECRET_SUMMARY" }),
      ),
    ).toBe("system");
  });
});

function contextEvent(type: string, payload: RunEvent["payload"]): RunEvent {
  return {
    id: `event_${type.replaceAll(".", "_")}`,
    threadId: "thread_context",
    runId: "runctl_context",
    seq: 27,
    type,
    category: "system",
    visibility: "debug",
    payload,
    createdAt: "2026-07-28T12:00:00.000Z",
  };
}
