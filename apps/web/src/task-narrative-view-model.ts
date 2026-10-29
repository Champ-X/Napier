import type { ThreadDetail } from "@napier/contracts";
import { copy } from "./copy";
import { getLocale } from "./locale";
import {
  latestModelHarnessView,
  type ModelHarnessFamily,
} from "./model-harness-view";
import { latestPrimaryRun, projectTaskNarrative } from "@napier/contracts/task-narrative";

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
  // Old snapshots replay the same Runtime projection. A legacy completed label
  // has no acceptance semantics and must be recomputed, not painted green.
  const legacy = detail.taskNarrative;
  const projection = legacy
    ? legacy.objective
      ? legacy
      : {
          ...legacy,
          ...(legacy.phase === "completed"
            ? {
                phase: "ended" as const,
                phaseLabel: "Run ended",
                currentAction: "Run ended; objective acceptance is unverified",
                execution: "ended" as const,
              }
            : {}),
          objective: {
            status: "unverified" as const,
            reason: "Legacy snapshot has no independent acceptance evidence.",
            evidence: [],
          },
        }
    : projectTaskNarrative(detail, detail.events);
  const narrative = projectedNarrative(
    { ...detail, taskNarrative: projection },
    now,
  )!;
  const runId = detail.thread.currentRunId ?? latestPrimaryRun(detail.runs)?.id;
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
  "Run ended": "本轮结束",
  "Work remains": "仍有待办",
  Recovering: "恢复中",
  Recovered: "已恢复",
  "Recovery blocked": "恢复受阻",
  "Recovery failed": "恢复失败",
};

const NARRATIVE_TEXT_ZH: Record<string, string> = {
  "Run ended; objective acceptance is unverified": "本轮结束，目标尚未验收",
  "This run ended; unfinished work remains": "本轮结束，仍有待完成事项",
  "Inspect the result and its verification evidence.": "查看成果及其验证证据。",
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
  "Partial result preserved after the run stopped": "运行停止，已保留部分结果",
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

function baseNarrative(
  phase: TaskNarrativePhase,
  phaseLabel: string,
  currentAction: string,
): TaskNarrative {
  return { phase, phaseLabel, currentAction, completedItems: [] };
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
      run.limits && run.limits.maxTotalTokens > 0
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
