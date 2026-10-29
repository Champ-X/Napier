import type { JsonObject, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { claimRunHeadEvent, type RunHeadEventClaimStore } from "./event-idempotency.js";
import { LocalPrivateCapsuleStore, LocalPrivateCapsuleDurabilityUnavailableError } from "./local-private-capsule-store.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";
import { assertValidToolOperationTransition } from "./tool-operation-transition-validation.js";
import { toolExecutionAuthorityOperationIds } from "./tool-execution-authority-binding.js";
import { inspectMovePaths, matchesMoveState, type MovePathBinding } from "./workspace-file-move-paths.js";

export interface MovePreparationReceipt extends JsonObject {
  schemaVersion: 1;
  callId: string;
  operationId: string;
  inputSha256: string;
  boundaryEventSeq: number;
  capsuleSha256: string;
  sourcePathSha256: string;
  destinationPathSha256: string;
  fileSha256: string;
  planSha256: string;
  contentSha256: string;
}
export interface MoveIntent extends MovePathBinding {
  schemaVersion: 1;
  threadId: string;
  runId: string;
  callId: string;
  operationId: string;
  inputSha256: string;
  writerPid: number;
  planSha256: string;
  contentSha256: string;
}

export function moveIntents(dataRoot: string): LocalPrivateCapsuleStore<MoveIntent> {
  return new LocalPrivateCapsuleStore({ dataRoot, directory: "workspace-file-move-intents", label: "Workspace file move intent",
    requireDurableDirectory: true,
    maxObjectBytes: 16 * 1024, maxObjects: 512, maxStorageBytes: 8 * 1024 * 1024,
    contentSha256: (value) => value.contentSha256,
    parse(serialized) {
      const value = JSON.parse(serialized) as MoveIntent;
      const { contentSha256, ...content } = value;
      const identity = (v: { dev: number; ino: number }) => v && Number.isSafeInteger(v.dev) && v.dev >= 0 && Number.isSafeInteger(v.ino) && v.ino >= 0;
      if (value.schemaVersion !== 1 || Object.keys(value).length !== 16 ||
          ![value.threadId, value.runId, value.callId, value.operationId, value.sourcePath, value.destinationPath].every(text) ||
          ![value.inputSha256, value.planSha256, value.workspaceRootSha256, value.file?.sha256, contentSha256].every(hash) ||
          ![value.root, value.sourceParent, value.destinationParent, value.file].every(identity) ||
          !Number.isSafeInteger(value.file.bytes) || value.file.bytes < 0 ||
          !Number.isSafeInteger(value.writerPid) || value.writerPid <= 0 || sha256(canonicalJson(content)) !== contentSha256)
        throw new Error("move_private_evidence_invalid");
      return value;
    },
  });
}

/** Called under both path locks. Durable preparation requires its commit gate;
 * typed unsupported capability instead records that ordinary move recovery is unavailable. */
export async function prepareWorkspaceFileMove(input: {
  store: RunHeadEventClaimStore; workspaceRoot: string; dataRoot: string; threadId: string; runId: string;
  callId: string; previewId: string; sourcePath: string; destinationPath: string; planSha256: string;
}): Promise<(() => Promise<void>) | undefined> {
  const events = await input.store.listRunEvents(input.runId);
  // Direct/legacy manager consumers do not own a native tool invocation.
  // A partial invocation history is different: it must fail the binding below.
  if (!events.some((event) => (event.type.startsWith("tool.operation.") || ["tool.admitted", "tool.started"].includes(event.type)) &&
      (field(event, "callId") === input.callId || field(event, "parentCallId") === input.callId))) return undefined;
  const boundaries = liveToolEffectAuthoritiesFromEvents(events).filter((v) => v.current && field(v.boundaryEvent, "parentCallId") === input.callId);
  const boundary = boundaries[0]?.boundaryEvent;
  const start = boundary && moveStartForBoundary(events, boundary);
  const inputSha256 = sha256(canonicalJson({ toolName: "workspace_file_apply", args: { previewId: input.previewId } }));
  if (boundaries.length !== 1 || !boundary || !start || field(start, "inputSha256") !== inputSha256)
    throw new Error("move_execution_binding_invalid");
  const binding = await inspectMovePaths(input.workspaceRoot, input.sourcePath, input.destinationPath);
  const content = { schemaVersion: 1 as const, threadId: input.threadId, runId: input.runId, callId: input.callId,
    operationId: String(field(boundary, "operationId")), inputSha256, writerPid: process.pid, planSha256: input.planSha256, ...binding };
  const capsuleSha256 = sha256(canonicalJson(content));
  try {
    await moveIntents(input.dataRoot).put(capsuleSha256, canonicalJson({ ...content, contentSha256: capsuleSha256 }));
  } catch (error) {
    if (!(error instanceof LocalPrivateCapsuleDurabilityUnavailableError)) throw error;
    const unavailable = { schemaVersion: 1, callId: input.callId, operationId: content.operationId,
      inputSha256, boundaryEventSeq: boundary.seq, planSha256: input.planSha256,
      reason: "durable_directory_unsupported", recoveryAvailable: false };
    const result = await claimRunHeadEvent(input.store, { threadId: input.threadId, runId: input.runId,
      type: "workspace.file.move.recovery_unavailable", category: "tool", visibility: "debug",
      payload: { ...unavailable, contentSha256: sha256(canonicalJson(unavailable)) } },
      { namespace: "workspace-file-move-recovery-unavailable", key: `${input.runId}:${input.callId}` });
    if (!result.appended) throw new Error("move_recovery_unavailable_already_recorded");
    return undefined;
  }
  const receipt = { schemaVersion: 1 as const, callId: input.callId, operationId: content.operationId, inputSha256,
    boundaryEventSeq: boundary.seq, capsuleSha256, sourcePathSha256: sha256(input.sourcePath),
    destinationPathSha256: sha256(input.destinationPath), fileSha256: binding.file.sha256, planSha256: input.planSha256 };
  const prepared = await claimRunHeadEvent(input.store, { threadId: input.threadId, runId: input.runId,
    type: "workspace.file.move.prepared", category: "tool", visibility: "debug",
    payload: { ...receipt, contentSha256: sha256(canonicalJson(receipt)) } },
    { namespace: "workspace-file-move-prepared", key: `${input.runId}:${input.callId}` });
  if (!prepared.appended) throw new Error("move_preparation_already_consumed");
  return async () => {
    if (!(await matchesMoveState(input.workspaceRoot, binding, "before"))) throw new Error("move_precondition_changed");
    const commit = await claimRunHeadEvent(input.store, { threadId: input.threadId, runId: input.runId,
      type: "workspace.file.move.commit_started", category: "tool", visibility: "debug", payload: moveCommitPayload(prepared.event) },
      { namespace: "workspace-file-move-commit", key: `${input.runId}:${input.callId}` });
    if (!commit.appended) throw new Error("move_commit_already_consumed");
  };
}

export function moveCommitPayload(prepared: RunEvent): JsonObject {
  if (!validMovePreparation(prepared.payload)) throw new Error("move_preparation_invalid");
  const content = { schemaVersion: 1, callId: prepared.payload.callId, operationId: prepared.payload.operationId,
    preparedEventSeq: prepared.seq, preparedSha256: prepared.payload.contentSha256 };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function moveStartForBoundary(events: RunEvent[], boundary: RunEvent): RunEvent | undefined {
  const operationId = field(boundary, "operationId");
  if (!completeHistory(events) || typeof operationId !== "string" || field(boundary, "route") !== "workspace_file_apply" ||
      !toolExecutionAuthorityOperationIds(events).has(operationId) || !validMoveOperationHistory(events, boundary)) return undefined;
  const state = toolOperationLedgerState(events, operationId);
  if (state.admission !== "admitted" || state.effectBoundary?.seq !== boundary.seq ||
      [state.proposed, state.admitted, state.started, state.effectBoundary].some((event) => !event ||
        event.runId !== boundary.runId || event.threadId !== boundary.threadId ||
        field(event, "descriptorSha256") !== field(boundary, "descriptorSha256") ||
        !validToolOperationEventPayload(event.type as "tool.operation.started", event.payload))) return undefined;
  const starts = events.filter((e) => e.type === "tool.started" && field(e, "callId") === field(boundary, "parentCallId"));
  const admissions = events.filter((e) => e.type === "tool.admitted" && field(e, "callId") === field(boundary, "parentCallId"));
  const start = starts[0], admission = admissions[0];
  return starts.length === 1 && admissions.length === 1 && start && admission &&
    [start, admission].every((e) => e.runId === boundary.runId && e.threadId === boundary.threadId && field(e, "toolName") === "workspace_file_apply") &&
    admission.seq < state.proposed!.seq && state.started!.seq < start.seq && start.seq < boundary.seq &&
    hash(field(start, "inputSha256")) && field(admission, "callInputSha256") === field(start, "inputSha256") ? start : undefined;
}

export function preparedMoveForBoundary(events: RunEvent[], boundary: RunEvent): (RunEvent & { payload: MovePreparationReceipt }) | undefined {
  const start = moveStartForBoundary(events, boundary);
  if (!start) return undefined;
  if (events.some((event) => event.type === "workspace.file.move.recovery_unavailable" &&
      (field(event, "callId") === field(start, "callId") || field(event, "operationId") === field(boundary, "operationId")))) return undefined;
  const values = events.filter((e) => e.type === "workspace.file.move.prepared" &&
    (field(e, "callId") === field(start, "callId") || field(e, "operationId") === field(boundary, "operationId")));
  const prepared = values[0];
  if (values.length !== 1 || !prepared || prepared.runId !== boundary.runId || prepared.threadId !== boundary.threadId ||
      prepared.seq <= boundary.seq || !validMovePreparation(prepared.payload) ||
      prepared.payload.boundaryEventSeq !== boundary.seq || prepared.payload.operationId !== field(boundary, "operationId") ||
      prepared.payload.inputSha256 !== field(start, "inputSha256")) return undefined;
  return prepared as RunEvent & { payload: MovePreparationReceipt };
}

export function validMovePreparation(value: unknown): value is MovePreparationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as MovePreparationReceipt, { contentSha256, ...content } = v;
  return Object.keys(v).length === 11 && v.schemaVersion === 1 && text(v.callId) && text(v.operationId) &&
    Number.isSafeInteger(v.boundaryEventSeq) && v.boundaryEventSeq > 0 &&
    [v.inputSha256, v.capsuleSha256, v.sourcePathSha256, v.destinationPathSha256, v.fileSha256, v.planSha256, contentSha256].every(hash) &&
    sha256(canonicalJson(content)) === contentSha256;
}
export function completeHistory(events: RunEvent[]): boolean {
  return events.length <= 10_000 && events.every((e) => Number.isSafeInteger(e.seq) && e.seq > 0) &&
    new Set(events.map((e) => e.id)).size === events.length && new Set(events.map((e) => e.seq)).size === events.length;
}

/** Only one native execution generation is covered by this move intent. */
function validMoveOperationHistory(events: RunEvent[], boundary: RunEvent): boolean {
  const operationId = String(field(boundary, "operationId"));
  const phases = events.filter((e) => e.type.startsWith("tool.operation.") && field(e, "operationId") === operationId)
    .sort((a, b) => a.seq - b.seq);
  if (phases.length > 256 || phases.filter((e) => field(e, "executionEffectBoundary") === true).length !== 1 ||
      ["tool.operation.proposed", "tool.operation.admitted", "tool.operation.started"].some((type) => phases.filter((e) => e.type === type).length !== 1) ||
      ["tool.operation.settled", "tool.operation.effect_indeterminate"].some((type) => phases.filter((e) => e.type === type).length > 1)) return false;
  const prior: RunEvent[] = [];
  const allowed = new Set(["tool.operation.proposed", "tool.operation.admitted", "tool.operation.started",
    "tool.operation.lease.granted", "tool.operation.lease.renewed", "tool.operation.settled", "tool.operation.effect_indeterminate"]);
  try {
    for (const event of phases) {
      const type = event.type as Parameters<typeof validToolOperationEventPayload>[0];
      if (!allowed.has(type) || event.runId !== boundary.runId || event.threadId !== boundary.threadId ||
          field(event, "descriptorSha256") !== field(boundary, "descriptorSha256") ||
          !validToolOperationEventPayload(type, event.payload)) return false;
      assertValidToolOperationTransition(type, toolOperationLedgerState(prior, operationId), event.payload, operationId);
      prior.push(event);
    }
    return true;
  } catch { return false; }
}
export function field(event: RunEvent | undefined, key: string): unknown {
  return event?.payload && typeof event.payload === "object" && !Array.isArray(event.payload) ? event.payload[key] : undefined;
}
function hash(v: unknown): v is string { return typeof v === "string" && /^[a-f0-9]{64}$/u.test(v); }
function text(v: unknown): v is string { return typeof v === "string" && v.length > 0 && v.length <= 500; }
