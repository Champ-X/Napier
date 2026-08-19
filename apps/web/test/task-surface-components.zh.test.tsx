import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ConversationApproval } from "../src/conversation-approval-view-model";
import type { ConversationPlan } from "../src/conversation-plan-view-model";

const containers: HTMLElement[] = [];

describe("ordinary task surface Chinese copy", () => {
  afterEach(() => {
    containers.splice(0).forEach((container) => render(null, container));
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("renders plan and approval chrome without English fallback", async () => {
    const container = installChineseDom();
    const [{ ConversationPlanCard }, { ConversationApprovalCard }] =
      await Promise.all([
        import("../src/ConversationPlanCard"),
        import("../src/ConversationApprovalCard"),
      ]);

    render(
      <>
        <ConversationPlanCard item={planItem()} />
        <ConversationApprovalCard approval={approvalItem()} />
      </>,
      container,
    );
    const markup = container.textContent ?? "";

    expect(markup).toContain("当前 计划");
    expect(markup).toContain("下一步");
    expect(markup).toContain("证据已记录");
    expect(markup).not.toContain("Current Plan");
    expect(markup).toContain("审批 · 待处理");
    expect(markup).toContain("选择模式");
    expect(markup).toContain("继续运行前需要操作者输入");
    expect(markup).not.toContain("Multiple choices");
  });

  it("renders the task completion header and output action in Chinese", async () => {
    const container = installChineseDom();
    const { default: TaskCompletionSummary } =
      await import("../src/TaskCompletionSummary");

    render(
      <TaskCompletionSummary
        completedItems={["已验证交付"]}
        plans={[]}
        activePlan={{ outputPaths: ["artifacts/report.md"] }}
        onOpenArtifact={vi.fn()}
      />,
      container,
    );
    const markup = container.textContent ?? "";

    expect(markup).toContain("任务结果");
    expect(container.innerHTML).toContain('aria-label="任务输出"');
    expect(markup).toContain("输出 · artifacts/report.md");
    expect(markup).not.toContain("Task result");
  });
});

function installChineseDom(): HTMLElement {
  vi.resetModules();
  const { document, window } = parseHTML(
    "<!doctype html><html><body><div id=app></div></body></html>",
  );
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: { getItem: () => "zh" },
  });
  vi.stubGlobal("window", window);
  vi.stubGlobal("document", document);
  vi.stubGlobal("navigator", window.navigator);
  vi.stubGlobal("HTMLElement", window.HTMLElement);
  vi.stubGlobal("Event", window.Event);
  const container = document.getElementById("app") as unknown as HTMLElement;
  containers.push(container);
  return container;
}

function planItem(): ConversationPlan {
  return {
    id: "event_plan",
    seq: 1,
    createdAt: "2026-08-19T08:00:00.000Z",
    attemptScope: "current",
    plan: {
      id: "plan_1",
      status: "active",
      revision: 1,
      objective: "交付报告",
      steps: [
        {
          id: "inspect",
          title: "检查证据",
          status: "completed",
          evidenceRecorded: true,
        },
        {
          id: "publish",
          title: "发布报告",
          status: "ready",
          evidenceRecorded: false,
        },
      ],
      activePhaseIndex: 0,
      phaseCount: 1,
    },
    completedStepCount: 1,
    settledStepCount: 1,
    nextStep: {
      id: "publish",
      title: "发布报告",
      status: "ready",
      evidenceRecorded: false,
    },
    verifiedArtifactCount: 1,
    producedArtifactCount: 0,
    missingArtifactCount: 0,
  };
}

function approvalItem(): ConversationApproval {
  return {
    id: "approval_1",
    seq: 2,
    createdAt: "2026-08-19T08:01:00.000Z",
    selectedLabels: [],
    customAnswerRecorded: false,
    decision: {
      kind: "napier.operator-decision",
      schemaVersion: 1,
      id: "decision_12345678",
      threadId: "thread_12345678",
      runId: "run_12345678",
      status: "pending",
      header: "发布确认",
      question: "是否发布报告？",
      options: [
        { id: "approve", label: "发布", description: "继续交付。" },
        { id: "revise", label: "修改", description: "返回修改。" },
      ],
      multiSelect: true,
      questionSha256: "a".repeat(64),
      requestedAt: "2026-08-19T08:01:00.000Z",
      requestedEventSeq: 2,
      contentSha256: "b".repeat(64),
    },
  };
}
