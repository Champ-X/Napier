import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

export const operatorDecisionCopyEn = {
  waiting: "Waiting for your decision",
  answered: "Answer recorded",
  runSettled:
    "Choose an answer to continue this task. Your answer is saved before the task resumes.",
  workflowHint: "Save your answer, then resume the workflow from its controls.",
  customAnswer: "Other direction",
  optional: "Optional",
  customPlaceholder: "Add a precise answer or constraint...",
  submit: "Answer and continue",
  saveOnly: "Save answer only",
  saving: "Saving answer…",
  savedReady: "Your answer was saved. Select Continue run to resume.",
  continuing: "Continuing…",
  cancelling: "Cancelling…",
  chooseAnswer: "Choose an option or write an answer before continuing.",
  answerTooLong: "This answer is too long. Shorten it to 4 KiB or less.",
  answerUnavailable:
    "The saved answer is unavailable. Refresh this task before continuing.",
  saveUnconfirmed:
    "We could not confirm that your answer was saved. Your input is kept; retry to confirm and continue.",
  continueFailed:
    "Your answer is saved. Continuing could not be confirmed; retry or check this task's recovery options.",
  cancelFailed: "The decision could not be cancelled. Please retry.",
  continue: "Continue run",
  workflowResume: "Answer saved. Resume this workflow from its controls.",
  cancel: "Cancel decision",
  multiSelect: "Select one or more",
  singleSelect: "Select one",
  receipt: "Answer details",
} as const;

export const operatorDecisionCopyZh: LocaleOverride<
  typeof operatorDecisionCopyEn
> = {
  waiting: "等待你的决定",
  answered: "答案已记录",
  runSettled: "选择答案后继续当前任务。答案会先保存，再启动续跑。",
  workflowHint: "先保存答案，再从工作流操作区继续。",
  customAnswer: "其他方向",
  optional: "选填",
  customPlaceholder: "补充准确的答案或约束……",
  submit: "回答并继续",
  saveOnly: "仅保存答案",
  saving: "正在保存答案…",
  savedReady: "已确认答案保存成功，请点击继续运行。",
  continuing: "正在继续…",
  cancelling: "正在取消…",
  chooseAnswer: "请先选择一项，或填写其他方向。",
  answerTooLong: "答案过长，请缩短至 4 KiB 以内。",
  answerUnavailable: "暂时无法读取已保存的答案，请刷新当前任务后继续。",
  saveUnconfirmed:
    "暂时无法确认答案是否已保存。输入已保留，请重试以确认并继续。",
  continueFailed:
    "答案已保存，但暂时无法确认续跑状态。可以重试，或查看当前任务的恢复选项。",
  cancelFailed: "暂时无法取消这个问题，请重试。",
  continue: "继续运行",
  workflowResume: "答案已保存，请从工作流操作区继续。",
  cancel: "取消决策",
  multiSelect: "选择一项或多项",
  singleSelect: "选择一项",
  receipt: "答案详情",
};

export const operatorDecisionCopy = deepMergeCopy(
  operatorDecisionCopyEn,
  getLocale() === "zh" ? operatorDecisionCopyZh : {},
);
