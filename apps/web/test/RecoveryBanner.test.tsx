import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunRecord } from "@napier/contracts";

import { RecoveryBanner } from "../src/RecoveryBanner";

const containers: HTMLElement[] = [];

afterEach(async () => {
  await Promise.all(
    containers.splice(0).map(async (container) => {
      await act(async () => render(null, container));
    }),
  );
  vi.unstubAllGlobals();
});

describe("RecoveryBanner", () => {
  it("offers an explicit task continuation for preserved partial work", async () => {
    const container = installDom();
    const onResume = vi.fn();

    await act(async () => {
      render(
        <RecoveryBanner
          run={run("partial")}
          running={false}
          modelConfigured
          onResume={onResume}
        />,
        container,
      );
    });

    expect(container.textContent).toContain(
      "This task has preserved partial work.",
    );
    expect(container.textContent).toContain(
      "A normal message starts a new run instead.",
    );
    expect(container.textContent).not.toContain("interrupted");
    const button = findButton(container);
    expect(button.textContent).toContain("Continue this task");
    button.click();
    expect(onResume).toHaveBeenCalledOnce();
  });

  it("preserves the paused-budget recovery action", async () => {
    const container = installDom();

    await act(async () => {
      render(
        <RecoveryBanner
          run={run("paused_budget")}
          running={false}
          modelConfigured
          onResume={vi.fn()}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("A run stopped before settlement.");
    expect(findButton(container).textContent).toContain("Resume safely");
  });
});

function run(outcome: "partial" | "paused_budget"): RunRecord {
  return {
    id: `run_${outcome}`,
    threadId: "thread_manual_recovery",
    agentId: "agent_manual_recovery",
    status: "failed",
    outcome,
    source: "user",
    startedAt: "2026-08-17T00:00:00.000Z",
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0,
    },
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

function findButton(root: Node): HTMLButtonElement {
  for (const child of Array.from(root.childNodes)) {
    if ("localName" in child && child.localName === "button") {
      return child as HTMLButtonElement;
    }
    try {
      return findButton(child);
    } catch {
      // Continue through sibling nodes.
    }
  }
  throw new Error("Recovery button not found");
}
