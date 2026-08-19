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
    messageActions: "Message actions",
    copyMessage: "Copy message",
    copyLink: "Copy link",
    operator: "Operator",
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
    messageActions: "消息操作",
    copyMessage: "复制消息",
    copyLink: "复制链接",
    operator: "操作者",
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
