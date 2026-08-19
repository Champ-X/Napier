import type { RunConfigurationField } from "@napier/contracts";
import { getLocale } from "./locale";

export const runConfigurationFieldCopyEn: Record<
  RunConfigurationField,
  string
> = {
  agentRevision: "Agent revision",
  model: "Model",
  systemPrompt: "System prompt",
  thinkingLevel: "Thinking level",
  toolPolicy: "Tool policy",
  enabledTools: "Workspace tools",
  enabledSkills: "Skills",
  enabledSubagents: "Subagents",
  subagentLimits: "Delegation limits",
  runLimits: "Run limits",
  automaticRecovery: "Recovery policy",
  modelAdvisor: "Model Advisor",
  executionMode: "Execution mode",
  skillCatalog: "Skill catalog",
  promptVariables: "Prompt variables",
  toolLoopGuard: "Tool loop guard",
};

export const runConfigurationFieldCopyZh: Record<
  RunConfigurationField,
  string
> = {
  agentRevision: "智能体修订",
  model: "模型",
  systemPrompt: "系统提示词",
  thinkingLevel: "思考级别",
  toolPolicy: "工具策略",
  enabledTools: "工作区工具",
  enabledSkills: "Skill",
  enabledSubagents: "子智能体",
  subagentLimits: "委派限制",
  runLimits: "运行限制",
  automaticRecovery: "恢复策略",
  modelAdvisor: "模型顾问",
  executionMode: "执行模式",
  skillCatalog: "Skill 目录",
  promptVariables: "提示词变量",
  toolLoopGuard: "工具循环防护",
};

export const runConfigurationFieldCopy =
  getLocale() === "zh"
    ? runConfigurationFieldCopyZh
    : runConfigurationFieldCopyEn;
