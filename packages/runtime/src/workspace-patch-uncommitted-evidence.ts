import type { RunEvent } from "@napier/contracts";
import {
  patchEventPayload,
  preparedPatchForBoundary,
} from "./workspace-patch-preparation.js";
import {
  validPatchInvocationReceipt,
  type PatchInvocationReceipt,
} from "./workspace-patch-invocation.js";
import { toolOperationLedgerState } from "./tool-operation-ledger-support.js";
import { validToolOperationEventPayload } from "./tool-operation-event-validation.js";
import { notCommittedPatchForBoundary } from "./workspace-patch-not-committed.js";

export interface UncommittedPatchEvidence {
  callId: string;
  operationId: string;
  startedSeq: number;
  terminalSeq: number;
  checkpoint: "before_effect" | "before_commit";
  invocation: PatchInvocationReceipt;
}

/** Negative evidence is valid only after the original Run is durably fenced. */
export function uncommittedPatchCandidates(
  events: RunEvent[],
): UncommittedPatchEvidence[] {
  if (events.length > 10_000) return [];
  return events.flatMap((started) => {
    if (
      started.type !== "tool.started" ||
      patchEventPayload(started)["toolName"] !== "apply_patch"
    )
      return [];
    const candidate = uncommittedPatchForStart(events, started);
    return candidate ? [candidate] : [];
  });
}

function uncommittedPatchForStart(
  events: RunEvent[],
  started: RunEvent,
): UncommittedPatchEvidence | undefined {
  const scoped = events.filter(
    (event) =>
      event.runId === started.runId && event.threadId === started.threadId,
  );
  const callId = patchEventPayload(started)["callId"];
  if (typeof callId !== "string") return undefined;
  const callEvents = scoped.filter(
    (event) =>
      patchEventPayload(event)["callId"] === callId ||
      patchEventPayload(event)["parentCallId"] === callId,
  );
  if (
    callEvents.filter((event) => event.type === "tool.started").length !== 1 ||
    callEvents.some((event) =>
      [
        "tool.completed",
        "tool.failed",
        "tool.result_reused",
        "workspace.patch.commit_started",
      ].includes(event.type),
    )
  )
    return undefined;
  const invocation = invocationForStart(callEvents, started);
  if (!invocation) return undefined;
  const authority = authorityForStart(scoped, callEvents, started);
  if (!authority) return undefined;
  const { state, operationId } = authority;
  const terminals = scoped.filter((event) =>
    [
      "run.completed",
      "run.failed",
      "run.cancelled",
      "run.interrupted",
    ].includes(event.type),
  );
  const terminal = terminals[0];
  if (terminals.length !== 1 || !terminal || terminal.seq <= started.seq)
    return undefined;
  if (!state.effectBoundary) {
    if (
      terminal.type !== "run.interrupted" ||
      state.effectIndeterminate ||
      callEvents.some(
        (event) => patchEventPayload(event)["executionEffectBoundary"] === true,
      )
    )
      return undefined;
    return {
      callId,
      operationId,
      startedSeq: started.seq,
      terminalSeq: terminal.seq,
      checkpoint: "before_effect",
      invocation,
    };
  }
  const prepared = preparedPatchForBoundary(scoped, state.effectBoundary);
  if (
    !prepared ||
    prepared.payload.schemaVersion !== 2 ||
    !state.effectIndeterminate ||
    state.effectIndeterminate.seq <= prepared.seq ||
    terminal.seq <= state.effectIndeterminate.seq ||
    !validToolOperationEventPayload(
      "tool.operation.effect_indeterminate",
      state.effectIndeterminate.payload,
    ) ||
    patchEventPayload(state.effectIndeterminate)["effectBoundaryEventSeq"] !==
      state.effectBoundary.seq ||
    (!(
      terminal.type === "run.failed" &&
      patchEventPayload(terminal)["outcome"] === "blocked_safety"
    ) &&
      !(
        terminal.type === "run.interrupted" &&
        notCommittedPatchForBoundary(scoped, state.effectBoundary)
      ))
  )
    return undefined;
  return {
    callId,
    operationId,
    startedSeq: started.seq,
    terminalSeq: terminal.seq,
    checkpoint: "before_commit",
    invocation,
  };
}

function invocationForStart(
  callEvents: RunEvent[],
  started: RunEvent,
): PatchInvocationReceipt | undefined {
  const captures = callEvents.filter(
    (event) => event.type === "workspace.patch.invocation",
  );
  const capture = captures[0];
  if (
    captures.length !== 1 ||
    !capture ||
    !validPatchInvocationReceipt(capture.payload) ||
    capture.seq >= started.seq ||
    capture.payload.inputSha256 !== patchEventPayload(started)["inputSha256"]
  )
    return undefined;
  const admissions = callEvents.filter(
    (event) => event.type === "tool.admitted",
  );
  const protocol = patchEventPayload(admissions[0])["toolProtocol"];
  if (
    admissions.length !== 1 ||
    admissions[0]!.seq >= started.seq ||
    !protocol ||
    typeof protocol !== "object" ||
    Array.isArray(protocol) ||
    protocol["toolId"] !== "apply_patch" ||
    protocol["definitionSha256"] !== capture.payload.toolDefinitionSha256
  )
    return undefined;
  return capture.payload;
}
function authorityForStart(
  scoped: RunEvent[],
  callEvents: RunEvent[],
  started: RunEvent,
) {
  const proposals = callEvents.filter(
    (event) =>
      event.type === "tool.operation.proposed" &&
      patchEventPayload(event)["role"] === "execution_authority",
  );
  const operationId = patchEventPayload(proposals[0])["operationId"];
  if (proposals.length !== 1 || typeof operationId !== "string")
    return undefined;
  const state = toolOperationLedgerState(scoped, operationId);
  if (
    state.admission !== "admitted" ||
    state.settled ||
    !state.started ||
    !state.executionLease ||
    !state.proposed ||
    !state.admitted ||
    state.proposed.seq >= state.admitted.seq ||
    state.admitted.seq >= state.started.seq ||
    state.started.seq >= started.seq ||
    ![state.proposed, state.admitted, state.started].every(
      (event) =>
        event &&
        patchEventPayload(event)["route"] === "apply_patch" &&
        patchEventPayload(event)["role"] === "execution_authority" &&
        validToolOperationEventPayload(
          event.type as "tool.operation.started",
          event.payload,
        ) &&
        patchEventPayload(event)["descriptorSha256"] ===
          patchEventPayload(proposals[0])["descriptorSha256"],
    )
  )
    return undefined;
  return { state, operationId };
}
