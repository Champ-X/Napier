import { describe, expect, it } from "vitest";

import {
  assertBrowserConfirmationPageStateCurrent,
  BrowserConfirmedActionManager,
  createBrowserConfirmationPageState,
  MAX_PREPARED_BROWSER_ACTIONS,
} from "../src/browser-confirmed-action.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";

describe("Browser confirmed action authority", () => {
  it("consumes one exact Run/call/action/argument-bound page state", () => {
    const manager = new BrowserConfirmedActionManager();
    const owner = { threadId: "thread_confirm", runId: "run_confirm" };
    const request = {
      action: "click" as const,
      target: { ref: "e1" },
    };
    const pageState = confirmationState();
    const candidate = manager.prepare({
      owner,
      callId: "call_click",
      request,
      pageState,
    });
    manager.approve(candidate);

    expect(manager.consume({ owner, callId: "call_click", request })).toEqual(
      pageState,
    );
    expect(() =>
      manager.consume({ owner, callId: "call_click", request }),
    ).toThrow("unavailable");
  });

  it("rejects argument substitution, page drift, and cancelled grants", () => {
    const manager = new BrowserConfirmedActionManager();
    const owner = { threadId: "thread_confirm", runId: "run_confirm" };
    const request = {
      action: "type" as const,
      target: { ref: "e2" },
      text: "approved text",
    };
    const pageState = confirmationState();
    const substituted = manager.prepare({
      owner,
      callId: "call_type",
      request,
      pageState,
    });
    manager.approve(substituted);
    expect(() =>
      manager.consume({
        owner,
        callId: "call_type",
        request: { ...request, text: "changed text" },
      }),
    ).toThrow("unavailable");

    const cancelled = manager.prepare({
      owner,
      callId: "call_cancelled",
      request,
      pageState,
    });
    manager.approve(cancelled);
    manager.cancelRun(owner);
    expect(() =>
      manager.consume({ owner, callId: "call_cancelled", request }),
    ).toThrow("unavailable");

    const changed = confirmationState({
      targetStateSha256: sha256("changed target"),
    });
    expect(() =>
      assertBrowserConfirmationPageStateCurrent(pageState, changed),
    ).toThrow("page changed while confirmation was pending");
  });

  it("rejects state tampering and bounds prepared plus approved grants", () => {
    const manager = new BrowserConfirmedActionManager();
    const owner = { threadId: "thread_limit", runId: "run_limit" };
    const request = {
      action: "click" as const,
      target: { ref: "e1" },
    };
    const state = confirmationState();
    expect(() =>
      manager.prepare({
        owner,
        callId: "call_tampered",
        request,
        pageState: {
          ...state,
          targetStateSha256: sha256("tampered target"),
        },
      }),
    ).toThrow("page state is invalid");

    for (let index = 0; index < MAX_PREPARED_BROWSER_ACTIONS; index += 1) {
      const candidate = manager.prepare({
        owner,
        callId: `call_limit_${String(index)}`,
        request,
        pageState: state,
      });
      if (index % 2 === 0) manager.approve(candidate);
    }
    expect(() =>
      manager.prepare({
        owner,
        callId: "call_over_limit",
        request,
        pageState: state,
      }),
    ).toThrow("limit reached");
    manager.cancelRun(owner);
    expect(() =>
      manager.prepare({
        owner,
        callId: "call_after_cancel",
        request,
        pageState: state,
      }),
    ).not.toThrow();
  });
});

function confirmationState(
  overrides: Partial<
    Parameters<typeof createBrowserConfirmationPageState>[0]
  > = {},
) {
  return createBrowserConfirmationPageState({
    sessionOperation: 2,
    sessionIdSha256: "a".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    targetStateSha256: sha256("stable target"),
    targetEffect: "interaction",
    targetSensitivity: "ordinary",
    targetSensitivitySha256: sha256(canonicalJson([])),
    ...overrides,
  });
}
