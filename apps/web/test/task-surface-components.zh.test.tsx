import { parseHTML } from "linkedom";
import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExecutionPlan } from "@napier/contracts";
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
    const onOpenArtifact = vi.fn();

    render(
      <TaskCompletionSummary
        completedItems={["已验证交付", "已生成预览"]}
        plans={[]}
        activePlan={{ outputPaths: ["artifacts/report.md"] }}
        onOpenArtifact={onOpenArtifact}
      />,
      container,
    );
    const collapsedMarkup = container.textContent ?? "";
    const toggle = container.querySelector(
      '.task-completion-toggle[aria-expanded="false"]',
    ) as HTMLButtonElement;
    const primaryOutput = container.querySelector(
      ".task-completion-primary-output",
    ) as HTMLButtonElement;

    expect(collapsedMarkup).toContain("任务结果");
    expect(collapsedMarkup).toContain("已验证交付");
    expect(collapsedMarkup).toContain("2 项结果");
    expect(collapsedMarkup).toContain("report.md");
    expect(container.querySelector(".task-completion-details")).toBeNull();
    expect(collapsedMarkup).not.toContain("已生成预览");
    click(primaryOutput);
    expect(onOpenArtifact).toHaveBeenCalledWith("artifacts/report.md");

    click(toggle);
    await Promise.resolve();
    const expandedMarkup = container.textContent ?? "";
    expect(container.innerHTML).toContain('aria-label="任务输出"');
    expect(container.innerHTML).toContain('aria-expanded="true"');
    expect(expandedMarkup).toContain("完成事项");
    expect(expandedMarkup).toContain("已生成预览");
    expect(expandedMarkup).toContain("report.md");
    expect(expandedMarkup).not.toContain("Task result");
  });

  it("renders only measured task progress without inventing a percentage", async () => {
    const container = installChineseDom();
    const { TaskOverviewPanel } = await import("../src/TaskOverviewPanel");

    render(
      <TaskOverviewPanel
        detail={taskOverviewDetail()}
        goal={undefined}
        goalDraft=""
        modelConfigured
        decision={undefined}
        onGoalDraft={vi.fn()}
        onGoalSave={vi.fn()}
        onGoalClear={vi.fn()}
        onContinue={vi.fn()}
        onReviewDecision={vi.fn()}
      />,
      container,
    );

    const progress = container.querySelector(".task-overview-progress");
    expect(progress?.textContent).toContain("3 / 5");
    expect(progress?.textContent).toContain("3");
    expect(progress?.textContent).not.toContain("%");
    expect(container.innerHTML).not.toContain("width:");
  });

  it("renders the shared Artifact actions when an output resolves to a plan entry", async () => {
    const container = installChineseDom();
    const { default: TaskCompletionSummary } =
      await import("../src/TaskCompletionSummary");
    const plan = completionPlan();

    render(
      <TaskCompletionSummary
        completedItems={["已验证交付"]}
        plans={[plan]}
        activePlan={{ planId: plan.id, outputPaths: ["artifacts/report.md"] }}
        threadId="thread_1"
        onOpenArtifact={vi.fn()}
      />,
      container,
    );

    expect(
      container
        .querySelector(".task-completion-primary-output")
        ?.querySelector('[data-artifact-action="open"]'),
    ).not.toBeNull();
    click(container.querySelector(".task-completion-toggle")!);
    await Promise.resolve();
    expect(
      [
        ...container.querySelectorAll(
          ".task-completion-output [data-artifact-action]",
        ),
      ].map((button) => button.getAttribute("data-artifact-action")),
    ).toEqual(["open", "preview", "diff", "copy_path"]);
    expect(container.textContent).not.toContain("恢复");
    expect(container.textContent).not.toContain("应用");
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

function click(element: Element): void {
  element.dispatchEvent(new Event("click", { bubbles: true }));
}

function taskOverviewDetail() {
  return {
    thread: { title: "交付版本" },
    plans: [
      {
        id: "plan_1",
        threadId: "thread_1",
        objective: "交付版本",
        status: "active",
        steps: [],
        artifacts: [],
        replans: [],
        replanRecommendation: null,
        criticalPathStepIds: [],
        readyStepIds: [],
        blockedStepIds: [],
        phaseWaves: [],
        activePhaseIndex: null,
        parallelReadyStepIds: [],
        phaseProjectionSha256: "",
        revision: 1,
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
    ],
    activePlan: {
      objective: "交付版本",
      status: "active",
      completedStepCount: 3,
      stepCount: 5,
      verifiedArtifactCount: 2,
      producedArtifactCount: 1,
    },
  } as never;
}

function completionPlan(): ExecutionPlan {
  return {
    id: "plan_1",
    threadId: "thread_1",
    objective: "交付报告",
    status: "completed",
    steps: [],
    artifacts: [
      {
        id: "artifact_report",
        path: "artifacts/report.md",
        kind: "file",
        description: "交付报告",
        status: "verified",
        evidence: "已验证",
        createdAt: "2026-08-26T00:00:00.000Z",
        updatedAt: "2026-08-26T00:00:00.000Z",
      },
    ],
    replans: [],
    replanRecommendation: null,
    criticalPathStepIds: [],
    readyStepIds: [],
    blockedStepIds: [],
    phaseWaves: [],
    activePhaseIndex: null,
    parallelReadyStepIds: [],
    phaseProjectionSha256: "a".repeat(64),
    revision: 1,
    createdAt: "2026-08-26T00:00:00.000Z",
    updatedAt: "2026-08-26T00:00:00.000Z",
  };
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
