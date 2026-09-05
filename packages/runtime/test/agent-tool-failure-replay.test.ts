import type { JsonObject, RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { replayedToolFailureReceipt } from "../src/agent-tool-failure-replay.js";
import { sha256 } from "../src/ed25519.js";

describe("Tool failure receipt replay", () => {
  it("restores only a receipt bound to the recorded declaration", () => {
    const definition = sha256("failure-definition");
    const event = failedEvent(definition, definition);
    expect(replayedToolFailureReceipt([event], "call_1")).toMatchObject({
      coverage: "trusted_declared",
      failureDefinitionSha256: definition,
    });
    expect(
      replayedToolFailureReceipt(
        [failedEvent(definition, sha256("other-definition"))],
        "call_1",
      ),
    ).toBeUndefined();
  });

  it("leaves historical untyped failures to the explicit legacy path", () => {
    const event = failedEvent(sha256("failure-definition"), undefined);
    event.payload["toolFailure"] = {
      class: "timeout",
      scope: "origin",
      disposition: "alternate_route",
      fatalToSession: false,
      diagnosticSha256: sha256("legacy"),
    };
    expect(replayedToolFailureReceipt([event], "call_1")).toBeUndefined();
  });
});

function failedEvent(
  expectedDefinition: string,
  receiptDefinition: string | undefined,
): RunEvent {
  const failure = receiptDefinition
    ? {
        kind: "napier.tool-failure-semantics",
        schemaVersion: 1,
        coverage: "trusted_declared",
        modeId: "route_network",
        class: "network",
        scope: "route",
        disposition: "alternate_route",
        fatalToSession: false,
        failureDefinitionSha256: receiptDefinition,
        bindingSha256: sha256("route"),
        diagnosticSha256: sha256("diagnostic"),
      }
    : {};
  return {
    id: "event_tool_failed",
    threadId: "thread_1",
    runId: "run_1",
    seq: 1,
    type: "tool.failed",
    category: "tool",
    visibility: "debug",
    createdAt: "2026-09-03T00:00:00.000Z",
    payload: {
      callId: "call_1",
      toolFailure: failure,
      toolProtocol: { failureDefinitionSha256: expectedDefinition },
    } as JsonObject,
    schemaVersion: 1,
  };
}
