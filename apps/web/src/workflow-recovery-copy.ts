import { deepMergeCopy, getLocale, type LocaleOverride } from "./locale";

const en = {
  title: "Continue Workflow",
  finished: "Workflow steps finished",
  loading: "Checking the saved Workflow…",
  working: "Continuing Workflow…",
  refresh: "Refresh checkpoint",
  answer: "Review decision",
  details: "Checkpoint details",
  failure:
    "The response could not be confirmed. Review the refreshed state before continuing; the request may already have run.",
  reasons: {
    definition_unavailable:
      "The original definition is missing or cannot be verified. Locate the original Workflow definition before continuing.",
    binding_mismatch:
      "The Plan, Agent revision or saved start evidence no longer matches. Recovery has stopped.",
    evidence_limit:
      "The checkpoint history is too large or has duplicate event identities. Recovery has stopped.",
    ambiguous_breakpoint:
      "More than one open breakpoint was recorded. Inspect the Workflow history before continuing.",
  },
  status: {
    ready:
      "Uses the original definition and saved answers. Completed nodes are retained; remaining steps follow the Workflow recovery rules.",
    waiting_answer:
      "This Workflow needs an answer. Save your choice in the conversation, then return here to continue.",
    completed:
      "Workflow steps have finished. This does not independently verify the whole task.",
    unavailable:
      "The saved definition or checkpoint could not be verified. Inspect the original Workflow records before continuing.",
    busy: "An execution is active in this conversation. Refresh after it stops.",
  },
  actions: {
    resume: "Continue Workflow",
    continue_breakpoint: "Continue past this breakpoint",
    retry_blocked: "Retry eligible Workflow steps",
  },
};
const zh: LocaleOverride<typeof en> = {
  title: "继续 Workflow",
  finished: "Workflow 步骤已结束",
  loading: "正在核对已保存的 Workflow…",
  working: "正在继续 Workflow…",
  refresh: "刷新检查点",
  answer: "查看待回答问题",
  details: "检查点详情",
  failure: "未能确认请求结果。请求可能已经执行，请先查看刷新后的状态再继续。",
  reasons: {
    definition_unavailable:
      "原定义缺失或无法核验。请先找回原始 Workflow 定义，再继续执行。",
    binding_mismatch: "计划、Agent 版本或原始启动记录不匹配，恢复已停止。",
    evidence_limit: "检查点历史超过核查限额，或存在重复事件身份，恢复已停止。",
    ambiguous_breakpoint: "记录中存在多个未释放断点，请先检查 Workflow 历史。",
  },
  status: {
    ready:
      "使用原定义和已保存的答案，保留已完成节点；剩余步骤按 Workflow 的恢复规则继续。",
    waiting_answer:
      "此 Workflow 等待你的答案。请在对话中保存选择，再回到这里继续。",
    completed: "Workflow 步骤已结束，整个任务仍需独立验收。",
    unavailable:
      "无法核验已保存的定义或检查点。请先检查原 Workflow 记录，再决定如何继续。",
    busy: "此会话仍有执行中的任务。请在执行停止后刷新。",
  },
  actions: {
    resume: "继续 Workflow",
    continue_breakpoint: "从此断点继续",
    retry_blocked: "重试可恢复的步骤",
  },
};
export const workflowRecoveryCopy =
  getLocale() === "zh" ? deepMergeCopy(en, zh) : en;
