import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { emptyUsage, type RunEvent, type RunRecord } from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";
import { TaskValidationPanel } from "../src/TaskValidationPanel";
import { WorkbenchDeferredNotices } from "../src/WorkbenchDeferredPanels";
import { currentRunAttempt } from "../src/run-intent-id";

vi.mock("lucide-react", () => ({ BadgeCheck: () => null, Clock3: () => null }));

const parent: RunRecord = { id: "run_parent", threadId: "thread_fixture", agentId: "agent_fixture",
  source: "user", status: "completed", startedAt: "2026-10-29T00:00:00Z", usage: emptyUsage() };
const child: RunRecord = { ...parent, id: "run_child", source: "subagent", parentRunId: parent.id, status: "failed" };
const event = (runId: string, source: "user" | "subagent", seq: number): RunEvent => ({
  id: `event_${seq}`, threadId: parent.threadId, runId, seq, type: "run.started", category: "lifecycle",
  visibility: "debug", createdAt: parent.startedAt, payload: { source },
});

describe("primary execution in the workbench", () => {
  it("shows the primary settlement in the rendered validation panel", () => {
    const html = renderToStaticMarkup(<TaskValidationPanel detail={{ runs: [parent, child], events: [], plans: [] }} />);
    const parentHtml = renderToStaticMarkup(<TaskValidationPanel detail={{ runs: [parent], events: [], plans: [] }} />);
    expect(html).toBe(parentHtml);
  });

  it("keeps the main recovery notice reachable after child interruption", () => {
    const paused = { ...parent, status: "interrupted" as const };
    const vm = { detail: { runs: [paused, child] }, isRunning: false, resumableRun: paused,
      selectedModel: { configured: true }, resume: async () => undefined } as unknown as Parameters<typeof WorkbenchDeferredNotices>[0]["vm"];
    const view = WorkbenchDeferredNotices({ vm, onInspect() {}, onOpenWorkflow() {} });
    expect(view).not.toBeNull();
    const notice = view!.props.children as ReactElement<{ recovery: { run: RunRecord; canResume: boolean } }>;
    expect(notice.props.recovery.run.id).toBe(parent.id);
    expect(notice.props.recovery.canResume).toBe(true);
  });

  it("binds current artifacts to the primary attempt in Run and event-only snapshots", () => {
    const events = [event(parent.id, "user", 1), event(child.id, "subagent", 2)];
    const intents = new Map([[parent.id, "intent_parent0000"]]);
    expect(currentRunAttempt([parent, child], events, intents)).toEqual({ runId: parent.id, intentId: "intent_parent0000" });
    expect(currentRunAttempt([], events, intents)?.runId).toBe(parent.id);
    expect(currentRunAttempt([child], events, intents)).toBeUndefined();
  });
});
