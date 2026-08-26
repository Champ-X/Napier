import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Tool Protocol event projection", () => {
  it("prefers the typed projection over legacy effect hints", () => {
    const event: RunEvent = {
      id: "event_tool_protocol",
      threadId: "thread_tool_protocol",
      runId: "runctl_tool_protocol",
      seq: 1,
      type: "tool.completed",
      category: "tool",
      visibility: "user",
      payload: {
        callId: "call_protocol",
        toolName: "workspace_file_apply",
        status: "completed",
        effect: "read",
        toolProtocol: {
          kind: "napier.tool-ui-projection",
          schemaVersion: 2,
          toolId: "workspace_file_apply",
          semanticVersion: "2.0.0",
          definitionSha256: "a".repeat(64),
          implementationSha256: "b".repeat(64),
          status: "completed",
          sideEffect: "reversible",
          concurrency: "exclusive",
          compatibilityMode: "native",
        },
      },
      createdAt: "2026-08-26T00:00:00.000Z",
    };

    expect(toolEventTraceView(event)).toEqual(
      expect.objectContaining({
        effect: "write",
        toolProtocolVersion: "2.0.0",
        toolDefinitionSha256: "a".repeat(64),
        toolImplementationSha256: "b".repeat(64),
        toolSideEffect: "reversible",
        toolConcurrency: "exclusive",
        toolCompatibilityMode: "native",
      }),
    );
    expect(toolEventTraceSummary(event)).toContain(
      `protocol v2.0.0 / side-effect reversible / concurrency exclusive / definition ${"a".repeat(12)} / native protocol`,
    );
  });
});
