import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const endpoint = (origin, workspace, resource) => `${origin}/api/workspaces/${workspace.workspaceId}/${resource}`;
export const recoveryResource = (request) => `threads/${request.threadId}/workflows/${request.planId}/recovery`;
export const answerResource = (request) => `threads/${request.threadId}/operator-decisions/${request.decisionId}/answer`;

export async function scopedJson(origin, workspace, resource, body, status = 200) {
  const response = await fetch(endpoint(origin, workspace, resource), {
    ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify({ resource, result }));
  assert.equal(response.headers.get("x-napier-workspace-id"), workspace.workspaceId);
  return result;
}

export async function observeWorkspace(origin, workspace, fixture) {
  const bootstrap = await scopedJson(origin, workspace, `bootstrap?thread=${fixture.request.threadId}`);
  assert.equal(bootstrap.workspace.root, workspace.root);
  assert.equal(bootstrap.workspace.dataRoot, workspace.dataRoot);
  const detail = await scopedJson(origin, workspace, `threads/${fixture.request.threadId}`);
  const checkpoint = await scopedJson(origin, workspace, recoveryResource(fixture.request));
  const extension = bootstrap.extensions.find((item) => item.id === fixture.extension.id);
  assert.ok(extension);
  assert.deepEqual(extension.enabledAgentIds, []);
  assert.equal(extension.connection.status, "untested");
  assert.equal(detail.events.some((event) => event.type.startsWith("model.")), false);
  // Compare durable domain state, excluding request-time diagnostic generatedAt.
  return { workspace: bootstrap.workspace, checkpoint, extension,
    detail: { thread: detail.thread, events: detail.events, runs: detail.runs, messages: detail.messages, executionPlan: detail.executionPlan, operatorDecisions: detail.operatorDecisions } };
}

export async function assertWaiting(origin, workspace, fixture) {
  const observed = await observeWorkspace(origin, workspace, fixture);
  assert.equal(observed.checkpoint.status, "waiting_answer");
  assert.equal(observed.extension.trustStatus, "pending");
  assert.equal(observed.extension.revision, fixture.extension.revision);
  assert.equal(observed.detail.events.filter((event) => event.type === "operator.decision.answered").length, 0);
  assert.equal(observed.detail.events.filter((event) => event.type === "extension.approved").length, 0);
  await assert.rejects(stat(path.join(workspace.root, "approved.txt")), { code: "ENOENT" });
  return observed;
}

export async function rejectAbsentIds(origin, fixture) {
  const before = await assertWaiting(origin, fixture.a, fixture);
  const absentDecision = { ...fixture.request, decisionId: fixture.absent.decisionId };
  await scopedJson(origin, fixture.b, answerResource(absentDecision), fixture.request.answer, 404);
  await scopedJson(origin, fixture.b, answerResource(fixture.absent), fixture.request.answer, 404);
  await scopedJson(origin, fixture.b, `extensions/${fixture.absent.extensionId}/review`, { action: "approve", threadId: fixture.request.threadId }, 404);
  const bMissingWorkflow = await scopedJson(origin, fixture.b, recoveryResource(fixture.absent));
  assert.equal(bMissingWorkflow.status, "unavailable");
  // This malformed/stale POST is not alone an isolation assertion: A's waiting
  // workflow would reject it too. The scoped GET above differs from A below.
  await scopedJson(origin, fixture.b, recoveryResource(fixture.absent), { checkpointSha256: "a".repeat(64) }, 409);
  const after = await assertWaiting(origin, fixture.a, fixture);
  assert.deepEqual(after, before);
  const aOnly = await scopedJson(origin, fixture.a, recoveryResource(fixture.absent));
  assert.equal(aOnly.status, "waiting_answer");
  const extensions = await scopedJson(origin, fixture.a, "extensions");
  assert.equal(extensions.find((item) => item.id === fixture.absent.extensionId).trustStatus, "pending");
  return { missingDecisionInCopiedThread: 404, missingThreadAndDecision: 404, missingExtension: 404,
    missingWorkflowLookup: bMissingWorkflow.status, originalWorkflowLookup: aOnly.status, unavailableCheckpointPost: 409 };
}

export async function approveAndContinue(origin, workspace, fixture) {
  await scopedJson(origin, workspace, `extensions/${fixture.extension.id}/review`, { action: "approve", threadId: fixture.request.threadId });
  await scopedJson(origin, workspace, answerResource(fixture.request), fixture.request.answer, 202);
  const checkpoint = await scopedJson(origin, workspace, recoveryResource(fixture.request));
  assert.equal(checkpoint.status, "ready");
  assert.ok(checkpoint.checkpointSha256);
  await scopedJson(origin, workspace, recoveryResource(fixture.request), { checkpointSha256: checkpoint.checkpointSha256 });
  return checkpoint;
}

export async function assertCompletedOnce(origin, workspace, fixture, checkpoint) {
  const before = await observeWorkspace(origin, workspace, fixture);
  assert.equal(before.checkpoint.status, "completed");
  assert.equal(before.extension.trustStatus, "approved");
  assert.equal(before.extension.revision, fixture.extension.revision + 1);
  const count = (type) => before.detail.events.filter((event) => event.type === type).length;
  assert.equal(count("operator.decision.answered"), 1);
  assert.equal(count("operator.decision.continued"), 1);
  assert.equal(count("workflow.completed"), 1);
  assert.equal(count("tool.completed"), 1);
  assert.equal(count("extension.approved"), 1);
  const file = path.join(workspace.root, "approved.txt");
  assert.equal(await readFile(file, "utf8"), fixture.request.answer.customText);
  const fileBefore = await stat(file);
  // Same answer is idempotent; an old checkpoint cannot continue twice.
  await scopedJson(origin, workspace, answerResource(fixture.request), fixture.request.answer, 202);
  await scopedJson(origin, workspace, recoveryResource(fixture.request), { checkpointSha256: checkpoint.checkpointSha256 }, 409);
  assert.deepEqual(await observeWorkspace(origin, workspace, fixture), before);
  const fileAfter = await stat(file);
  assert.deepEqual([fileAfter.ino, fileAfter.mtimeMs, fileAfter.size], [fileBefore.ino, fileBefore.mtimeMs, fileBefore.size]);
  return {
    workspace: before.workspace, checkpointStatus: before.checkpoint.status,
    extensionTrustStatus: before.extension.trustStatus, extensionRevision: before.extension.revision,
    answerEvents: count("operator.decision.answered"), continuationEvents: count("operator.decision.continued"),
    completedWorkflows: count("workflow.completed"), completedTools: count("tool.completed"),
    extensionApprovalEvents: count("extension.approved"), sameAnswerRetryStatus: 202, staleCheckpointReplayStatus: 409,
    file: { bytes: fileAfter.size, mtimeUnchangedByReplay: true },
  };
}
