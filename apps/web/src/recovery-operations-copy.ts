import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

const en = {
  title: "Continue from preserved work",
  inspectHint:
    "Inspect the current workspace with local read-only tools. Pending writes stay pending; unknown external effects still need reconciliation.",
  continueHint:
    "Continue from this checkpoint with the selected model and the original Agent capability boundary. The model may perform new work.",
  decisionHint:
    "This run is waiting for a decision. Review the saved answer or provide one at the decision panel before continuing.",
  workflowHint:
    "Continue through the Workflow plan so node checkpoints and saved approvals remain bound to their original requests.",
  facts: "Operation records",
  historical:
    "These are saved ledger facts. Current files, permissions and private recovery evidence are checked again by automatic recovery. A settled operation does not verify the whole task.",
  empty:
    "No tool starts were recorded. This does not prove that all intended work ran.",
  missing:
    "Operation evidence is unavailable. Inspect the trajectory before choosing the next action.",
  limited:
    "The evidence is incomplete or exceeds the inspection limit. No operation classification is claimed.",
  omitted:
    "Additional operations are omitted from this list; totals include them. Open the trajectory for the complete history.",
  receipt: "Checkpoint receipt",
  throughSeq: "Through event",
  inspectTrace: "Open trajectory",
  inspectReadOnly: "Inspect read-only",
  continueTask: "Continue task",
  openDecision: "Review decision",
  openWorkflow: "View plan overview",
  starting: "Starting…",
  statuses: {
    completed: "Settled",
    not_executed: "Not committed",
    needs_reconciliation: "Needs reconciliation",
    not_replayable: "No automatic replay",
  },
  reasons: {
    patch_settled:
      "Patch settlement recorded; the current file has not been rechecked here.",
    patch_reconciled:
      "Target commit was independently reconciled. Post-write diagnostics may be missing.",
    patch_not_committed:
      "The original target commit was fenced and confirmed absent. Parent directories may remain. Execution still requires the verified-patch policy and fresh checks.",
    read_completed:
      "Read result recorded. It may no longer describe current state.",
    read_stopped:
      "The read stopped or failed. A new inspection can read current state.",
    effect_unresolved:
      "The effect is unknown or may be partial. Do not repeat it without reconciliation.",
    effect_not_replayable:
      "A tool result was recorded; automatic replay is unsupported for this effect.",
    evidence_missing:
      "The call binding is missing or conflicting; its outcome is unknown.",
  },
};
const zh: LocaleOverride<typeof en> = {
  title: "从保留的工作继续",
  inspectHint:
    "使用本地只读工具核查当前工作区。待写操作保持待执行；未知的外部副作用仍需对账。",
  continueHint:
    "使用所选模型和原 Agent 能力边界，从此检查点继续。模型可以执行后续工作。",
  decisionHint:
    "此运行正在等待决策。请前往决策区查看已保存的答案或作出选择，再继续。",
  workflowHint:
    "请从 Workflow 计划继续，保留节点检查点和原请求绑定的审批答案。",
  facts: "操作记录",
  historical:
    "以下为账本中的历史事实。自动恢复会重新检查当前文件、权限和私有证据；操作已结算不代表整个任务已完成。",
  empty: "没有记录到工具开始事件，不能据此认定所有预期工作都已执行。",
  missing: "操作证据不可用。请查看执行轨迹后决定下一步。",
  limited: "证据不完整或超出检查上限，暂不判定各操作结果。",
  omitted: "此列表省略了其余操作，统计仍包含它们。完整历史可在执行轨迹中查看。",
  receipt: "检查点收据",
  throughSeq: "证据截至事件",
  inspectTrace: "查看执行轨迹",
  inspectReadOnly: "只读核查",
  continueTask: "继续任务",
  openDecision: "查看决策",
  openWorkflow: "查看计划概览",
  starting: "正在启动…",
  statuses: {
    completed: "已结算",
    not_executed: "确认未提交",
    needs_reconciliation: "需要对账",
    not_replayable: "不可自动重放",
  },
  reasons: {
    patch_settled: "已记录补丁结算，此处尚未重新核查当前文件。",
    patch_reconciled: "已独立核对目标提交，写后诊断可能缺失。",
    patch_not_committed:
      "原执行已被封锁，已确认目标未提交；父目录可能已创建。执行仍需已验证补丁策略与现场检查。",
    read_completed: "已记录读取结果，内容可能不再反映当前状态。",
    read_stopped: "读取中断或失败，可重新核查当前状态。",
    effect_unresolved: "副作用未知或可能部分完成，对账前不能重复执行。",
    effect_not_replayable: "已有工具结果记录，此类副作用尚不支持自动重放。",
    evidence_missing: "调用绑定缺失或冲突，无法确认结果。",
  },
};
export const recoveryOperationsCopy = deepMergeCopy(
  en,
  getLocale() === "zh" ? zh : {},
);
