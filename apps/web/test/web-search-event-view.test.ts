import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  toolEventTraceSummary,
  toolEventTraceView,
} from "../src/tool-event-view";

describe("Web search event view", () => {
  it("renders search as a read tool without query or result bodies", () => {
    const event = toolEvent({
      callId: "call_search",
      toolName: "web_search",
      status: "completed",
      effect: "read",
      inputSha256: "a".repeat(64),
      query: "TOP_SECRET_SEARCH_QUERY",
      output: "TOP_SECRET_SEARCH_OUTPUT",
      details: {
        kind: "napier.web-search",
        schemaVersion: 1,
        provider: "bing",
        resultCount: 3,
        query: "TOP_SECRET_SEARCH_QUERY",
        url: "https://secret.example/result",
        snippet: "TOP_SECRET_SEARCH_SNIPPET",
      },
    });

    expect(toolEventTraceView(event)).toEqual({
      toolName: "web_search",
      status: "completed",
      effect: "read",
      inputSha256: "a".repeat(64),
    });
    expect(toolEventTraceSummary(event)).toBe(
      `tool / web_search / completed / effect read / input ${"a".repeat(12)}`,
    );
    expect(toolEventTraceSummary(event)).not.toContain("TOP_SECRET");
    expect(toolEventTraceSummary(event)).not.toContain("secret.example");
  });
});

function toolEvent(payload: RunEvent["payload"]): RunEvent {
  return {
    id: "event_search",
    threadId: "thread_search",
    runId: "run_search",
    seq: 9,
    type: "tool.completed",
    category: "tool",
    visibility: "user",
    payload,
    createdAt: "2026-08-04T12:00:00.000Z",
  };
}
