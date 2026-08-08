import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationRecoveryCard } from "../src/ConversationRecoveryCard";
import type { ConversationRecovery } from "../src/conversation-recovery-view-model";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("ConversationRecoveryCard", () => {
  it("renders the frozen timeout limit without exposing diagnostics", async () => {
    const container = installDom();
    await act(async () => {
      render(<ConversationRecoveryCard item={recovery()} />, container);
    });

    expect(container.textContent).toContain("Retry · Failed · 1/2");
    expect(container.textContent).toContain("Timeout · 5m 0s");
    expect(container.textContent).not.toContain("19m 53s");
    expect(container.textContent).not.toContain("PRIVATE_RECOVERY_ERROR");
  });
});

function recovery(): ConversationRecovery {
  return {
    id: "run_interrupted0001",
    seq: 10,
    createdAt: "2026-08-08T00:05:00.000Z",
    status: "failed",
    assessment: {
      contentSha256: "a".repeat(64),
      interruptedRunId: "run_interrupted0001",
      rootRunId: "run_interrupted0001",
      eligible: true,
      blockReasons: [],
      policy: { mode: "safe_read_only", maxAttempts: 2, backoffMs: 1_000 },
      toolCalls: {
        total: 2,
        readOnly: 2,
        unsafe: 0,
        unknownEffect: 0,
        unresolved: 0,
      },
      eventRange: {
        fromSeq: 1,
        toSeq: 8,
        eventCount: 8,
        eventStreamSha256: "b".repeat(64),
      },
      priorAttempts: 0,
      assessedAt: "2026-08-08T00:00:01.000Z",
    },
    attempt: {
      id: "recovery_fixture0001",
      status: "failed",
      attempt: 1,
      maxAttempts: 2,
      recoveryRunId: "run_recovery0001",
      revision: 3,
    },
    settlement: {
      budgetReason: "timeout",
      limit: 300_000,
      observedElapsedMs: 1_193_000,
    },
    eventIds: ["event_1", "event_2"],
  };
}

function installDom(): HTMLElement {
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}
