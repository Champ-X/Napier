import type { SubagentCompletionCandidate, SubagentCompletionReservation, SubagentTask } from "@napier/contracts";
import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import { assertChildRunFence, childRunState } from "./subagent-child-run-fence.js";
import type { FinishSubagentChildRunInput } from "./subagent-child-run-types.js";
import { createPreparedSubagentCompletion, resolvePreparedSubagentCompletion } from "./subagent-completion-capability.js";
import { assertSubagentCompletionReceipt, completionReservationIdentity, subagentCompletionPayloadSha256 } from "./subagent-completion-receipt.js";
import type { PrepareSubagentCompletionInput, PreparedSubagentCompletionResult } from "./subagent-completion-types.js";
import { resolveSubagentLogicalIdentity } from "./subagent-continuation-lineage.js";
import type { FinishSubagentTaskInput } from "./subagent-completion-types.js";
import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";
import { subagentOutputSchemaSha256 } from "./subagent-output-schema.js";
import { assertWorkflowValue } from "./workflow-schemas.js";
import { assertChildLogicalInvocationsSettled } from "./model-accounting-fold.js";

export class SubagentCompletionRepository {
  constructor(private readonly host: SubagentChildRunHost) {}

  async prepare(input: PrepareSubagentCompletionInput): Promise<PreparedSubagentCompletionResult> {
    input = { ...input, finish: structuredClone(input.finish) };
    this.host.assertInitialized();
    const state = await this.host.stateQueue.run(async () => {
      input.assertActive?.();
      const { run, task } = assertChildRunFence(this.host, input, { checkRevision: false });
      assertChildLogicalInvocationsSettled(this.host.requireLedger().listRunEvents(run.id));
      if (run.usageStatus === "incomplete") throw new Error("Child completion has unresolved model invocations");
      if (input.finish.usage && canonicalJson(input.finish.usage) !== canonicalJson(run.usage))
        throw new Error("Child completion usage conflicts with settled invocation usage");
      const reservation = reserveSubagentCompletion(this.host, task, input.finish);
      // Exact retries return the durable slot. A different payload cannot create another key.
      if (!task.completionReservation) {
        if (input.expectedExecutionRevision !== undefined && input.expectedExecutionRevision !== run.subagent!.executionRevision)
          throw new Error("Child completion execution revision changed");
        task.completionReservation = reservation;
        task.revision += 1;
        run.subagent!.executionRevision += 1;
        await this.host.persistState();
      }
      return childRunState(run, task);
    });
    const reservation = state.task.completionReservation!;
    const { candidate: _candidate, ...base } = reservation;
    const prepared = createPreparedSubagentCompletion({ reservation: base,
      claimCandidate: (candidate) => this.claim({ ...input, expectedExecutionRevision: state.executionRevision }, base, candidate) });
    return { ...state, prepared };
  }

  async delivered(reservation: SubagentCompletionReservation, candidate: SubagentCompletionCandidate): Promise<boolean> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const task = this.host.state.subagents.find((entry) => entry.id === reservation.producerTaskId);
      if (!task?.completion) return false;
      const receipt = assertSubagentCompletionReceipt(task);
      assertLogicalSlot(this.host, task, receipt.reservation);
      return completionReservationIdentity(receipt.reservation) === completionReservationIdentity(reservation) &&
        canonicalJson(receipt.reservation.candidate) === canonicalJson(candidate);
    });
  }

  private async claim(input: PrepareSubagentCompletionInput, reservation: SubagentCompletionReservation,
    candidate: SubagentCompletionCandidate): Promise<void> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const task = this.host.state.subagents.find((entry) => entry.id === input.taskId);
      if (task?.role !== "coder") throw new Error("Only a coder completion may claim a writable candidate");
      if (!task?.completionReservation || completionReservationIdentity(task.completionReservation) !== completionReservationIdentity(reservation))
        throw new Error("Subagent completion reservation changed");
      const existing = task.completionReservation.candidate;
      if (existing && canonicalJson(existing) !== canonicalJson(candidate))
        throw new Error("Subagent logical completion candidate conflicts; retained candidate requires reconciliation");
      if (task.completion) {
        assertSubagentCompletionReceipt(task);
        if (existing) return;
        throw new Error("Subagent completion cannot adopt a candidate after commit");
      }
      assertChildRunFence(this.host, input);
      if (!existing) {
        task.completionReservation.candidate = structuredClone(candidate);
        task.revision += 1;
        await this.host.persistState();
      }
    });
  }
}

export function reserveSubagentCompletion(host: SubagentChildRunHost, task: SubagentTask,
  finish: FinishSubagentTaskInput): SubagentCompletionReservation {
  if (finish.status !== "completed" || finish.error !== undefined)
    throw new Error("Subagent completion reservation requires successful output");
  if (finish.outcome !== undefined) {
    if (finish.output !== undefined) throw new Error("Subagent completion cannot combine outcome and typed output");
    assertSubagentOutcomeBinding(finish.outcome, task);
  }
  if (task.outputSchema) {
    if (task.outputSchemaSha256 !== subagentOutputSchemaSha256(task.outputSchema))
      throw new Error("Subagent completion output schema binding changed");
    assertWorkflowValue(task.outputSchema, finish.output, "Subagent completion output");
  } else if (finish.output !== undefined) throw new Error("Subagent completion typed output requires its schema");
  const identity = resolveSubagentLogicalIdentity(host.state.runs, host.state.subagents, task.childRunId!);
  const logicalCompletionKey = sha256(canonicalJson({ logicalTaskId: identity.logicalTaskId,
    rootChildRunId: identity.rootChildRunId, rootIntentSha256: identity.rootIntentSha256 }));
  const existing = host.state.subagents.find((entry) => entry.completionReservation?.logicalCompletionKey === logicalCompletionKey);
  if (existing && existing.id !== task.id)
    throw new Error("Subagent logical completion belongs to its immutable predecessor; reconciliation is required");
  const payloadSha256 = subagentCompletionPayloadSha256(task, finish);
  if (task.completionReservation) {
    assertLogicalSlot(host, task, task.completionReservation);
    if (task.completionReservation.payloadSha256 !== payloadSha256)
      throw new Error("Subagent completion payload conflicts with its reserved result");
    return structuredClone(task.completionReservation);
  }
  return { kind: "napier.subagent-completion-reservation", schemaVersion: 1, ...identity,
    logicalCompletionKey, producerTaskId: task.id, producerRunId: task.childRunId!,
    producerExecutionId: task.executionId!, payloadSha256, createdAt: nowIso() };
}

export function validatePreparedCompletion(host: SubagentChildRunHost, task: SubagentTask, input: FinishSubagentChildRunInput): void {
  const capability = input.finish.preparedCompletion;
  if (!capability) {
    if (input.finish.candidateId || task.completionReservation?.candidate || task.role === "coder")
      throw new Error("Subagent candidate completion requires preparation authority");
    return;
  }
  const prepared = resolvePreparedSubagentCompletion(capability).reservation;
  const reservation = task.completionReservation;
  if (task.role === "coder" && !reservation?.candidate)
    throw new Error("Coder completion requires its fixed candidate");
  if (!reservation || completionReservationIdentity(prepared) !== completionReservationIdentity(reservation) ||
      prepared.producerRunId !== input.runId || prepared.producerTaskId !== input.taskId ||
      prepared.producerExecutionId !== input.executionId ||
      reservation.candidate?.id !== input.finish.candidateId ||
      reservation.payloadSha256 !== subagentCompletionPayloadSha256(task, input.finish))
    throw new Error("Subagent completion payload or candidate conflicts with preparation");
  assertLogicalSlot(host, task, reservation);
}

function assertLogicalSlot(host: SubagentChildRunHost, task: SubagentTask, reservation: SubagentCompletionReservation): void {
  const identity = resolveSubagentLogicalIdentity(host.state.runs, host.state.subagents, task.childRunId!);
  if (Object.entries(identity).some(([key, value]) => reservation[key as keyof typeof identity] !== value) ||
      reservation.producerTaskId !== task.id || reservation.producerRunId !== task.childRunId ||
      reservation.producerExecutionId !== task.executionId)
    throw new Error("Subagent completion lineage binding changed");
}
