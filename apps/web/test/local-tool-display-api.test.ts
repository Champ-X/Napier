import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import { getLocalToolDisplays } from "../src/local-tool-display-api";

afterEach(() => vi.unstubAllGlobals());

describe("local tool display API", () => {
  it("accepts a thread-bound private display list", async () => {
    const body = {
      kind: "napier.local-tool-display-list",
      schemaVersion: 1,
      threadId: "thread_local_display",
      records: [{
        kind: "napier.local-tool-display",
        schemaVersion: 1,
        sourceThreadId: "thread_local_display",
        sourceRunId: "run_local_display",
        callId: "call_local_display",
        toolName: "run_command",
        input: "npm test",
        output: "passed",
        contentSha256: "a".repeat(64),
      }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));

    await expect(getLocalToolDisplays("thread_local_display")).resolves.toEqual([
      expect.objectContaining({ callId: "call_local_display", output: "passed" }),
    ]);
  });

  it("rejects a response bound to another thread", async () => {
    const body = {
      kind: "napier.local-tool-display-list",
      schemaVersion: 1,
      threadId: "thread_other",
      records: [],
    };
    vi.stubGlobal("fetch", vi.fn(async () => response(body)));

    await expect(getLocalToolDisplays("thread_local_display")).rejects.toThrow(
      "Local tool display response is invalid",
    );
  });
});

function response(body: unknown): Response {
  const text = JSON.stringify(body);
  return new Response(text, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-napier-content-sha256": createHash("sha256").update(text).digest("hex"),
      "x-napier-content-sha256-mode": "body",
    },
  });
}
