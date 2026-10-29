import type { JsonObject, RunEvent, SubagentTask, ThreadImportProvenance } from "@napier/contracts";
import { realpath } from "node:fs/promises";
import { canonicalJson, sha256 } from "./ed25519.js";
import { nowIso } from "./ids.js";
import type { SubagentChildRunHost } from "./subagent-child-run-host.js";
import { assertSubagentOutcomeBinding } from "./subagent-outcomes.js";
import { assertWorkflowValue } from "./workflow-schemas.js";
import { subagentOutputSchemaSha256 } from "./subagent-output-schema.js";
import { normalizeSubagentWorktreePath } from "./subagent-worktree-path.js";
import { LEGACY_CHANGE_COUNTS, LEGACY_PREVIEW_FIELDS } from "./subagent-candidate-legacy-validation.js";
import { resolveLegacyCandidateProof, type LegacyCandidateEvidence, type LegacyCandidateMigrationProof,
  type LegacyCandidateMigrationReceipt } from "./subagent-candidate-legacy-capability.js";
export type { LegacyCandidateMigrationProof } from "./subagent-candidate-legacy-capability.js";

export const LEGACY_CANDIDATE_MIGRATED_EVENT = "subagent.candidate.legacy_migrated";

/** Reconciles a narrow local delivery proof. Never manufactures historical completion. */
export class LegacySubagentCandidateRepository {
  constructor(private readonly host: SubagentChildRunHost) {}

  reconcile(proof: LegacyCandidateMigrationProof): Promise<LegacyCandidateMigrationReceipt | undefined> {
    this.host.assertInitialized();
    return this.host.stateQueue.run(async () => {
      const evidence = resolveLegacyCandidateProof(proof);
      if (evidence.dataRoot !== await realpath(this.host.dataRoot) || evidence.workspaceRoot !== await realpath(this.host.workspaceRoot))
        invalid("workspace identity changed");
      const task = originalTask(this.host, evidence.source.taskId);
      const thread = this.host.mutableThread(task.threadId);
      const result = originalResult(task);
      const { parent, child } = originalRuns(this.host, task);
      const events = this.host.requireLedger().listRunEvents(task.runId);
      const childEvents = this.host.requireLedger().listRunEvents(task.childRunId);
      const terminals = childEvents.filter((event) => ["run.completed", "run.failed", "run.cancelled", "run.interrupted"].includes(event.type));
      const terminal = terminals[0];
      if (terminals.length !== 1 || terminal?.type !== "run.completed" ||
          record(terminal.payload)["taskId"] !== task.id || record(terminal.payload)["executionId"] !== task.executionId)
        invalid("original child completion event is unavailable");
      const completed = exactlyOne(events, "subagent.completed", task.id);
      const accepted = exactlyOne(events, result.resultKind === "outcome" ? "subagent.outcome.accepted" : "subagent.output.accepted", task.id);
      assertNativeOrigin(task, thread.importProvenance, events, childEvents, parent.startedAt);
      assertPublication(task, evidence, completed, accepted, terminal);
      assertEvidence(task, evidence, completed, accepted, result);
      if (evidence.purpose === "migration" && Date.parse(evidence.expiresAt) <= Date.now())
        invalid("expired before migration could commit");
      const base = {
        kind: "napier.subagent-legacy-candidate-migration" as const, schemaVersion: 1 as const,
        candidateId: evidence.candidateId,
        candidateSourceSha256: sha256(canonicalJson({ ...evidence.source, files: [] })),
        candidateIdentityEvidence: "current_private_capsule" as const,
        sourceConstraint: { kind: "original_full_source_snapshot" as const, contentSha256: evidence.source.sourceSnapshotSha256 },
        taskId: task.id, threadId: thread.id, parentRunId: parent.id, childRunId: child.id, executionId: task.executionId,
        taskSha256: sha256(canonicalJson(task)), ...result,
        completedEventId: completed.id, completedEventSha256: sha256(canonicalJson(completed)),
        acceptedEventSha256: sha256(canonicalJson(accepted)), terminalEventSha256: sha256(canonicalJson(terminal)),
        workspaceRootSha256: sha256(evidence.workspaceRoot), dataRootSha256: sha256(evidence.dataRoot),
        candidateCreatedAt: evidence.createdAt, candidateExpiresAt: evidence.expiresAt,
      };
      const previous = events.filter((event) => event.type === LEGACY_CANDIDATE_MIGRATED_EVENT &&
        record(event.payload)["taskId"] === task.id);
      if (previous.length) {
        const receipt = record(previous[0]!.payload) as unknown as LegacyCandidateMigrationReceipt;
        const { contentSha256, migratedAt, ...identity } = receipt;
        if (previous.length !== 1 || !Number.isFinite(Date.parse(migratedAt)) ||
            canonicalJson(identity) !== canonicalJson(base) || sha256(canonicalJson({ ...identity, migratedAt })) !== contentSha256)
          invalid("migration receipt conflicts with original evidence");
        return structuredClone(receipt);
      }
      if (evidence.purpose === "settled_result") return undefined;
      const content = { ...base, migratedAt: nowIso() };
      const receipt: LegacyCandidateMigrationReceipt = { ...content, contentSha256: sha256(canonicalJson(content)) };
      const appended = this.host.appendEventsToThread(thread, [{ threadId: thread.id, runId: parent.id,
        type: LEGACY_CANDIDATE_MIGRATED_EVENT, category: "subagent", visibility: "debug",
        payload: JSON.parse(canonicalJson(receipt)) as JsonObject }]);
      await this.host.persistState(appended);
      return receipt;
    });
  }
}

type OriginalTask = SubagentTask & Required<Pick<SubagentTask, "childRunId" | "executionId">>;
function originalTask(host: SubagentChildRunHost, taskId: string): OriginalTask {
  const task = host.state.subagents.find((entry) => entry.id === taskId);
  if (!task || task.role !== "coder" || task.status !== "completed" || task.stopReason !== "completed" ||
      task.completion || task.completionReservation || !task.childRunId || !task.executionId ||
      task.error || task.usageStatus !== "complete")
    invalid("original completed coder result is unavailable");
  return task as OriginalTask;
}

type OriginalResult = Pick<LegacyCandidateMigrationReceipt, "resultKind" | "resultSha256" | "outputSchemaSha256">;
function originalResult(task: SubagentTask): OriginalResult {
  if (task.outcome) {
    if (task.output !== undefined || task.outputSchema) invalid("outcome conflicts with typed output");
    assertSubagentOutcomeBinding(task.outcome, task);
    return { resultKind: "outcome", resultSha256: task.outcome.contentSha256 };
  }
  if (!task.outputSchema || task.output === undefined || task.outputSchemaSha256 !== subagentOutputSchemaSha256(task.outputSchema))
    invalid("typed output schema binding is unavailable");
  assertWorkflowValue(task.outputSchema, task.output, "Legacy candidate typed output");
  return { resultKind: "typed_output", resultSha256: sha256(canonicalJson(task.output)), outputSchemaSha256: task.outputSchemaSha256 };
}
function originalRuns(host: SubagentChildRunHost, task: OriginalTask) {
  const parent = host.mutableRun(task.runId), child = host.mutableRun(task.childRunId);
  if (parent.threadId !== task.threadId || child.threadId !== task.threadId || child.parentRunId !== parent.id ||
      child.source !== "subagent" || child.status !== "completed" || child.finishedAt !== task.finishedAt ||
      child.subagent?.taskId !== task.id || child.subagent.executionId !== task.executionId ||
      child.usageStatus !== "complete" || canonicalJson(child.usage) !== canonicalJson(task.usage))
    invalid("native child terminal binding is unavailable");
  return { parent, child };
}

function assertEvidence(task: SubagentTask, evidence: LegacyCandidateEvidence,
  completed: RunEvent, accepted: RunEvent, result: OriginalResult): void {
  const source = evidence.source, payload = record(completed.payload), acceptance = record(accepted.payload);
  const metadata = source as unknown as Record<string, unknown>;
  const writePaths = (task.writePaths ?? []).map(normalizeSubagentWorktreePath).sort();
  if (!writePaths.length || new Set(writePaths).size !== writePaths.length || source.writeScopeCount !== writePaths.length ||
      source.writeScopeSetSha256 !== sha256(canonicalJson(writePaths.map((entry) => sha256(entry)))) ||
      source.changes.some((change) => !writePaths.includes(change.path)) || source.outcomeSha256 !== result.resultSha256)
    invalid("candidate outcome or write scope binding changed");
  const expected: JsonObject = { taskId: task.id, role: task.role, description: task.description,
    status: task.status, result: task.result ?? "", error: task.error ?? "", stopReason: task.stopReason ?? "",
    stepCount: task.stepCount, turnCount: task.turnCount, usage: JSON.parse(canonicalJson(task.usage)) as JsonObject,
    ...(task.outcome ? { outcome: JSON.parse(canonicalJson(task.outcome)) as JsonObject } : {}),
    workspaceMode: "isolated_write", mergePreviewAvailable: true };
  if (Object.entries(expected).some(([key, value]) => canonicalJson(payload[key]) !== canonicalJson(value)) ||
      payload["completionSha256"] !== undefined || payload["logicalCompletionKey"] !== undefined ||
      LEGACY_PREVIEW_FIELDS.some((key) => payload[key] !== metadata[key]) ||
      LEGACY_CHANGE_COUNTS.some((key) => payload[`candidate${key[0]!.toUpperCase()}${key.slice(1)}`] !== source[key]) ||
      (!task.outcome && payload["outcome"] !== undefined))
    invalid("postcommit outcome or candidate content evidence changed");
  assertAcceptance(task, acceptance, result);
}

function assertAcceptance(task: SubagentTask, acceptance: JsonObject, result: OriginalResult): void {
  if (acceptance["status"] !== "accepted") invalid("result was not accepted");
  if (task.outcome) {
    const fields = ["resultSha256", "itemSetSha256", "evidenceSetSha256", "itemCount", "unknownCount", "evidenceCount"] as const;
    if (acceptance["outcomeSha256"] !== result.resultSha256 || fields.some((field) => acceptance[field] !== task.outcome![field]))
      invalid("accepted outcome binding changed");
  } else if (acceptance["outputSha256"] !== result.resultSha256 || acceptance["outputSchemaSha256"] !== result.outputSchemaSha256)
    invalid("accepted typed output binding changed");
}

function assertPublication(task: SubagentTask, evidence: LegacyCandidateEvidence,
  completed: RunEvent, accepted: RunEvent, terminal: RunEvent): void {
  const started = Date.parse(task.startedAt ?? ""), created = Date.parse(evidence.createdAt),
    finished = Date.parse(task.finishedAt ?? ""), published = Date.parse(completed.createdAt);
  if (![started, created, finished, published].every(Number.isFinite) ||
      created < started || created > finished || finished > published ||
      !(terminal.seq < accepted.seq && accepted.seq < completed.seq))
    invalid("candidate lacks original postcommit publication order");
}

function assertNativeOrigin(task: SubagentTask, provenance: ThreadImportProvenance | undefined,
  parentEvents: RunEvent[], childEvents: RunEvent[], parentStartedAt: string): void {
  const started = exactlyOne(childEvents, "run.started", task.id), payload = record(started.payload);
  if (payload["executionId"] !== task.executionId || payload["parentRunId"] !== task.runId)
    invalid("original child start binding changed");
  if (!provenance) return;
  const cutoff = provenance.localImportedThroughSeq ?? provenance.sourceEventCount;
  if (started.seq <= cutoff || parentEvents.some((event) => event.seq <= cutoff) ||
      Date.parse(task.createdAt) < Date.parse(provenance.importedAt) || Date.parse(parentStartedAt) < Date.parse(provenance.importedAt))
    invalid("imported evidence cannot grant local delivery authority");
}

function exactlyOne(events: RunEvent[], type: string, taskId: string): RunEvent {
  const found = events.filter((event) => event.type === type && record(event.payload)["taskId"] === taskId);
  if (found.length !== 1) invalid(`original ${type} evidence is missing or ambiguous`);
  return found[0]!;
}
function record(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("event payload is invalid");
  return value as JsonObject;
}
function invalid(reason: string): never { throw new Error(`Legacy candidate ${reason}; retained for inspection`); }
