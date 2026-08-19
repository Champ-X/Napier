import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const toolLoopGuardCopyEn = {
  eyebrow: "RUNTIME CIRCUIT BREAKER",
  title: "Tool loop redirects",
  empty: "No repeated tool loop has crossed the configured threshold.",
  attempts: "Repeats",
  range: "Evidence range",
  call: "Call",
  result: "Result",
  receipt: "Receipt",
} as const;

export const toolLoopGuardCopyZh: LocaleOverride<typeof toolLoopGuardCopyEn> = {
  eyebrow: "运行时熔断器",
  title: "工具循环改道",
  empty: "没有重复工具循环达到已配置阈值。",
  attempts: "重复次数",
  range: "证据范围",
  call: "调用",
  result: "结果",
  receipt: "回执",
};

export const toolLoopGuardCopy = deepMergeCopy(
  toolLoopGuardCopyEn,
  getLocale() === "zh" ? toolLoopGuardCopyZh : {},
);
