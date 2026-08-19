import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const agentMilestoneCopyEn = {
  eyebrow: "DURABLE PROGRESS",
  title: "Agent milestones",
  loading: "Reading milestone chain...",
  empty: "No milestone has been recorded for this Thread.",
  unavailable: "Milestone projection is temporarily unavailable.",
  completed: "completed",
  open: "open loops",
  evidence: "bound events",
  phases: {
    planning: "Planning",
    execution: "Execution",
    verification: "Verification",
    delivery: "Delivery",
  },
} as const;

export const agentMilestoneCopyZh: LocaleOverride<typeof agentMilestoneCopyEn> =
  {
    eyebrow: "持久进展",
    title: "智能体里程碑",
    loading: "正在读取里程碑链……",
    empty: "此会话尚未记录里程碑。",
    unavailable: "里程碑投影暂时不可用。",
    completed: "已完成",
    open: "个未决事项",
    evidence: "个绑定事件",
    phases: {
      planning: "规划",
      execution: "执行",
      verification: "验证",
      delivery: "交付",
    },
  };

export const agentMilestoneCopy = deepMergeCopy(
  agentMilestoneCopyEn,
  getLocale() === "zh" ? agentMilestoneCopyZh : {},
);
