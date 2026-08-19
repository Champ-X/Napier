import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const modelAdvisorReviewCopyEn = {
  eyebrow: "SECOND OPINION",
  title: "Independent turn reviews",
  empty: "No independent review receipt has been recorded for this Thread.",
  reviewer: "reviewer",
  score: "score",
  risk: "risk",
  issues: "issues",
  verification: "verification",
  verificationStates: {
    current: "current",
    stale: "stale",
    notCurrent: "not current",
    passed: "passed",
    notPassed: "not passed",
    missing: "missing",
  },
  diagnostics: "diagnostics",
  envelope: "envelope",
  receipt: "receipt",
  verdicts: {
    accept: "Accepted",
    revise: "Revision requested",
    block: "Blocked",
    inconclusive: "Inconclusive",
  },
} as const;

export const modelAdvisorReviewCopyZh: LocaleOverride<
  typeof modelAdvisorReviewCopyEn
> = {
  eyebrow: "独立意见",
  title: "独立轮次审查",
  empty: "此会话尚未记录独立审查回执。",
  reviewer: "审查模型",
  score: "评分",
  risk: "风险",
  issues: "问题",
  verification: "验证",
  verificationStates: {
    current: "当前",
    stale: "已过期",
    notCurrent: "非当前版本",
    passed: "通过",
    notPassed: "未通过",
    missing: "缺失",
  },
  diagnostics: "诊断",
  envelope: "信封",
  receipt: "回执",
  verdicts: {
    accept: "已接受",
    revise: "需要修订",
    block: "已阻止",
    inconclusive: "无结论",
  },
};

export const modelAdvisorReviewCopy = deepMergeCopy(
  modelAdvisorReviewCopyEn,
  getLocale() === "zh" ? modelAdvisorReviewCopyZh : {},
);
