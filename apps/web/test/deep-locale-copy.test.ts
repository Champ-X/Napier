import { describe, expect, it } from "vitest";

import { advancedSurfaceCopyEn } from "../src/advanced-surface-copy";
import { advancedSurfaceCopyZh } from "../src/advanced-surface-copy.zh";
import { agentMessageExperimentCopyEn } from "../src/agent-message-experiment-copy";
import { agentMessageExperimentCopyZh } from "../src/agent-message-experiment-copy.zh";
import {
  agentMilestoneCopyEn,
  agentMilestoneCopyZh,
} from "../src/agent-milestone-copy";
import { automationCopyEn } from "../src/automation-copy";
import { automationCopyZh } from "../src/automation-copy.zh";
import { composerCopyEn, composerCopyZh } from "../src/composer-copy";
import { contextCopyEn } from "../src/context-copy";
import { contextZh } from "../src/context-copy.zh";
import { en } from "../src/copy";
import { zh } from "../src/copy.zh";
import {
  conversationDetailCopyEn,
  conversationDetailZh,
} from "../src/conversation-detail-copy";
import { conversationActivityCopyEn } from "../src/conversation-activity-copy";
import { conversationActivityZh } from "../src/conversation-activity-copy.zh";
import { deepMergeCopy } from "../src/locale";
import {
  environmentSetupCopyEn,
  environmentSetupCopyZh,
} from "../src/environment-setup-copy";
import { extensionCopyEn } from "../src/extension-copy";
import { extensionCopyZh } from "../src/extension-copy.zh";
import { browserTaskCopyEn } from "../src/browser-task-copy";
import { browserTaskCopyZh } from "../src/browser-task-copy.zh";
import { browserLiveCopyEn } from "../src/browser-live-copy";
import { browserLiveCopyZh } from "../src/browser-live-copy.zh";
import { planCopyEn } from "../src/plan-copy";
import { planZh } from "../src/plan-copy.zh";
import {
  modelAdvisorReviewCopyEn,
  modelAdvisorReviewCopyZh,
} from "../src/model-advisor-review-copy";
import { modelInvocationExperimentCopyEn } from "../src/model-invocation-experiment-copy";
import { modelInvocationExperimentCopyZh } from "../src/model-invocation-experiment-copy.zh";
import {
  operatorDecisionCopyEn,
  operatorDecisionCopyZh,
} from "../src/operator-decision-copy";
import { recoveryCopyEn, recoveryCopyZh } from "../src/recovery-copy";
import {
  toolLoopGuardCopyEn,
  toolLoopGuardCopyZh,
} from "../src/tool-loop-guard-copy";
import { toolInvocationExperimentCopyEn } from "../src/tool-invocation-experiment-copy";
import { toolInvocationExperimentCopyZh } from "../src/tool-invocation-experiment-copy.zh";
import { workflowBreakpointCopyEn } from "../src/workflow-breakpoint-copy";
import { workflowBreakpointCopyZh } from "../src/workflow-breakpoint-copy.zh";
import { workflowExperimentCopyEn } from "../src/workflow-experiment-copy";
import { workflowExperimentCopyZh } from "../src/workflow-experiment-copy.zh";
import {
  workspaceFileCopyEn,
  workspaceFileCopyZh,
} from "../src/workspace-file-copy";
import { workspaceProcessCopyEn } from "../src/workspace-process-copy";
import { workspaceProcessCopyZh } from "../src/workspace-process-copy.zh";
import { shellCopyEn, shellCopyZh } from "../src/shell-copy";
import { taskSurfaceCopyEn, taskSurfaceZh } from "../src/task-surface-copy";
import {
  traceTrajectoryCopyEn,
  traceTrajectoryZh,
} from "../src/trace-trajectory-copy";
import {
  workspaceTreeCopyEn,
  workspaceTreeZh,
} from "../src/workspace-tree-copy";

const TECHNICAL_LITERAL_PATHS = new Set([
  "context.promptVariableNamePlaceholder",
  "context.promptVariableDateFormats.iso-date",
  "context.toolLoopGuardExemptPlaceholder",
  "context.skillContentPlaceholder",
  "context.environmentVariablePlaceholder",
  "context.keychainServicePlaceholder",
  "context.keychainAccountPlaceholder",
  "plan.digest",
  "environmentSetup.sandbox.toolchain",
  "browserTask.evidence.captcha",
]);

describe("deep locale copy", () => {
  it("provides an explicit Chinese value for every root and advanced-surface string", () => {
    const copySets: ReadonlyArray<readonly [string, unknown, unknown]> = [
      ["root", en, zh],
      ["advanced", advancedSurfaceCopyEn, advancedSurfaceCopyZh],
      ["composer", composerCopyEn, composerCopyZh],
      ["automation", automationCopyEn, automationCopyZh],
      ["extension", extensionCopyEn, extensionCopyZh],
      ["workspaceProcess", workspaceProcessCopyEn, workspaceProcessCopyZh],
      [
        "agentMessageExperiment",
        agentMessageExperimentCopyEn,
        agentMessageExperimentCopyZh,
      ],
      [
        "modelInvocationExperiment",
        modelInvocationExperimentCopyEn,
        modelInvocationExperimentCopyZh,
      ],
      [
        "toolInvocationExperiment",
        toolInvocationExperimentCopyEn,
        toolInvocationExperimentCopyZh,
      ],
      [
        "workflowExperiment",
        workflowExperimentCopyEn,
        workflowExperimentCopyZh,
      ],
      [
        "workflowBreakpoint",
        workflowBreakpointCopyEn,
        workflowBreakpointCopyZh,
      ],
      ["agentMilestone", agentMilestoneCopyEn, agentMilestoneCopyZh],
      [
        "modelAdvisorReview",
        modelAdvisorReviewCopyEn,
        modelAdvisorReviewCopyZh,
      ],
      ["operatorDecision", operatorDecisionCopyEn, operatorDecisionCopyZh],
      ["recovery", recoveryCopyEn, recoveryCopyZh],
      ["toolLoopGuard", toolLoopGuardCopyEn, toolLoopGuardCopyZh],
      ["workspaceFile", workspaceFileCopyEn, workspaceFileCopyZh],
    ];

    expect(
      copySets.flatMap(([prefix, english, override]) =>
        missingOverridePaths(prefix, english, override),
      ),
    ).toEqual([]);
  });

  it("covers every Context and Plan string without silent English fallback", () => {
    const contextCopyZh = deepMergeCopy(contextCopyEn, contextZh);
    const planCopyZh = deepMergeCopy(planCopyEn, planZh);
    const taskSurfaceCopyZh = deepMergeCopy(taskSurfaceCopyEn, taskSurfaceZh);
    const conversationDetailCopyZh = deepMergeCopy(
      conversationDetailCopyEn,
      conversationDetailZh,
    );
    const conversationActivityCopyZh = deepMergeCopy(
      conversationActivityCopyEn,
      conversationActivityZh,
    );
    const workspaceTreeCopyZh = deepMergeCopy(
      workspaceTreeCopyEn,
      workspaceTreeZh,
    );
    const traceTrajectoryCopyZh = deepMergeCopy(
      traceTrajectoryCopyEn,
      traceTrajectoryZh,
    );
    const shellCopyLocalized = deepMergeCopy(shellCopyEn, shellCopyZh);
    const environmentSetupCopyLocalized = deepMergeCopy(
      environmentSetupCopyEn,
      environmentSetupCopyZh,
    );
    const browserTaskCopyLocalized = deepMergeCopy(
      browserTaskCopyEn,
      browserTaskCopyZh,
    );
    const browserLiveCopyLocalized = deepMergeCopy(
      browserLiveCopyEn,
      browserLiveCopyZh,
    );
    const untranslated = [
      ...untranslatedPaths("context", contextCopyEn, contextCopyZh),
      ...untranslatedPaths("plan", planCopyEn, planCopyZh),
      ...untranslatedPaths("taskSurface", taskSurfaceCopyEn, taskSurfaceCopyZh),
      ...untranslatedPaths(
        "conversationDetail",
        conversationDetailCopyEn,
        conversationDetailCopyZh,
      ),
      ...untranslatedPaths(
        "conversationActivity",
        conversationActivityCopyEn,
        conversationActivityCopyZh,
      ),
      ...untranslatedPaths(
        "workspaceTree",
        workspaceTreeCopyEn,
        workspaceTreeCopyZh,
      ),
      ...untranslatedPaths(
        "traceTrajectory",
        traceTrajectoryCopyEn,
        traceTrajectoryCopyZh,
      ),
      ...untranslatedPaths("shell", shellCopyEn, shellCopyLocalized),
      ...untranslatedPaths(
        "environmentSetup",
        environmentSetupCopyEn,
        environmentSetupCopyLocalized,
      ),
      ...untranslatedPaths(
        "browserTask",
        browserTaskCopyEn,
        browserTaskCopyLocalized,
      ),
      ...untranslatedPaths(
        "browserLive",
        browserLiveCopyEn,
        browserLiveCopyLocalized,
      ),
    ].filter((path) => !TECHNICAL_LITERAL_PATHS.has(path));

    expect(untranslated).toEqual([]);
  });

  it("projects Chinese copy for ordinary plan, approval, and completion UI", () => {
    const localized = deepMergeCopy(taskSurfaceCopyEn, taskSurfaceZh);

    expect(localized.plan.allSettled).toBe("所有计划步骤均已结算");
    expect(localized.approval.guidance.pending).toBe(
      "继续运行前需要操作者输入。",
    );
    expect(localized.completion.title).toBe("任务结果");
  });

  it("projects Chinese copy for delegated work and durable evidence cards", () => {
    const localized = deepMergeCopy(
      conversationDetailCopyEn,
      conversationDetailZh,
    );

    expect(localized.subagent.outcomeSummary).toBe("结果摘要");
    expect(localized.artifact.statuses.verified).toBe("已验证");
    expect(localized.citation.guidance).toContain("来源权威性");
    expect(localized.recovery.blockReasons.unsafe_tool_effect).toContain(
      "副作用",
    );
  });

  it("projects Chinese copy for network, browser, and tool activity", () => {
    const localized = deepMergeCopy(
      conversationActivityCopyEn,
      conversationActivityZh,
    );

    expect(localized.network.search).toBe("网页搜索");
    expect(localized.browser.takeover).toContain("浏览器实时视图");
    expect(localized.browser.live.operator).toBe("操作者");
    expect(localized.tool.commandStatuses.output_capped).toBe("输出已截断");
    expect(localized.generic.labels.run).toBe("运行");
    expect(localized.generic.actions.no_progress).toBe("无进展");
  });

  it("projects Chinese copy for the workspace navigation states", () => {
    const localized = deepMergeCopy(workspaceTreeCopyEn, workspaceTreeZh);

    expect(localized.loadingSessions).toBe("正在加载会话……");
    expect(localized.loadSessionsError).toBe("无法加载会话");
    expect(localized.noSessions).toBe("暂无会话");
  });

  it("projects Chinese copy for trajectory controls and audit details", () => {
    const localized = deepMergeCopy(traceTrajectoryCopyEn, traceTrajectoryZh);

    expect(localized.timelineMap).toBe("时间线图谱");
    expect(localized.searchPlaceholder).toBe("查找动作或工具");
    expect(localized.audit.summary).toBe("摘要来源");
    expect(localized.statuses.interrupted).toBe("已中断");
  });

  it("projects Chinese copy for deep settings and Blueprint Library controls", () => {
    const contextCopyZh = deepMergeCopy(contextCopyEn, contextZh);
    const planCopyZh = deepMergeCopy(planCopyEn, planZh);

    expect(contextCopyZh.profile).toBe("智能体配置");
    expect(contextCopyZh.credentials).toBe("提供商凭证");
    expect(contextCopyZh.history).toBe("修订历史");
    expect(planCopyZh.title).toBe("持久计划");
    expect(planCopyZh.blueprint.library.title).toBe("模板库");
    expect(planCopyZh.blueprint.library.verifyOutcomes).toBe("验证结果");
  });

  it("projects Chinese copy for provider and Sandbox setup", () => {
    const localized = deepMergeCopy(
      environmentSetupCopyEn,
      environmentSetupCopyZh,
    );

    expect(localized.provider.title.pending).toBe("启用实时推理");
    expect(localized.provider.statuses.available.label).toBe("已找到");
    expect(localized.sandbox.statuses.buildable.action).toBe("构建并启用");
    expect(localized.sandbox.reviewRemoval).toBe("检查移除方案");
  });

  it("projects Chinese copy for Browser task, live control, and takeover", () => {
    const task = deepMergeCopy(browserTaskCopyEn, browserTaskCopyZh);
    const live = deepMergeCopy(browserLiveCopyEn, browserLiveCopyZh);

    expect(task.form.localDisclosure.title).toBe("可见的本地浏览器与人工接管");
    expect(task.form.actions.takeover).toBe("接管");
    expect(live.live.humanVerification).toBe("需要人工验证");
    expect(live.confirmation.approve).toBe("仅批准一次");
    expect(live.takeover.returnToAgent).toBe("交还智能体");
  });
});

function untranslatedPaths(
  prefix: string,
  english: unknown,
  localized: unknown,
): string[] {
  if (typeof english === "string") {
    return english === localized ? [prefix] : [];
  }
  if (!isRecord(english) || !isRecord(localized)) return [];
  return Object.keys(english).flatMap((key) =>
    untranslatedPaths(`${prefix}.${key}`, english[key], localized[key]),
  );
}

function missingOverridePaths(
  prefix: string,
  english: unknown,
  override: unknown,
): string[] {
  if (typeof english === "string") {
    return typeof override === "string" ? [] : [prefix];
  }
  if (!isRecord(english)) return [];
  const localized = isRecord(override) ? override : {};
  return Object.keys(english).flatMap((key) =>
    missingOverridePaths(`${prefix}.${key}`, english[key], localized[key]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
