import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

const en = {
  statusLabel: "Workbench status",
  runs: "Runs",
  events: "Events",
  plans: "Plans",
  model: "Model",
  ready: "Ready",
  unavailable: "Unavailable",
  toolsLabel: "Developer tool domains",
  descriptions: {
    lab: "Compare, evaluate and replay recorded runs.",
    compaction: "Inspect and test context compaction boundaries.",
    workflow: "Draft and verify executable plan workflows.",
    trial: "Bind a real run to the default-product casebook.",
  },
} as const;

const zh: LocaleOverride<typeof en> = {
  statusLabel: "工作台状态",
  runs: "运行",
  events: "事件",
  plans: "计划",
  model: "模型",
  ready: "就绪",
  unavailable: "不可用",
  toolsLabel: "开发工具分区",
  descriptions: {
    lab: "比较、评估并回放已记录的运行。",
    compaction: "检查与试验上下文压缩边界。",
    workflow: "起草并验证可执行计划工作流。",
    trial: "把真实运行绑定到默认产品案例册。",
  },
};

export const developerToolsCopy = deepMergeCopy(
  en,
  getLocale() === "zh" ? zh : {},
);
