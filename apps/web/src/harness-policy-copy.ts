import { getLocale } from "./locale";

const en = {
  title: "Execution strategy (experimental)",
  hint: "Applies to the next task only. Your selected permissions still apply.",
  default: "Default strategy",
  "coding-node.v1": "Node.js coding · v1",
  "coding-python.v1": "Python / Node.js coding · v1",
  "research.v1": "Research · v1",
  defaultDescription: "Use the current standard execution strategy.",
  codingDescription:
    "Try version-checked edits, task memory and progress context.",
  pythonDescription:
    "Also use detected Python tools for commands and verification.",
  researchDescription:
    "Try task-relevant memory and evidence-based progress context.",
};

export const harnessPolicyCopy: typeof en =
  getLocale() === "zh"
    ? {
        title: "执行策略（实验）",
        hint: "仅用于下一次任务，仍遵循所选权限。",
        default: "默认策略",
        "coding-node.v1": "Node.js 编程 · v1",
        "coding-python.v1": "Python / Node.js 编程 · v1",
        "research.v1": "资料研究 · v1",
        defaultDescription: "使用当前标准执行策略。",
        codingDescription: "尝试带版本校验的编辑、任务相关记忆和进度上下文。",
        pythonDescription: "同时使用检测到的 Python 工具执行命令和验证。",
        researchDescription: "尝试任务相关记忆和基于证据的进度上下文。",
      }
    : en;
