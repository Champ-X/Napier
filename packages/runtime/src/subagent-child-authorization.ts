import type { AgentProfile, RunRecord, SubagentLimits, SubagentTask } from "@napier/contracts";
import { normalizeSubagentLimits } from "./agents.js";
import { createRunConfigurationFingerprint } from "./run-config.js";
import { deriveSubagentProfile, projectSubagentToolNames } from "./subagent-child-profile.js";
import { subagentRoleInstructions, subagentRoleInstructionsForSchema } from "./subagent-role-instructions.js";

declare const authorizationBrand: unique symbol;
export interface SubagentChildRunAuthorization { readonly [authorizationBrand]: true }
interface AuthorizationSnapshot {
  parentRun: RunRecord;
  parentProfile: AgentProfile;
  taskId: string;
  executionId: string;
  limits: SubagentLimits;
}
const authorizations = new WeakMap<object, AuthorizationSnapshot>();

/** Internal host capability: copying its public shape does not copy authority. */
export function authorizeSubagentChildRun(input: AuthorizationSnapshot): SubagentChildRunAuthorization {
  const snapshot = structuredClone(input);
  assertSubagentParentProfile(snapshot.parentRun, snapshot.parentProfile);
  snapshot.limits = normalizeSubagentLimits(snapshot.limits);
  if ((Object.keys(snapshot.limits) as Array<keyof SubagentLimits>).some((key) =>
      snapshot.limits[key] > snapshot.parentRun.configuration!.subagentLimits[key]))
    throw new Error("Child limits exceed the frozen parent configuration");
  const capability = Object.freeze({}) as SubagentChildRunAuthorization;
  authorizations.set(capability, snapshot);
  return capability;
}

export function resolveSubagentChildAuthorization(
  authorization: SubagentChildRunAuthorization,
  parent: RunRecord,
  task: SubagentTask,
): { profile: AgentProfile; limits: SubagentLimits } {
  const snapshot = authorizations.get(authorization);
  if (!snapshot || snapshot.taskId !== task.id || snapshot.executionId !== task.executionId ||
      snapshot.parentRun.id !== parent.id || task.runId !== parent.id ||
      parent.threadId !== task.threadId || parent.status !== "running" ||
      parent.source === "subagent" || !parent.configuration ||
      snapshot.parentRun.configuration?.contentSha256 !== parent.configuration.contentSha256 ||
      snapshot.parentRun.agentId !== parent.agentId ||
      snapshot.parentProfile.id !== parent.agentId)
    throw new Error("Subagent child Run authorization is invalid or stale");
  if (!parent.configuration.enabledSubagents.includes(task.role))
    throw new Error("Subagent child role is not granted by the parent Run");
  if (!/^[a-z][a-z0-9_-]{0,63}$/u.test(task.model.provider) ||
      !task.model.id.trim() || task.model.id.length > 500)
    throw new Error("Subagent child model binding is invalid");
  const profile = deriveSubagentProfile(snapshot.parentProfile, task.role);
  profile.enabledTools = projectSubagentToolNames(parent.configuration.enabledTools, task.role);
  profile.toolPolicy = parent.configuration.toolPolicy;
  profile.enabledSkills = [...parent.configuration.enabledSkills];
  profile.model = structuredClone(task.model);
  profile.systemPrompt = task.outputSchema
    ? subagentRoleInstructionsForSchema(task.role, task.outputSchema)
    : subagentRoleInstructions(task.role);
  profile.runLimits = {
    ...parent.configuration.runLimits,
    maxTurns: snapshot.limits.maxTurns,
    timeoutMs: snapshot.limits.timeoutMs,
  };
  profile.subagentLimits = structuredClone(snapshot.limits);
  return { profile, limits: structuredClone(snapshot.limits) };
}

export function assertSubagentParentProfile(parent: RunRecord, profile: AgentProfile): void {
  const configuration = parent.configuration;
  if (!configuration || parent.agentId !== profile.id || parent.agentRevision !== profile.revision)
    throw new Error("Child authorization requires the parent's frozen effective profile");
  const projected = createRunConfigurationFingerprint(profile, configuration.model,
    "executionMode" in configuration ? configuration.executionMode : "standard", {
      ...("skillCatalogSha256" in configuration ? { skillCatalogSha256: configuration.skillCatalogSha256 } : {}),
      ...("promptVariableCatalogSha256" in configuration ? { promptVariables: {
        catalogSha256: configuration.promptVariableCatalogSha256,
        snapshotSha256: configuration.promptVariableSnapshotSha256,
        renderedSystemPromptSha256: configuration.resolvedSystemPromptSha256,
      } } : {}),
    });
  if (projected.contentSha256 !== configuration.contentSha256)
    throw new Error("Child authorization profile conflicts with the parent configuration");
}
