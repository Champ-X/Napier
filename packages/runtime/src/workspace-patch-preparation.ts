import type { JsonObject, JsonValue, RunEvent } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { LocalPrivateCapsuleStore } from "./local-private-capsule-store.js";
import {
  claimRunHeadEvent,
  type RunHeadEventClaimStore,
} from "./event-idempotency.js";
import { liveToolEffectAuthoritiesFromEvents } from "./sqlite-tool-effect-authority.js";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";
import { WorkspacePatchRecoveryCapsules } from "./workspace-patch-recovery-capsule.js";
import type { RecordWorkspacePatchPreparation } from "./workspace-patch-model.js";
export type PatchPreparationJournal = RunHeadEventClaimStore & {
  workspaceRoot: string;
  dataRoot: string;
};

export interface PatchPreparationReceipt extends JsonObject {
  schemaVersion: 1 | 2;
  callId: string;
  operationId: string;
  inputSha256: string;
  boundaryEventSeq: number;
  capsuleSha256: string;
  recoveryCapsuleSha256: string;
  pathSha256: string;
  beforeSha256: string | null;
  afterSha256: string;
  contentSha256: string;
}
interface PatchIntent {
  schemaVersion: 1;
  threadId: string;
  runId: string;
  callId: string;
  inputSha256: string;
  recoveryCapsuleSha256: string;
  writerPid: number;
  dev: number;
  ino: number;
  contentSha256: string;
}

export function workspacePatchIntents(
  dataRoot: string,
): LocalPrivateCapsuleStore<PatchIntent> {
  return new LocalPrivateCapsuleStore({
    dataRoot,
    directory: "workspace-patch-intents",
    label: "Workspace patch intent",
    maxObjectBytes: 16 * 1024,
    maxObjects: 512,
    maxStorageBytes: 8 * 1024 * 1024,
    contentSha256: (value) => value.contentSha256,
    parse(serialized) {
      const value = JSON.parse(serialized) as PatchIntent;
      const { contentSha256, ...content } = value;
      if (
        value.schemaVersion !== 1 ||
        Object.keys(value).length !== 10 ||
        ![value.threadId, value.runId, value.callId].every(text) ||
        ![value.inputSha256, value.recoveryCapsuleSha256, contentSha256].every(
          hash,
        ) ||
        !Number.isSafeInteger(value.writerPid) ||
        value.writerPid <= 0 ||
        ![value.dev, value.ino].every(
          (v) => Number.isSafeInteger(v) && v >= 0,
        ) ||
        sha256(canonicalJson(content)) !== contentSha256
      )
        throw new Error("Patch recovery intent is invalid");
      return value;
    },
  });
}

export function recordWorkspacePatchPreparation(
  store: PatchPreparationJournal,
  threadId: string,
  runId: string,
): RecordWorkspacePatchPreparation {
  return async (callId, args, result, identity) => {
    const events = await store.listRunEvents(runId);
    const boundaries = liveToolEffectAuthoritiesFromEvents(events).filter(
      (authority) =>
        authority.current &&
        patchEventPayload(authority.boundaryEvent)["parentCallId"] === callId,
    );
    if (boundaries.length !== 1)
      throw new Error(
        "Patch preparation requires one current execution boundary",
      );
    const boundary = boundaries[0]!.boundaryEvent!;
    const inputSha256 = sha256(
      canonicalJson({ toolName: "apply_patch", args }),
    );
    const started = patchStartForBoundary(events, boundary);
    if (!started || patchEventPayload(started)["inputSha256"] !== inputSha256)
      throw new Error("Patch preparation execution binding changed");
    const recoveryCapsuleSha256 = await new WorkspacePatchRecoveryCapsules(
      store.dataRoot,
    ).put(store.workspaceRoot, callId, args, result);
    const intent = {
      schemaVersion: 1 as const,
      threadId,
      runId,
      callId,
      inputSha256,
      recoveryCapsuleSha256,
      writerPid: process.pid,
      ...identity,
    };
    const capsuleSha256 = sha256(canonicalJson(intent));
    await workspacePatchIntents(store.dataRoot).put(
      capsuleSha256,
      canonicalJson({ ...intent, contentSha256: capsuleSha256 }),
    );
    const content = {
      schemaVersion: 2 as const,
      callId,
      operationId: String(patchEventPayload(boundary)["operationId"]),
      inputSha256,
      boundaryEventSeq: boundary.seq,
      capsuleSha256,
      recoveryCapsuleSha256,
      pathSha256: result.pathSha256,
      beforeSha256: result.beforeSha256,
      afterSha256: result.afterSha256,
    };
    const prepared = await claimRunHeadEvent(
      store,
      {
        threadId,
        runId,
        type: "workspace.patch.prepared",
        category: "tool",
        visibility: "debug",
        payload: { ...content, contentSha256: sha256(canonicalJson(content)) },
      },
      { namespace: "workspace-patch-prepared", key: `${runId}:${callId}` },
    );
    // Version 2 preparation promises that commit cannot happen without this
    // later durable gate. Run/operation fencing rejects a late original writer.
    return async () => {
      const commit = await claimRunHeadEvent(
        store,
        {
          threadId,
          runId,
          type: "workspace.patch.commit_started",
          category: "tool",
          visibility: "debug",
          payload: patchCommitStartedPayload(prepared.event),
        },
        { namespace: "workspace-patch-commit", key: `${runId}:${callId}` },
      );
      if (!commit.appended) throw new Error("Patch commit gate was already consumed");
    };
  };
}

export function patchCommitStartedPayload(prepared: RunEvent): JsonObject {
  if (
    !validPatchPreparation(prepared.payload) ||
    prepared.payload.schemaVersion !== 2
  )
    throw new Error("Patch commit requires version 2 preparation");
  const content = {
    schemaVersion: 1,
    callId: prepared.payload.callId,
    operationId: prepared.payload.operationId,
    preparedEventSeq: prepared.seq,
    preparedSha256: prepared.payload.contentSha256,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

export function patchStartForBoundary(
  events: RunEvent[],
  boundary: RunEvent,
): RunEvent | undefined {
  if (
    events.length > 10_000 ||
    patchEventPayload(boundary)["route"] !== "apply_patch"
  )
    return undefined;
  const operationId = patchEventPayload(boundary)["operationId"];
  if (typeof operationId !== "string") return undefined;
  const state = toolOperationLedgerState(events, operationId);
  const phases = [
    state.proposed,
    state.admitted,
    state.started,
    state.effectBoundary,
  ];
  if (
    state.admission !== "admitted" ||
    state.effectBoundary?.seq !== boundary.seq ||
    phases.some(
      (event) =>
        !event ||
        event.runId !== boundary.runId ||
        patchEventPayload(event)["descriptorSha256"] !==
          patchEventPayload(boundary)["descriptorSha256"] ||
        !validToolOperationEventPayload(
          event.type as "tool.operation.started",
          event.payload,
        ),
    )
  )
    return undefined;
  const starts = events.filter(
    (event) =>
      event.type === "tool.started" &&
      event.runId === boundary.runId &&
      patchEventPayload(event)["callId"] ===
        patchEventPayload(boundary)["parentCallId"],
  );
  const started = starts[0];
  return starts.length === 1 &&
    patchEventPayload(started)["toolName"] === "apply_patch" &&
    hash(patchEventPayload(started)["inputSha256"]) &&
    started &&
    started.seq < boundary.seq
    ? started
    : undefined;
}

export function preparedPatchForBoundary(
  events: RunEvent[],
  boundary: RunEvent,
): (RunEvent & { payload: PatchPreparationReceipt }) | undefined {
  const started = patchStartForBoundary(events, boundary);
  if (!started) return undefined;
  const candidates = events.filter(
    (event) =>
      event.type === "workspace.patch.prepared" &&
      event.runId === boundary.runId &&
      patchEventPayload(event)["callId"] ===
        patchEventPayload(started)["callId"],
  );
  const prepared = candidates[0];
  if (
    candidates.length !== 1 ||
    !prepared ||
    !validPatchPreparation(prepared.payload) ||
    prepared.seq <= boundary.seq ||
    prepared.payload.inputSha256 !==
      patchEventPayload(started)["inputSha256"] ||
    prepared.payload.operationId !==
      patchEventPayload(boundary)["operationId"] ||
    prepared.payload.boundaryEventSeq !== boundary.seq
  )
    return undefined;
  return prepared as RunEvent & { payload: PatchPreparationReceipt };
}

export function validPatchPreparation(
  value: JsonValue,
): value is PatchPreparationReceipt {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const { contentSha256, ...content } = value;
  return (
    Object.keys(value).length === 11 &&
    (value["schemaVersion"] === 1 || value["schemaVersion"] === 2) &&
    text(value["callId"]) &&
    text(value["operationId"]) &&
    Number.isSafeInteger(value["boundaryEventSeq"]) &&
    Number(value["boundaryEventSeq"]) > 0 &&
    [
      contentSha256,
      value["inputSha256"],
      value["capsuleSha256"],
      value["recoveryCapsuleSha256"],
      value["pathSha256"],
      value["afterSha256"],
    ].every(hash) &&
    (value["beforeSha256"] === null || hash(value["beforeSha256"])) &&
    sha256(canonicalJson(content)) === contentSha256
  );
}
function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256;
}

export function patchEventPayload(event: RunEvent | undefined): JsonObject {
  const value = event?.payload;
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}
