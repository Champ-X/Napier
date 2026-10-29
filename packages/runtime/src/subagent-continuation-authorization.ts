import type { AgentProfile, RunEvent, RunRecord, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { effectiveRunProfile, modernRunConfiguration } from "./effective-run-profile.js";
import { CORE_STATELESS_READ_TOOL_NAMES } from "./read-only-tool-names.js";
import { assertSubagentParentProfile } from "./subagent-child-authorization.js";
import { deriveSubagentProfile } from "./subagent-child-profile.js";
import type {
  ResolvedSubagentContinuationAuthorization,
  ResolveSubagentContinuationAuthorizationInput,
  SubagentChildContinuationAssessment,
  SubagentChildContinuationAuthorization,
} from "./subagent-continuation-types.js";
import { subagentRoleInstructions, subagentRoleInstructionsForSchema } from "./subagent-role-instructions.js";

interface AuthorizationSnapshot {
  assessment: SubagentChildContinuationAssessment;
  sourceRun: RunRecord;
  sourceTask: SubagentTask;
  sourceParent: RunRecord;
  targetParent: RunRecord;
  /** Effective frozen target surface; recovery can intentionally have no ordinary roles. */
  parentProfile: AgentProfile;
  /** Pre-restriction profile proves the role remains configured for this new parent. */
  configuredProfile: AgentProfile;
  recoveryStarted: RunEvent;
}

const authorizations = new WeakMap<object, AuthorizationSnapshot>();
const localTools = new Set<string>(CORE_STATELESS_READ_TOOL_NAMES);
type CurrentAuthorization = Omit<ResolveSubagentContinuationAuthorizationInput, "authorization">;

/** A task-specific host grant. It never changes the parent's ordinary tool/role surface. */
export function authorizeSubagentChildContinuation(input: AuthorizationSnapshot): SubagentChildContinuationAuthorization {
  const snapshot = structuredClone(input);
  const authorization = Object.freeze({}) as SubagentChildContinuationAuthorization;
  // Validate before minting, then validate the current durable identities again at claim.
  resolve(snapshot, { ...snapshot, currentConfiguredProfile: snapshot.configuredProfile });
  authorizations.set(authorization, snapshot);
  return authorization;
}

export function resolveSubagentContinuationAuthorization(
  input: ResolveSubagentContinuationAuthorizationInput,
): ResolvedSubagentContinuationAuthorization {
  const snapshot = authorizations.get(input.authorization);
  if (!snapshot) throw new Error("Child continuation authorization is unavailable");
  return resolve(snapshot, input);
}

function resolve(snapshot: AuthorizationSnapshot, current: CurrentAuthorization) {
  const { assessment, sourceRun, sourceTask, sourceParent, targetParent } = current;
  assertBoundAssessment(snapshot, current);
  assertRecoveryAuthority(snapshot, current);
  assertRecoveryStarted(snapshot.recoveryStarted, targetParent, sourceParent);
  assertSubagentParentProfile(targetParent, snapshot.parentProfile);
  assertSubagentParentProfile(targetParent, effectiveRunProfile(snapshot.configuredProfile, targetParent));
  const role = sourceTask.role;
  if (role !== assessment.role || role === "coder" || sourceTask.writePaths ||
      !(snapshot.configuredProfile.enabledSubagents ?? []).includes(role) ||
      sha256(sourceTask.prompt) !== assessment.promptSha256 ||
      sourceTask.outputSchemaSha256 !== assessment.outputSchemaSha256)
    throw new Error("Child continuation role or task is not authorized");
  const sourceConfiguration = sourceRun.configuration!;
  const targetConfiguration = targetParent.configuration!;
  const allowed = new Set(targetConfiguration.enabledTools.filter((name) => snapshot.configuredProfile.enabledTools.includes(name)));
  if (allowed.has("skill_load")) allowed.add("skill_resource");
  if (new Set(assessment.toolNames).size !== assessment.toolNames.length ||
      assessment.toolNames.some((name) => !localTools.has(name) || !allowed.has(name)) ||
      sourceConfiguration.enabledSkills.some((name) => !targetConfiguration.enabledSkills.includes(name) ||
        !snapshot.configuredProfile.enabledSkills.includes(name)))
    throw new Error("Child continuation tool or skill authority changed");
  const profile = deriveSubagentProfile(snapshot.parentProfile, role);
  profile.toolPolicy = "observe";
  profile.enabledTools = assessment.toolNames.filter((name) => name !== "skill_resource");
  if (assessment.toolNames.includes("skill_resource") && !profile.enabledTools.includes("skill_load"))
    profile.enabledTools.push("skill_load");
  profile.enabledSkills = [...sourceConfiguration.enabledSkills];
  profile.model = structuredClone(sourceTask.model);
  profile.systemPrompt = sourceTask.outputSchema
    ? subagentRoleInstructionsForSchema(role, sourceTask.outputSchema)
    : subagentRoleInstructions(role);
  if (sha256(profile.systemPrompt) !== assessment.systemPromptSha256 ||
      assessment.systemPromptSha256 !== sourceConfiguration.systemPromptSha256)
    throw new Error("Child continuation role prompt changed");
  profile.runLimits = structuredClone(assessment.budget.limits);
  profile.subagentLimits = { ...targetConfiguration.subagentLimits,
    maxTurns: assessment.budget.limits.maxTurns, timeoutMs: assessment.budget.limits.timeoutMs };
  const grant = {
    kind: "napier.subagent-continuation-grant" as const, schemaVersion: 1 as const,
    assessmentSha256: assessment.contentSha256, sourceTaskId: sourceTask.id,
    sourceRunId: sourceRun.id, sourceExecutionId: sourceTask.executionId!,
    sourceParentRunId: sourceParent.id, sourceParentConfigurationSha256: sourceParent.configuration!.contentSha256,
    sourceConfigurationSha256: sourceConfiguration.contentSha256,
    targetParentRunId: targetParent.id, targetParentConfigurationSha256: targetConfiguration.contentSha256,
    systemPromptSha256: assessment.systemPromptSha256,
    toolDefinitionSetSha256: assessment.toolDefinitionSetSha256, toolNames: [...assessment.toolNames],
  };
  return { profile, grant: { ...grant, contentSha256: sha256(canonicalJson(grant)) } };
}

function assertBoundAssessment(snapshot: AuthorizationSnapshot, current: CurrentAuthorization): void {
  const { assessment, sourceRun, sourceTask, sourceParent, targetParent } = current;
  const { contentSha256, ...content } = assessment;
  if (sha256(canonicalJson(content)) !== contentSha256 ||
      canonicalJson(assessment) !== canonicalJson(snapshot.assessment) ||
      canonicalJson(current.currentConfiguredProfile) !== canonicalJson(snapshot.configuredProfile) ||
      sourceRun.id !== assessment.sourceRunId || sourceTask.id !== assessment.sourceTaskId ||
      sourceTask.executionId !== assessment.sourceExecutionId || sourceTask.childRunId !== sourceRun.id ||
      sourceRun.source !== "subagent" || sourceRun.subagent?.taskId !== sourceTask.id ||
      sourceRun.subagent.executionId !== sourceTask.executionId ||
      sourceTask.revision !== assessment.sourceTaskRevision ||
      sourceRun.subagent.executionRevision !== assessment.sourceExecutionRevision ||
      sourceTask.runId !== sourceParent.id || sourceRun.parentRunId !== sourceParent.id ||
      sourceParent.id !== assessment.sourceParentRunId || targetParent.id !== assessment.targetParentRunId ||
      [sourceRun, sourceTask, sourceParent, targetParent].some((value) => value.threadId !== assessment.threadId))
    throw new Error("Child continuation recovery authority is invalid or stale");
}

function assertRecoveryAuthority(snapshot: AuthorizationSnapshot, current: CurrentAuthorization): void {
  const { assessment, sourceRun, sourceParent, targetParent } = current;
  if (sourceRun.configuration?.contentSha256 !== assessment.sourceConfigurationSha256 ||
      sourceParent.configuration?.contentSha256 !== assessment.sourceParentConfigurationSha256 ||
      targetParent.configuration?.contentSha256 !== assessment.targetParentConfigurationSha256 ||
      targetParent.source !== "recovery" || targetParent.parentRunId !== sourceParent.id ||
      targetParent.status !== "running" || sourceParent.status !== "interrupted" ||
      sourceRun.status !== "interrupted" || sourceRun.usageStatus === "incomplete" ||
      !targetParent.lease || Date.parse(targetParent.lease.expiresAt) <= Date.now() ||
      targetParent.lease.ownerId !== snapshot.targetParent.lease?.ownerId ||
      targetParent.lease.acquiredAt !== snapshot.targetParent.lease?.acquiredAt ||
      targetParent.agentId !== sourceParent.agentId || !modernRunConfiguration(targetParent.configuration) ||
      !["standard", "safe_read_only_recovery", "verified_patch_recovery"].includes(targetParent.configuration.executionMode))
    throw new Error("Child continuation recovery authority is invalid or stale");
}

function assertRecoveryStarted(event: RunEvent, target: RunRecord, source: RunRecord): void {
  const payload = event.payload;
  if (event.runId !== target.id || event.threadId !== target.threadId || event.type !== "run.recovery.started" ||
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      payload["parentRunId"] !== source.id || payload["purpose"] === "inspection" ||
      !["manual", "automatic"].includes(String(payload["mode"])))
    throw new Error("Child continuation requires an explicit parent recovery");
}
