import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile, RunRecord, SubagentRole, SubagentTask } from "@napier/contracts";
import { canonicalJson } from "./ed25519.js";
import { validateSubagentRunBinding } from "./subagent-child-run-validation.js";

/** Execution ownership is distinct from the frozen parent authority. */
export interface SubagentExecutionContext {
  executionRun: RunRecord;
  authorityOriginRun: RunRecord;
  parentProfile: AgentProfile;
  childProfile: AgentProfile;
  role: SubagentRole;
}

export type SubagentInheritedToolsFactory = (
  context: SubagentExecutionContext,
) => AgentTool[] | Promise<AgentTool[]>;

export type SubagentExecutionCleanup = (executionRun: RunRecord) => Promise<void>;

export interface SubagentExecutionBindingStore {
  listRuns(threadId: string): RunRecord[];
  listSubagentTasks?(threadId: string, runId?: string): SubagentTask[];
}

/** A source string or parent ID alone never grants child execution authority. */
export function assertSubagentExecutionBinding(
  store: SubagentExecutionBindingStore,
  executionRun: RunRecord,
  authorityOriginRunId?: string,
): { executionRun: RunRecord; authorityOriginRun: RunRecord; task: SubagentTask } {
  const runs = store.listRuns(executionRun.threadId);
  const current = runs.find((run) => run.id === executionRun.id);
  const parent = runs.find((run) => run.id === current?.parentRunId);
  const task = store.listSubagentTasks?.(executionRun.threadId)
    .find((candidate) => candidate.id === current?.subagent?.taskId);
  if (!current) throw new Error("Subagent execution ownership binding is invalid");
  validateSubagentRunBinding(current, parent, task);
  if (
    !parent || !task ||
    current.status !== "running" || parent.status !== "running" || task.status !== "running" ||
    (authorityOriginRunId !== undefined && parent.id !== authorityOriginRunId) ||
    executionRun.configuration?.contentSha256 !== current.configuration?.contentSha256 ||
    executionRun.parentRunId !== parent.id || executionRun.subagent?.taskId !== task.id ||
    executionRun.subagent.executionId !== task.executionId
  ) throw new Error("Subagent execution ownership binding is invalid");
  return { executionRun: current, authorityOriginRun: parent, task };
}

export function assertSubagentToolContext(
  store: SubagentExecutionBindingStore,
  context: SubagentExecutionContext,
): void {
  const binding = assertSubagentExecutionBinding(store, context.executionRun, context.authorityOriginRun.id);
  if (
    binding.task.role !== context.role ||
    context.authorityOriginRun.configuration?.contentSha256 !== binding.authorityOriginRun.configuration?.contentSha256 ||
    !profileMatchesRun(context.parentProfile, binding.authorityOriginRun) ||
    !profileMatchesRun(context.childProfile, binding.executionRun) ||
    context.childProfile.enabledTools.some((name) => !context.parentProfile.enabledTools.includes(name))
  ) throw new Error("Subagent tool authority binding is invalid");
}

function profileMatchesRun(profile: AgentProfile, run: RunRecord): boolean {
  const configuration = run.configuration;
  return Boolean(configuration && profile.id === run.agentId &&
    profile.revision === configuration.agentRevision && profile.toolPolicy === configuration.toolPolicy &&
    canonicalJson(profile.enabledTools) === canonicalJson(configuration.enabledTools) &&
    canonicalJson(profile.enabledSkills) === canonicalJson(configuration.enabledSkills));
}
