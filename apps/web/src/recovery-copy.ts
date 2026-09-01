import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const recoveryCopyEn = {
  eyebrow: "RECOVERY CHECKPOINT",
  title: "A run stopped before settlement.",
  body: "Resume with the interrupted Run's model, Agent revision, and capability boundary. Napier will verify durable evidence and current state before repeating any operation with possible side effects.",
  action: "Resume safely",
  run: "Interrupted run",
  partial: {
    eyebrow: "PARTIAL CHECKPOINT",
    title: "This task has preserved partial work.",
    body: "Continue this task from its durable plan, evidence, and artifacts. A normal message starts a new run instead.",
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
  partial: {
    eyebrow: "部分完成检查点",
    title: "此任务已保留部分工作。",
    body: "从持久计划、证据和 Artifact 继续此任务。普通消息会开始一次新运行。",
    action: "继续此任务",
    run: "部分完成的运行",
  },
};

export const recoveryCopy = deepMergeCopy(
  recoveryCopyEn,
  getLocale() === "zh" ? recoveryCopyZh : {},
);
