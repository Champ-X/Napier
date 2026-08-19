import { describe, expect, it } from "vitest";

import { BrowserInteractionConfirmationPanel } from "../src/BrowserInteractionConfirmationPanel";

describe("Browser interaction confirmation panel", () => {
  it("renders one-use hash-bound controls without private arguments", () => {
    const tree = BrowserInteractionConfirmationPanel({
      confirmation: {
        kind: "napier.browser-interaction-confirmation",
        schemaVersion: 1,
        id: "browser_confirm_abcdefghijklmnopqrst",
        threadId: "thread_browser_panel",
        runId: "run_browser_panel",
        callId: "call_browser_panel",
        action: "type",
        argumentsSha256: "a".repeat(64),
        preview: {
          targetKind: "selector",
          targetSha256: "d".repeat(64),
          effect: "data_entry",
          textSha256: "e".repeat(64),
          textBytes: 19,
          fileSha256: "1".repeat(64),
          fileBytes: 128,
          pageStateSha256: "2".repeat(64),
          sourceImageSha256: "f".repeat(64),
          crossOriginAuthorized: false,
        },
        status: "pending",
        requestedAt: "2026-08-04T00:00:00.000Z",
        expiresAt: "2026-08-04T00:01:00.000Z",
        requestSha256: "b".repeat(64),
        contentSha256: "c".repeat(64),
      },
      busy: false,
      onDecision: async () => undefined,
    });
    const serialized = JSON.stringify(tree);

    expect(serialized).toContain("Confirm");
    expect(serialized).toContain("type");
    expect(serialized).toContain("Enter data");
    expect(serialized).toContain("Effect");
    expect(serialized).toContain("Approve once");
    expect(serialized).toContain("Reject");
    expect(serialized).toContain("aaaaaaaaaaaa");
    expect(serialized).toContain("bbbbbbbbbbbb");
    expect(serialized).toContain("dddddddddddd");
    expect(serialized).toContain("eeeeeeeeeeee");
    expect(serialized).toContain("ffffffffffff");
    expect(serialized).toContain("111111111111");
    expect(serialized).toContain("222222222222");
    expect(serialized).toContain("File");
    expect(serialized).toContain("Page state");
    expect(serialized).toContain("Source image");
    expect(serialized).toContain("128");
    expect(serialized).toContain("19");
    expect(serialized).toContain("selector");
    expect(serialized).not.toContain("#PRIVATE_TARGET");
    expect(serialized).not.toContain("PRIVATE");
  });
});
