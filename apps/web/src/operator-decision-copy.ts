import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const operatorDecisionCopyEn = {
  eyebrow: "Operator docket",
  waiting: "Waiting for your decision",
  answered: "Answer recorded",
  runSettled:
    "The previous run is complete. Record the answer, then start its linked continuation.",
  customAnswer: "Other direction",
  optional: "Optional",
  customPlaceholder: "Add a precise answer or constraint...",
  submit: "Record answer",
  continue: "Continue run",
  workflowResume:
    "Answer recorded. Resume this Workflow with its original Manifest.",
  cancel: "Cancel decision",
  multiSelect: "Select one or more",
  singleSelect: "Select one",
  receipt: "Answer receipt",
} as const;

export const operatorDecisionCopyZh: LocaleOverride<
  typeof operatorDecisionCopyEn
> = {
  eyebrow: "操作决策",
  waiting: "等待你的决定",
  answered: "答案已记录",
  runSettled: "上一轮运行已结束；先记录选择，再启动关联续跑。",
  customAnswer: "其他方向",
  optional: "选填",
  customPlaceholder: "补充准确的答案或约束……",
  submit: "记录答案",
  continue: "继续运行",
  workflowResume: "答案已记录。请使用原始 Manifest 恢复此工作流。",
  cancel: "取消决策",
  multiSelect: "选择一项或多项",
  singleSelect: "选择一项",
  receipt: "答案回执",
};

export const operatorDecisionCopy = deepMergeCopy(
  operatorDecisionCopyEn,
  getLocale() === "zh" ? operatorDecisionCopyZh : {},
);
