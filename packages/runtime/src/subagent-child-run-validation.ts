import type { RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { projectSubagentToolNames } from "./subagent-child-profile.js";
import { subagentRoleInstructions, subagentRoleInstructionsForSchema } from "./subagent-role-instructions.js";

/** Validates durable association only; it does not grant execution or recovery. */
export function validateSubagentRunBinding(
  run: RunRecord,
  parent: RunRecord | undefined,
  task: SubagentTask | undefined,
): void {
  const binding = run.subagent;
  if (!binding || !parent || !task || !parent.configuration || !run.configuration)
    throw new Error(`Subagent child Run binding is invalid: ${run.id}`);
  validateChildIdentity(run, parent, task, binding);
  validateChildUsage(run, task);
  validateChildConfiguration(run, parent, task, run.configuration, parent.configuration);
}

function validateChildIdentity(run: RunRecord, parent: RunRecord, task: SubagentTask,
  binding: NonNullable<RunRecord["subagent"]>): void {
  if (run.source !== "subagent" ||
      !run.configuration ||
      !("executionMode" in run.configuration) || run.configuration.executionMode !== "subagent" ||
      parent.source === "subagent" || parent.id !== run.parentRunId ||
      parent.threadId !== run.threadId || parent.agentId !== run.agentId ||
      task.id !== binding.taskId || task.childRunId !== run.id ||
      task.runId !== parent.id || task.threadId !== run.threadId ||
      !task.executionId || task.executionId !== binding.executionId ||
      binding.parentConfigurationSha256 !== parent.configuration?.contentSha256 ||
      !/^[a-f0-9]{64}$/u.test(binding.parentConfigurationSha256) ||
      !Number.isSafeInteger(binding.executionRevision) || binding.executionRevision < 1 ||
      !Number.isSafeInteger(binding.nextInvocationIndex) || binding.nextInvocationIndex < 0)
    throw new Error(`Subagent child Run binding is invalid: ${run.id}`);
}

function validateChildUsage(run: RunRecord, task: SubagentTask): void {
  if ((run.usageStatus !== "complete" && run.usageStatus !== "incomplete") ||
      task.usageStatus !== run.usageStatus || canonicalJson(task.usage) !== canonicalJson(run.usage))
    throw new Error(`Subagent child usage completeness is invalid: ${run.id}`);
}

function validateChildConfiguration(run: RunRecord, parent: RunRecord, task: SubagentTask,
  configuration: NonNullable<RunRecord["configuration"]>, origin: NonNullable<RunRecord["configuration"]>): void {
  const prompt = task.outputSchema ? subagentRoleInstructionsForSchema(task.role, task.outputSchema)
    : subagentRoleInstructions(task.role);
  if (run.agentRevision !== parent.agentRevision || configuration.agentRevision !== origin.agentRevision ||
      canonicalJson(configuration.model) !== canonicalJson(task.model) ||
      configuration.systemPromptSha256 !== sha256(prompt) ||
      configuration.toolPolicy !== origin.toolPolicy || configuration.enabledSubagents.length !== 0 ||
      !origin.enabledSubagents.includes(task.role) ||
      canonicalJson(configuration.enabledSkills) !== canonicalJson(origin.enabledSkills) ||
      canonicalJson([...configuration.enabledTools].sort()) !==
        canonicalJson(projectSubagentToolNames(origin.enabledTools, task.role).sort()) ||
      configuration.runLimits.maxTurns !== configuration.subagentLimits.maxTurns ||
      configuration.runLimits.timeoutMs !== configuration.subagentLimits.timeoutMs ||
      configuration.runLimits.maxTotalTokens !== origin.runLimits.maxTotalTokens ||
      configuration.runLimits.maxCostUsd !== origin.runLimits.maxCostUsd ||
      (Object.keys(configuration.subagentLimits) as Array<keyof typeof configuration.subagentLimits>)
        .some((key) => configuration.subagentLimits[key] > origin.subagentLimits[key]))
    throw new Error(`Subagent child configuration exceeds or conflicts with its parent: ${run.id}`);
}

export function validateSubagentChildRunState(
  runs: readonly RunRecord[], tasks: readonly SubagentTask[],
): void {
  const byRun = new Map(runs.map((run) => [run.id, run]));
  const byTask = new Map(tasks.map((task) => [task.id, task]));
  for (const run of runs) {
    validateUsageStatus(run.usageStatus);
    if (run.source !== "subagent") {
      if (run.subagent !== undefined || (run.configuration && "executionMode" in run.configuration &&
          run.configuration.executionMode === "subagent"))
        throw new Error("Child execution binding requires a subagent Run");
      continue;
    }
    validateSubagentRunBinding(run, byRun.get(run.parentRunId ?? ""), byTask.get(run.subagent?.taskId ?? ""));
  }
  for (const task of tasks) {
    validateUsageStatus(task.usageStatus);
    if (task.childRunId === undefined) continue;
    const child = byRun.get(task.childRunId);
    if (!child || child.subagent?.taskId !== task.id)
      throw new Error(`Subagent Task child Run reference is invalid: ${task.id}`);
    validateSubagentRunBinding(child, byRun.get(task.runId), task);
  }
}

function validateUsageStatus(status: unknown): void {
  if (status !== undefined && status !== "complete" && status !== "incomplete")
    throw new Error("Run or Task usage completeness status is invalid");
}
