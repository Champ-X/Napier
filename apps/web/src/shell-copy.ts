import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const shellCopyEn = {
  initialStates: {
    loadingAria: "Loading Napier",
    openingLedger: "Opening the ledger",
  },
  composer: {
    runOptions: "Run options",
    checkingRunOptions: "Checking run options...",
  },
  conversationFeed: {
    showEarlier: "Show earlier activity",
    copyMessage: "Copy",
    operator: "Operator",
    progressUpdate: "Progress update",
  },
  taskNarrative: {
    status: "Task status",
    controls: "Task controls",
    genericHarness: "Generic",
  },
} as const;

export const shellCopyZh: LocaleOverride<typeof shellCopyEn> = {
  initialStates: {
    loadingAria: "正在加载 Napier",
    openingLedger: "正在打开任务账本",
  },
  composer: {
    runOptions: "运行选项",
    checkingRunOptions: "正在检查运行选项……",
  },
  conversationFeed: {
    showEarlier: "显示更早内容",
    copyMessage: "复制",
    operator: "操作者",
    progressUpdate: "阶段进展",
  },
  taskNarrative: {
    status: "任务状态",
    controls: "任务控制",
    genericHarness: "通用",
  },
};

export const shellCopy = deepMergeCopy(
  shellCopyEn,
  getLocale() === "zh" ? shellCopyZh : {},
);
