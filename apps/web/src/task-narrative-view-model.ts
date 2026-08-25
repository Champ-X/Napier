import type { ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";
import { getLocale } from "./locale";
import {
  latestModelHarnessView,
  type ModelHarnessFamily,
} from "./model-harness-view";
import { taskRunProgress } from "./task-run-progress";

type TaskNarrativeProjection = NonNullable<ThreadDetail["taskNarrative"]>;
type TaskNarrativePhase = TaskNarrativeProjection["phase"];

export interface TaskNarrative extends TaskNarrativeProjection {
  elapsed?: string;
  metrics?: string;
  harness?: {
    family: ModelHarnessFamily;
    toolSurface: "full" | "focused";
    activeToolCount: number;
    configuredToolCount: number;
  };
}

export function taskNarrative(
  detail:
    | Pick<
        ThreadDetail,
        | "thread"
        | "runs"
        | "plans"
        | "events"
        | "operatorDecisions"
        | "automaticRecoveryAssessments"
        | "automaticRecoveryAttempts"
        | "taskNarrative"
      >
    | undefined,
  now = Date.now(),
): TaskNarrative {
  if (!detail)
    return localizeNarrative(
      baseNarrative("ready", "Ready", copy.narrative.emptyAction),
    );
  const projected = projectedNarrative(detail, now);
  const narrative = projected ?? legacyTaskNarrative(detail, now);
  const runId = detail.thread.currentRunId ?? detail.runs.at(-1)?.id;
  const harness = latestModelHarnessView(detail.events, runId);
  return localizeNarrative({
    ...narrative,
    ...(harness
      ? {
          harness: {
            family: harness.family,
            toolSurface: harness.toolSurface,
            activeToolCount: harness.activeToolCount,
            configuredToolCount: harness.configuredToolCount,
          },
        }
      : {}),
  });
}

// Server- and legacy-projected phase labels are English. Localize the label
// string itself (not the phase enum) so distinct labels like "Paused" vs
// "Partial" stay distinct; English locale passes through unchanged.
const PHASE_LABEL_ZH: Record<string, string> = {
  Ready: "就绪",
  Working: "运行中",
  Waiting: "等待中",
  Paused: "已暂停",
  Partial: "部分完成",
  Blocked: "受阻",
  "Needs review": "待复核",
  Settled: "已结算",
  Recovering: "恢复中",
  Recovered: "已恢复",
  "Recovery blocked": "恢复受阻",
  "Recovery failed": "恢复失败",
};

const NARRATIVE_TEXT_ZH: Record<string, string> = {
  "Review the failed run": "查看失败的运行",
  "Model is preparing the next action": "模型正在准备下一步动作",
  "Plan completed with recorded evidence": "计划已完成，证据已记录",
  "Latest run completed": "最近一次运行已完成",
  "Start a follow-up task or inspect the evidence.":
    "发起后续任务，或查看相关证据。",
  "Describe the task to begin": "描述任务即可开始",
  "Assessing the interrupted run": "正在评估中断的运行",
  "Automatic recovery stopped safely": "自动恢复已安全停止",
  "Review the Retry card or resume manually.": "查看重试卡片，或手动恢复运行。",
  "Waiting for a recovery claim": "正在等待恢复任务认领",
  "Claiming the interrupted run": "正在认领中断的运行",
  "Restoring from verified read-only evidence": "正在根据已验证的只读证据恢复",
  "Interrupted work recovered": "中断的工作已恢复",
  "Inspect the recovered output or start a follow-up task.":
    "查看恢复后的输出，或发起后续任务。",
  "Review the recovery attempt": "查看恢复尝试",
  "Partial result preserved at the budget boundary": "已在预算边界保留部分结果",
  "Run paused at its budget boundary": "运行已在预算边界暂停",
  "Continue from preserved artifacts and open work.":
    "从已保留的产物和未完成工作继续。",
  "Continue from the recorded progress.": "从已记录的进度继续。",
};

function localizeNarrative(narrative: TaskNarrative): TaskNarrative {
  if (getLocale() !== "zh") return narrative;
  return {
    ...narrative,
    phaseLabel: PHASE_LABEL_ZH[narrative.phaseLabel] ?? narrative.phaseLabel,
    currentAction: localizeNarrativeText(narrative.currentAction),
    ...(narrative.nextStep
      ? { nextStep: localizeNarrativeText(narrative.nextStep) }
      : {}),
  };
}

function localizeNarrativeText(value: string): string {
  const exact = NARRATIVE_TEXT_ZH[value];
  if (exact) return exact;
  const readyTitle = value.match(/^Ready to start: (.+)$/);
  if (readyTitle) return `可以开始：${readyTitle[1]}`;
  const attempt = value.match(/^Attempt (\d+)\/(\d+) is in progress\.$/);
  if (attempt) return `恢复尝试 ${attempt[1]}/${attempt[2]} 正在进行。`;
  return value;
}

function legacyTaskNarrative(
  detail: Pick<
    ThreadDetail,
    | "thread"
    | "runs"
    | "plans"
    | "events"
    | "operatorDecisions"
    | "automaticRecoveryAssessments"
    | "automaticRecoveryAttempts"
  >,
  now: number,
): TaskNarrative {
  const openDecision = detail.operatorDecisions.findLast(
    (decision) =>
      decision.status === "pending" || decision.status === "answered",
  );
  const plan = detail.plans.findLast(
    (candidate) =>
      candidate.status === "active" || candidate.status === "blocked",
  );
  const runningStep = plan?.steps.find((step) => step.status === "running");
  const blockedStep = plan?.steps.find((step) => step.status === "blocked");
  const nextStep = plan?.steps.find((step) => step.status === "ready");
  const planCompletedItems =
    plan?.steps
      .filter((step) => step.status === "completed")
      .slice(-3)
      .map((step) => step.title) ?? [];
  const narrativeRunId = detail.thread.currentRunId ?? detail.runs.at(-1)?.id;
  const runProgress = taskRunProgress(detail.events, narrativeRunId);
  const completedItems = completedNarrativeItems(
    planCompletedItems,
    runProgress.completedItems,
  );
  if (openDecision)
    return operatorDecisionNarrative(
      detail.runs,
      openDecision,
      completedItems,
      nextStep?.title,
      now,
    );
  const recovery = settlementNarrative(
    detail,
    completedItems,
    planCompletedItems.length > 0,
    now,
  );
  if (recovery) return recovery;
  if (blockedStep || detail.thread.status === "failed") {
    const failedRun = detail.runs.findLast((run) => run.status === "failed");
    const blocker =
      blockedStep?.blocker ||
      failedRun?.error ||
      "The latest run needs review.";
    return {
      phase: detail.thread.status === "failed" ? "failed" : "blocked",
      phaseLabel:
        detail.thread.status === "failed" ? "Needs review" : "Blocked",
      currentAction: blockedStep?.title ?? "Review the failed run",
      completedItems,
      ...(failedRun ? runMetrics(failedRun, now) : {}),
      blocker,
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }

  const running = detail.runs.find(
    (run) => run.id === detail.thread.currentRunId && run.status === "running",
  );
  if (running) {
    return {
      phase: "working",
      phaseLabel: "Working",
      currentAction:
        runningStep?.title ??
        runProgress.currentAction ??
        "Model is preparing the next action",
      completedItems,
      ...runMetrics(running, now),
      ...(nextStep ? { nextStep: nextStep.title } : {}),
    };
  }

  const completedPlan = detail.plans.findLast(
    (candidate) => candidate.status === "completed",
  );
  const completedRun = detail.runs.findLast(
    (run) => run.status === "completed",
  );
  if (completedPlan || completedRun) {
    return {
      phase: "completed",
      phaseLabel: "Settled",
      currentAction: completedPlan
        ? "Plan completed with recorded evidence"
        : "Latest run completed",
      completedItems:
        completedPlan?.steps
          .filter((step) => step.status === "completed")
          .slice(-3)
          .map((step) => step.title) ?? completedItems,
      ...(completedRun ? runMetrics(completedRun, now) : {}),
      nextStep: "Start a follow-up task or inspect the evidence.",
    };
  }
  return baseNarrative(
    "ready",
    "Ready",
    nextStep
      ? `Ready to start: ${nextStep.title}`
      : "Describe the task to begin",
  );
}

function projectedNarrative(
  detail: Pick<ThreadDetail, "runs" | "taskNarrative">,
  now: number,
): TaskNarrative | undefined {
  const narrative = detail.taskNarrative;
  if (!narrative) return undefined;
  const metricRun = narrative.metricRunId
    ? detail.runs.find((run) => run.id === narrative.metricRunId)
    : undefined;
  return {
    ...narrative,
    ...(metricRun ? runMetrics(metricRun, now) : {}),
  };
}

function operatorDecisionNarrative(
  runs: ThreadDetail["runs"],
  decision: ThreadDetail["operatorDecisions"][number],
  completedItems: string[],
  nextStep: string | undefined,
  now: number,
): TaskNarrative {
  const run = runs.find((candidate) => candidate.id === decision.runId);
  return {
    phase: "waiting",
    phaseLabel: "Waiting",
    currentAction: decision.header,
    completedItems,
    ...(run ? runMetrics(run, now) : {}),
    blocker:
      "The run has ended. Record an answer to unlock a linked continuation.",
    ...(nextStep ? { nextStep } : {}),
  };
}

function recoveryNarrative(
  detail: Pick<
    ThreadDetail,
    | "thread"
    | "runs"
    | "automaticRecoveryAssessments"
    | "automaticRecoveryAttempts"
    | "events"
  >,
  completedItems: string[],
  planItemsAreAuthoritative: boolean,
  now: number,
): TaskNarrative | undefined {
  const interrupted = detail.runs.findLast(
    (run) => run.status === "interrupted",
  );
  if (!interrupted) return undefined;
  const assessment = detail.automaticRecoveryAssessments.findLast(
    (candidate) => candidate.runId === interrupted.id,
  );
  const attempt = assessment
    ? detail.automaticRecoveryAttempts.findLast(
        (candidate) => candidate.assessmentSha256 === assessment.contentSha256,
      )
    : undefined;
  const recoveredItems = planItemsAreAuthoritative
    ? completedItems
    : mergeCompletedItems(
        taskRunProgress(detail.events, interrupted.id).completedItems,
        completedItems,
      );
  const latestRunId = detail.runs.at(-1)?.id;
  if (
    attempt?.recoveryRunId
      ? latestRunId !== attempt.recoveryRunId
      : latestRunId !== interrupted.id
  ) {
    return undefined;
  }
  if (!assessment && detail.thread.status === "waiting") {
    return {
      phase: "waiting",
      phaseLabel: "Recovering",
      currentAction: "Assessing the interrupted run",
      completedItems: recoveredItems,
      ...runMetrics(interrupted, now),
      blocker: "Recovery safety evidence is being evaluated.",
    };
  }
  if (assessment && !assessment.eligible) {
    return {
      phase: "blocked",
      phaseLabel: "Recovery blocked",
      currentAction: "Automatic recovery stopped safely",
      completedItems: recoveredItems,
      ...runMetrics(interrupted, now),
      blocker: `${assessment.blockReasons.length} safety condition${
        assessment.blockReasons.length === 1 ? "" : "s"
      } ${assessment.blockReasons.length === 1 ? "requires" : "require"} review.`,
      nextStep: "Review the Retry card or resume manually.",
    };
  }
  if (assessment?.eligible && !attempt && detail.thread.status === "waiting") {
    return {
      phase: "waiting",
      phaseLabel: "Recovering",
      currentAction: "Waiting for a recovery claim",
      completedItems: recoveredItems,
      ...runMetrics(interrupted, now),
      blocker: "The verified retry is waiting for its recovery worker.",
    };
  }
  if (attempt?.status === "claimed" || attempt?.status === "running") {
    const recoveryRun = attempt.recoveryRunId
      ? detail.runs.find((run) => run.id === attempt.recoveryRunId)
      : undefined;
    return {
      phase: "working",
      phaseLabel: "Recovering",
      currentAction:
        attempt.status === "claimed"
          ? "Claiming the interrupted run"
          : "Restoring from verified read-only evidence",
      completedItems: recoveredItems,
      ...runMetrics(recoveryRun ?? interrupted, now),
      nextStep: `Attempt ${attempt.attempt}/${attempt.maxAttempts} is in progress.`,
    };
  }
  if (attempt?.status === "completed") {
    const recoveryRun = attempt.recoveryRunId
      ? detail.runs.find((run) => run.id === attempt.recoveryRunId)
      : undefined;
    return {
      phase: "completed",
      phaseLabel: "Recovered",
      currentAction: "Interrupted work recovered",
      completedItems: recoveredItems,
      ...runMetrics(recoveryRun ?? interrupted, now),
      nextStep: "Inspect the recovered output or start a follow-up task.",
    };
  }
  if (
    attempt &&
    ["failed", "cancelled", "interrupted", "abandoned"].includes(attempt.status)
  ) {
    return {
      phase: "failed",
      phaseLabel: "Recovery failed",
      currentAction: "Review the recovery attempt",
      completedItems: recoveredItems,
      ...runMetrics(interrupted, now),
      blocker: `Attempt ${attempt.attempt}/${attempt.maxAttempts} ${attempt.status}.`,
      nextStep: "Review the Retry card or resume manually.",
    };
  }
  return undefined;
}

function settlementNarrative(
  detail: Parameters<typeof recoveryNarrative>[0],
  completedItems: string[],
  planItemsAreAuthoritative: boolean,
  now: number,
): TaskNarrative | undefined {
  return (
    pausedBudgetNarrative(detail.runs, completedItems, now) ??
    recoveryNarrative(detail, completedItems, planItemsAreAuthoritative, now)
  );
}

function pausedBudgetNarrative(
  runs: ThreadDetail["runs"],
  completedItems: string[],
  now: number,
): TaskNarrative | undefined {
  const run = runs.at(-1);
  if (run?.outcome !== "paused_budget" && run?.outcome !== "partial") {
    return undefined;
  }
  const partial = run.outcome === "partial";
  return {
    phase: "waiting",
    phaseLabel: partial ? "Partial" : "Paused",
    currentAction: partial
      ? "Partial result preserved at the budget boundary"
      : "Run paused at its budget boundary",
    completedItems,
    ...runMetrics(run, now),
    nextStep: partial
      ? "Continue from preserved artifacts and open work."
      : "Continue from the recorded progress.",
  };
}

function baseNarrative(
  phase: TaskNarrativePhase,
  phaseLabel: string,
  currentAction: string,
): TaskNarrative {
  return { phase, phaseLabel, currentAction, completedItems: [] };
}

function mergeCompletedItems(...sets: string[][]): string[] {
  return [...new Set(sets.flat())].slice(-3);
}

function completedNarrativeItems(
  planItems: string[],
  runItems: string[],
): string[] {
  return planItems.length > 0 ? planItems : runItems;
}

function runMetrics(
  run: ThreadDetail["runs"][number],
  now: number,
): Pick<TaskNarrative, "elapsed" | "metrics"> {
  const finishedAt = run.finishedAt ? Date.parse(run.finishedAt) : now;
  const elapsedMs = Math.max(0, finishedAt - Date.parse(run.startedAt));
  const tokens = run.usage.inputTokens + run.usage.outputTokens;
  const elapsed = formatDuration(elapsedMs);
  return {
    elapsed,
    metrics: [
      run.limits
        ? `${elapsed} / ${formatDuration(run.limits.timeoutMs)}`
        : elapsed,
      run.limits
        ? `${tokens.toLocaleString()} / ${run.limits.maxTotalTokens.toLocaleString()} tokens`
        : `${tokens.toLocaleString()} tokens`,
      run.limits
        ? `$${run.usage.costUsd.toFixed(4)} / $${run.limits.maxCostUsd.toFixed(2)}`
        : `$${run.usage.costUsd.toFixed(4)}`,
    ].join(" · "),
  };
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}
