import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const recoveryCopyEn = {
  eyebrow: "RECOVERY CHECKPOINT",
  title: "A run stopped before settlement.",
  body: "Resume with the interrupted Run's model, Agent revision, and capability boundary. Napier will verify durable evidence and current state before repeating any operation with possible side effects.",
  action: "Resume safely",
  run: "Interrupted run",
  failureReason: "Why this run stopped",
  partial: {
    eyebrow: "PARTIAL CHECKPOINT",
    title: "This task has preserved partial work.",
    body: "Your plan and existing results are saved. Continue this task to verify completed steps and finish the remaining work. If the same error recurs, review the failure reason before continuing.",
    action: "Continue this task",
    run: "Partial run",
  },
};

export const recoveryCopyZh: LocaleOverride<typeof recoveryCopyEn> = {
  eyebrow: "恢复检查点",
  title: "有一次运行在结算前停止。",
  body: "沿用中断运行的模型、Agent 版本与能力边界恢复。Napier 会先核对持久证据和当前状态，再重复任何可能有副作用的操作。",
  action: "安全恢复",
  run: "中断的运行",
  failureReason: "查看停止原因",
  partial: {
    eyebrow: "部分完成检查点",
    title: "此任务已保留部分工作。",
    body: "计划与已有结果已保存。继续此任务会先核对已完成步骤，再处理剩余工作。若相同错误再次发生，可查看停止原因，修复后继续。",
    action: "继续此任务",
    run: "部分完成的运行",
  },
};

export const recoveryCopy = deepMergeCopy(
  recoveryCopyEn,
  getLocale() === "zh" ? recoveryCopyZh : {},
);
