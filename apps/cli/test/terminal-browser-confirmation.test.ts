import type { RunEvent } from "@napier/contracts";
import type { BrowserInteractionConfirmation } from "@napier/contracts/browser-interaction-confirmation";
import type { BrowserInteractionConfirmationManager } from "@napier/runtime/browser-interaction-confirmations";
import { describe, expect, it, vi } from "vitest";

import {
  browserInteractionConfirmationEvent,
  parseTerminalBrowserInteractionDecision,
  TerminalBrowserInteractionConfirmationController,
  terminalBrowserInteractionConfirmationLines,
} from "../src/terminal-browser-confirmation.js";

describe("terminal Browser interaction confirmation", () => {
  it("projects only bounded evidence and rejects malformed event identity", () => {
    const confirmation = fixture();
    const event = confirmationEvent(confirmation);

    expect(browserInteractionConfirmationEvent(event)).toEqual(confirmation);
    expect(
      browserInteractionConfirmationEvent({
        ...event,
        runId: "run_other_12345678",
      }),
    ).toBeUndefined();
    expect(
      browserInteractionConfirmationEvent({
        ...event,
        payload: { ...confirmation, privateSelector: "#PRIVATE_SELECTOR" },
      }),
    ).toBeUndefined();

    const rendered = terminalBrowserInteractionConfirmationLines(confirmation);
    expect(rendered).toEqual(
      expect.arrayContaining([
        "[confirm] Browser type paused before execution",
        "[confirm] request aaaaaaaaaaaa · arguments bbbbbbbbbbbb",
        "[confirm] target selector cccccccccccc",
        "[confirm] text 19B dddddddddddd",
        "[confirm] cross-origin no · expires 2026-08-05T00:01:00.000Z",
      ]),
    );
    expect(JSON.stringify(rendered)).not.toContain("PRIVATE_SELECTOR");
    expect(JSON.stringify(rendered)).not.toContain("PRIVATE_TEXT");
  });

  it("submits only exact approve or reject decisions with the request hash", async () => {
    const confirmation = fixture();
    const decide = vi.fn(async () => ({
      ...confirmation,
      status: "approved" as const,
      decidedAt: "2026-08-05T00:00:05.000Z",
      decisionSha256: "f".repeat(64),
    }));
    const controller = new TerminalBrowserInteractionConfirmationController({
      decide,
    } as unknown as BrowserInteractionConfirmationManager);

    expect(parseTerminalBrowserInteractionDecision(" APPROVE ")).toBe(
      "approve",
    );
    expect(parseTerminalBrowserInteractionDecision("yes")).toBeUndefined();
    expect(controller.submit("approve")).resolves.toBe("not_pending");

    expect(
      controller.applyEvent(confirmationEvent(confirmation)),
    ).toEqual(confirmation);
    expect(await controller.submit("yes")).toBe("invalid");
    expect(await controller.submit("approve")).toBe("submitted");
    expect(decide).toHaveBeenCalledWith(
      { threadId: confirmation.threadId, runId: confirmation.runId },
      confirmation.id,
      {
        decision: "approve",
        expectedRequestSha256: confirmation.requestSha256,
      },
    );
  });
});

function fixture(): BrowserInteractionConfirmation {
  return {
    kind: "napier.browser-interaction-confirmation",
    schemaVersion: 1,
    id: "browser_confirm_12345678",
    threadId: "thread_terminal_12345678",
    runId: "run_terminal_12345678",
    callId: "call_terminal_12345678",
    action: "type",
    argumentsSha256: "b".repeat(64),
    preview: {
      targetKind: "selector",
      targetSha256: "c".repeat(64),
      textSha256: "d".repeat(64),
      textBytes: 19,
      crossOriginAuthorized: false,
    },
    status: "pending",
    requestedAt: "2026-08-05T00:00:00.000Z",
    expiresAt: "2026-08-05T00:01:00.000Z",
    requestSha256: "a".repeat(64),
    contentSha256: "e".repeat(64),
  };
}

function confirmationEvent(
  confirmation: BrowserInteractionConfirmation,
): RunEvent {
  return {
    id: "event_terminal_confirmation",
    threadId: confirmation.threadId,
    runId: confirmation.runId,
    seq: 1,
    type: `browser.interaction_confirmation.${confirmation.status}`,
    category: "tool",
    visibility: "user",
    createdAt: confirmation.requestedAt,
    payload: JSON.parse(JSON.stringify(confirmation)),
  };
}
