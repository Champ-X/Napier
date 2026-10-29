import { emptyUsage, type AgentProfile, type RunEvent, type RunRecord, type SubagentTask } from "@napier/contracts";
import { describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { effectiveRunProfile } from "../src/effective-run-profile.js";
import { createRunConfigurationFingerprint } from "../src/run-config.js";
import { authorizeSubagentChildContinuation, resolveSubagentContinuationAuthorization } from "../src/subagent-continuation-authorization.js";
import type { SubagentChildContinuationAssessment } from "../src/subagent-continuation-types.js";
import { subagentRoleInstructions } from "../src/subagent-role-instructions.js";

function fixture() {
  const now = new Date().toISOString();
  const profile: AgentProfile = { id: "agent_fixture", name: "Fixture", description: "Local fixture",
    systemPrompt: "Parent instructions", model: { provider: "fixture", id: "model" }, thinkingLevel: "off",
    toolPolicy: "workspace", enabledTools: ["read_file"], enabledSkills: [], enabledSubagents: ["researcher"],
    runLimits: { maxTurns: 4, maxTotalTokens: 10_000, maxCostUsd: 2, timeoutMs: 60_000 },
    subagentLimits: { maxConcurrent: 2, maxTotal: 4, maxTurns: 4, timeoutMs: 60_000 },
    revision: 1, createdAt: now, updatedAt: now };
  const sourceParent: RunRecord = { id: "run_oldparent", threadId: "thread_fixture", agentId: profile.id,
    status: "interrupted", source: "user", startedAt: now, usage: emptyUsage(), agentRevision: profile.revision,
    configuration: createRunConfigurationFingerprint(profile, profile.model, "standard") };
  const sourceProfile = { ...profile, enabledSubagents: [], systemPrompt: subagentRoleInstructions("researcher") };
  const sourceRun: RunRecord = { ...sourceParent, id: "run_oldchild", source: "subagent", parentRunId: sourceParent.id,
    configuration: createRunConfigurationFingerprint(sourceProfile, profile.model, "subagent"),
    subagent: { taskId: "task_fixture", executionId: "subexec_fixture", parentConfigurationSha256: sourceParent.configuration!.contentSha256,
      executionRevision: 2, nextInvocationIndex: 0 } };
  const sourceTask: SubagentTask = { id: "task_fixture", threadId: sourceParent.threadId, runId: sourceParent.id,
    childRunId: sourceRun.id, role: "researcher", description: "A bounded task", prompt: "Inspect exact evidence",
    status: "failed", model: profile.model, providerId: "in_process", executionId: "subexec_fixture",
    supervisorStatus: "orphaned", stepCount: 0, turnCount: 0, usage: emptyUsage(), createdAt: now, revision: 4 };
  const targetParent: RunRecord = { ...sourceParent, id: "run_recovered", source: "recovery", status: "running",
    parentRunId: sourceParent.id, configuration: createRunConfigurationFingerprint(profile, profile.model, "safe_read_only_recovery"),
    lease: { ownerId: "process:fixture", acquiredAt: now, heartbeatAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 1 } };
  const recoveryStarted: RunEvent = { id: "event_recovery", threadId: targetParent.threadId, runId: targetParent.id,
    seq: 10, type: "run.recovery.started", category: "lifecycle", visibility: "user", createdAt: now,
    payload: { parentRunId: sourceParent.id, mode: "automatic", status: "running" } };
  const assessment = rehash({ kind: "napier.subagent-continuation-assessment", schemaVersion: 1,
    threadId: sourceTask.threadId, sourceTaskId: sourceTask.id, sourceRunId: sourceRun.id,
    sourceExecutionId: sourceTask.executionId!, sourceParentRunId: sourceParent.id,
    sourceTaskRevision: sourceTask.revision, sourceExecutionRevision: sourceRun.subagent!.executionRevision,
    sourceRunHeadSeq: 8, sourceParentHeadSeq: 9, sourceConfigurationSha256: sourceRun.configuration!.contentSha256,
    sourceParentConfigurationSha256: sourceParent.configuration!.contentSha256,
    targetParentRunId: targetParent.id, targetParentConfigurationSha256: targetParent.configuration!.contentSha256,
    sourceCheckpointRevision: 1, sourceCapsuleSha256: "a".repeat(64), sourceMessageCount: 1,
    checkpointOwner: { taskId: sourceTask.id, runId: sourceRun.id, executionId: sourceTask.executionId!, parentRunId: sourceParent.id },
    sourceMessageSetSha256: "b".repeat(64), role: sourceTask.role, promptSha256: sha256(sourceTask.prompt),
    systemPromptSha256: sha256(sourceProfile.systemPrompt), toolDefinitionSetSha256: "c".repeat(64),
    toolNames: ["read_file"], mode: "continue", mailboxSnapshotSha256: "d".repeat(64),
    budget: { logicalTaskId: sourceTask.id, rootChildRunId: sourceRun.id, rootParentRunId: sourceParent.id,
      rootExecutionId: sourceTask.executionId!, rootIntentSha256: "e".repeat(64), inheritedUsage: emptyUsage(),
      inheritedTurnCount: 0, inheritedStepCount: 0, originalStartedAt: now,
      deadlineAt: new Date(Date.now() + 60_000).toISOString(), limits: profile.runLimits!, delegationOrdinal: 1, continuationOrdinal: 1 },
  });
  return { assessment, sourceRun, sourceTask, sourceParent, targetParent,
    parentProfile: effectiveRunProfile(profile, targetParent), configuredProfile: profile, currentConfiguredProfile: profile, recoveryStarted };
}
function rehash(value: Omit<SubagentChildContinuationAssessment, "contentSha256">): SubagentChildContinuationAssessment {
  return { ...value, contentSha256: sha256(canonicalJson(value)) };
}

describe("child continuation task-specific authority", () => {
  it("grants the exact local role while the recovered parent retains no ordinary delegation roles", () => {
    const f = fixture();
    const authorization = authorizeSubagentChildContinuation(f);
    f.parentProfile.enabledTools.length = 0;
    const result = resolveSubagentContinuationAuthorization({ ...f, authorization });
    expect(f.targetParent.configuration!.enabledSubagents).toEqual([]);
    expect(result.profile.enabledSubagents).toEqual([]);
    expect(result.profile.enabledTools).toEqual(["read_file"]);
    expect(result.profile.toolPolicy).toBe("observe");
    expect(result.grant.assessmentSha256).toBe(f.assessment.contentSha256);
    expect(() => resolveSubagentContinuationAuthorization({ ...f, authorization: { ...authorization } })).toThrow("unavailable");
  });

  it("rejects inspection, unrelated recovery, lost lease and changed task evidence", () => {
    const f = fixture();
    expect(() => authorizeSubagentChildContinuation({ ...f, recoveryStarted: { ...f.recoveryStarted,
      payload: { parentRunId: f.sourceParent.id, mode: "manual", purpose: "inspection" } } })).toThrow("explicit parent recovery");
    const authorization = authorizeSubagentChildContinuation(f);
    expect(() => resolveSubagentContinuationAuthorization({ ...f, authorization,
      targetParent: { ...f.targetParent, parentRunId: "run_unrelated" } })).toThrow("authority");
    expect(() => resolveSubagentContinuationAuthorization({ ...f, authorization,
      targetParent: { ...f.targetParent, lease: { ...f.targetParent.lease!, expiresAt: "2000-01-01T00:00:00.000Z" } } })).toThrow("authority");
    expect(() => resolveSubagentContinuationAuthorization({ ...f, authorization,
      sourceTask: { ...f.sourceTask, prompt: "Changed" } })).toThrow("task");
  });

  it("refuses removed role authority, nonlocal tools and mutated assessments", () => {
    const f = fixture();
    expect(() => authorizeSubagentChildContinuation({ ...f,
      configuredProfile: { ...f.configuredProfile, enabledSubagents: [] } })).toThrow("role");
    expect(() => authorizeSubagentChildContinuation({ ...f,
      configuredProfile: { ...f.configuredProfile, enabledTools: [] } })).toThrow("tool");
    const { contentSha256: _hash, ...content } = f.assessment;
    expect(() => authorizeSubagentChildContinuation({ ...f,
      assessment: rehash({ ...content, toolNames: ["web_fetch"] }) })).toThrow("tool");
    const authorization = authorizeSubagentChildContinuation(f);
    expect(() => resolveSubagentContinuationAuthorization({ ...f, authorization,
      assessment: rehash({ ...content, mode: "finalize" }) })).toThrow("authority");
  });
});
