import { parseHTML } from "linkedom";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RunRecord } from "@napier/contracts";
import type { RunRecoveryCheckpoint } from "@napier/contracts/manual-run-recovery";

import { RecoveryBanner } from "../src/RecoveryBanner";

vi.mock("lucide-react", () => ({
  RotateCcw: (props: Record<string, unknown>) => <svg {...props} />,
  Search: (props: Record<string, unknown>) => <svg {...props} />,
  ArrowRight: (props: Record<string, unknown>) => <svg {...props} />,
}));

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
          checkpoint={settledCheckpoint("run_partial")}
          running={false}
          modelConfigured
          onResume={onResume}
          onInspect={vi.fn()}
          onOpenWorkflow={vi.fn()}
        />,
        container,
      );
    });

    expect(container.textContent).toContain(
      "Continue from preserved work",
    );
    expect(container.textContent).toContain(
      "the original Agent capability boundary",
    );
    expect(container.textContent).not.toContain("interrupted");
    const button = findButton(container);
    expect(button.textContent).toContain("Continue task");
    button.click();
    expect(onResume).toHaveBeenCalledExactlyOnceWith(false);
    expect(container.querySelector(".recovery-stop")).toBeNull();
    expect(container.querySelector(".recovery-receipt")?.textContent).toContain("run_partial");
  });

  it("makes the failure reason available as escaped, collapsed text", async () => {
    const container = installDom();
    const error =
      'Run made no measurable progress. <script>alert("unsafe")</script>';
    await act(async () => {
      render(
        <RecoveryBanner
          run={{ ...run("partial"), error }}
          running={false}
          modelConfigured
          onResume={vi.fn()}
          onInspect={vi.fn()}
          onOpenWorkflow={vi.fn()}
        />,
        container,
      );
    });
    const details = container.querySelector(".recovery-stop");
    expect(details?.hasAttribute("open")).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toBe(
      "Why this run stopped",
    );
    expect(details?.querySelector("p")?.textContent).toBe(error);
    expect(details?.querySelector("script")).toBeNull();
  });

  it("offers read-only inspection for a paused-budget run without operation evidence", async () => {
    const container = installDom();
    const onResume = vi.fn();

    await act(async () => {
      render(
        <RecoveryBanner
          run={run("paused_budget")}
          running={false}
          modelConfigured
          onResume={onResume}
          onInspect={vi.fn()}
          onOpenWorkflow={vi.fn()}
        />,
        container,
      );
    });

    expect(container.textContent).toContain("Operation evidence is unavailable");
    expect(findButton(container).textContent).toContain("Inspect read-only");
    findButton(container).click();
    expect(onResume).toHaveBeenCalledExactlyOnceWith(true);
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
    if ("localName" in child && child.localName === "button" &&
      (child as HTMLButtonElement).classList.contains("recovery-primary")) {
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

function settledCheckpoint(runId: string): RunRecoveryCheckpoint {
  return {
    runId,
    sourceRunId: runId,
    throughSeq: 1,
    total: 0,
    omitted: 0,
    evidenceLimited: false,
    counts: { completed: 0, not_executed: 0, needs_reconciliation: 0, not_replayable: 0 },
    operations: [],
  };
}
