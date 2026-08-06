import { describe, expect, it } from "vitest";

import { remapImportedEventPayload } from "../src/thread-import-event-payload.js";

describe("Web Fetch save private Source import boundary", () => {
  it("strips local-only Source state from imported save completions", () => {
    const payload = remapImportedEventPayload(
      "tool.completed",
      {
        callId: "save_12345678",
        toolName: "web_fetch_save",
        status: "completed",
        details: {
          kind: "napier.web-fetch-save",
          schemaVersion: 1,
          fileSha256: "a".repeat(64),
          sourceContentSha256: "b".repeat(64),
          stateCapsule: {
            kind: "napier.web-fetch-state-capsule-receipt",
            schemaVersion: 1,
            sourceRunId: "run_source1234",
            sourceCount: 1,
            sourceSetSha256: "c".repeat(64),
            manifestCapsuleSha256: "d".repeat(64),
            manifestCapsuleBytes: 512,
            storage: "local_only",
            contentSha256: "e".repeat(64),
          },
        },
      },
      new Map(),
    );

    expect(payload).toEqual(
      expect.objectContaining({
        toolName: "web_fetch_save",
        details: expect.not.objectContaining({
          stateCapsule: expect.anything(),
        }),
      }),
    );
  });
});
