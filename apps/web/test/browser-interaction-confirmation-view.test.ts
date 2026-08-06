import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import {
  openBrowserInteractionConfirmation,
  parseBrowserInteractionConfirmation,
} from "../src/browser-interaction-confirmation-view";

describe("Browser interaction confirmation Web view", () => {
  it("projects one pending hash-only confirmation and closes it on decision", () => {
    const pending = confirmation("pending");
    expect(parseBrowserInteractionConfirmation(pending)).toEqual(pending);
    expect(
      openBrowserInteractionConfirmation([
        event(1, "browser.interaction_confirmation.pending", pending),
      ]),
    ).toEqual(pending);
    expect(
      openBrowserInteractionConfirmation([
        event(1, "browser.interaction_confirmation.pending", pending),
        event(
          2,
          "browser.interaction_confirmation.approved",
          confirmation("approved"),
        ),
      ]),
    ).toBeUndefined();
  });

  it("rejects malformed or content-bearing confirmation payloads", () => {
    expect(
      parseBrowserInteractionConfirmation({
        ...confirmation("pending"),
        selector: "#PRIVATE_SELECTOR",
      }),
    ).toBeUndefined();
    expect(
      parseBrowserInteractionConfirmation({
        ...confirmation("pending"),
        requestSha256: "not-a-hash",
      }),
    ).toBeUndefined();
    expect(
      parseBrowserInteractionConfirmation({
        ...confirmation("pending"),
        preview: {
          targetKind: "ref",
          targetSha256: "e".repeat(64),
          fileSha256: "f".repeat(64),
          crossOriginAuthorized: false,
        },
      }),
    ).toBeUndefined();
    expect(
      parseBrowserInteractionConfirmation({
        ...confirmation("pending"),
        action: "navigate",
      }),
    ).toBeUndefined();
    expect(
      openBrowserInteractionConfirmation([
        {
          ...event(
            1,
            "browser.interaction_confirmation.approved",
            confirmation("pending"),
          ),
          threadId: "thread_wrong",
        },
      ]),
    ).toBeUndefined();
  });
});

function confirmation(status: "pending" | "approved") {
  return {
    kind: "napier.browser-interaction-confirmation" as const,
    schemaVersion: 1 as const,
    id: "browser_confirm_abcdefghijklmnopqrst" as const,
    threadId: "thread_browser_confirmation",
    runId: "run_browser_confirmation",
    callId: "call_click_once",
    action: "click" as const,
    argumentsSha256: "a".repeat(64),
    preview: {
      targetKind: "ref" as const,
      targetSha256: "e".repeat(64),
      fileSha256: "f".repeat(64),
      fileBytes: 128,
      crossOriginAuthorized: false,
    },
    status,
    requestedAt: "2026-08-04T00:00:00.000Z",
    expiresAt: "2026-08-04T00:01:00.000Z",
    requestSha256: "b".repeat(64),
    ...(status === "approved"
      ? {
          decidedAt: "2026-08-04T00:00:10.000Z",
          decisionSha256: "c".repeat(64),
        }
      : {}),
    contentSha256: "d".repeat(64),
  };
}

function event(seq: number, type: string, payload: unknown): RunEvent {
  return {
    id: `event_browser_confirmation_${String(seq)}`,
    threadId: "thread_browser_confirmation",
    runId: "run_browser_confirmation",
    seq,
    type,
    category: "tool",
    visibility: "user",
    createdAt: "2026-08-04T00:00:00.000Z",
    payload: payload as RunEvent["payload"],
  };
}
