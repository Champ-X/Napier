import {
  type AutomaticRecoveryAssessment,
  type AutomaticRecoveryAttempt,
  type JsonObject,
  type JsonValue,
  type RunEvent,
  type SubagentTask,
  type ThreadDetail,
  type ThreadImportProvenance,
  type ThreadRecord,
  type ThreadReplayBundle,
  type ThreadStatus,
} from "@napier/contracts";
import { type PersistedAutomaticRecoveryAttempt } from "./automatic-recovery-store-records.js";
import {
  hashAutomaticRecoveryAssessment,
  hashAutomaticRecoveryAttempt,
  hashAutomaticRecoveryEventStream,
  validateAutomaticRecoveryAssessment,
  validateAutomaticRecoveryAttempt,
} from "./automatic-recovery.js";
import { createId, nowIso } from "./ids.js";
import type { StoreRepositoryHost } from "./store-repository-host.js";
import {
  rebindSubagentOutcomeRepairOutcome,
  rebindSubagentOutcomeRepairRequest,
  validateSubagentOutcomeRepairOutcome,
  validateSubagentOutcomeRepairRequest,
} from "./subagent-outcome-repair.js";
import { rebindSubagentOutcome } from "./subagent-outcomes.js";
import {
  validateThreadReplayBundle,
  verifyThreadReplayBundle,
} from "./thread-bundles.js";
import {
  dropPrivateImportedEvent,
  remapImportedEventPayload,
} from "./thread-import-event-payload.js";
import {
  createImportedAgent,
  createImportedPlans,
  createImportedRuns,
  createThreadReplayImportIds,
} from "./thread-replay-import-context.js";
import { createImportedEvaluationRecords } from "./thread-replay-import-evaluations.js";

const THREAD_IMPORTED_EVENT = "thread.imported";

function normalizeImportedThreadTitle(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, 100) : "Imported ledger";
}

function rebindImportedSubagentEventPayload(
  type: string,
  sourcePayload: JsonValue,
  payload: JsonValue,
  tasks: ReadonlyMap<string, SubagentTask>,
  idMap: Map<string, string>,
): JsonValue {
  if (type === "subagent.outcome.repair.requested") {
    const source = validateSubagentOutcomeRepairRequest(sourcePayload);
    const taskId = idMap.get(source.taskId);
    if (!taskId || !tasks.has(taskId)) {
      throw new Error("Imported Subagent outcome repair task is missing");
    }
    const rebound = rebindSubagentOutcomeRepairRequest(source, taskId);
    idMap.set(source.contentSha256, rebound.contentSha256);
    return rebound as unknown as JsonValue;
  }
  if (type === "subagent.outcome.repair.outcome") {
    const source = validateSubagentOutcomeRepairOutcome(sourcePayload);
    const taskId = idMap.get(source.taskId);
    const requestContentSha256 = idMap.get(source.requestContentSha256);
    const task = taskId ? tasks.get(taskId) : undefined;
    const importedOutcomeSha256 =
      source.status === "accepted" ? task?.outcome?.contentSha256 : undefined;
    if (
      !taskId ||
      !requestContentSha256 ||
      !task ||
      (source.status === "accepted" && !importedOutcomeSha256)
    ) {
      throw new Error("Imported Subagent outcome repair binding is missing");
    }
    const rebound = rebindSubagentOutcomeRepairOutcome(source, {
      taskId,
      requestContentSha256,
      ...(importedOutcomeSha256
        ? { outcomeSha256: importedOutcomeSha256 }
        : {}),
    });
    idMap.set(source.contentSha256, rebound.contentSha256);
    return rebound as unknown as JsonValue;
  }
  if (
    (type !== "subagent.outcome.accepted" && type !== "subagent.completed") ||
    !payload ||
    Array.isArray(payload) ||
    typeof payload !== "object"
  ) {
    return payload;
  }
  const taskId = payload["taskId"];
  const task = typeof taskId === "string" ? tasks.get(taskId) : undefined;
  if (!task?.outcome) return payload;
  if (type === "subagent.completed") {
    return {
      ...payload,
      outcome: structuredClone(task.outcome) as unknown as JsonValue,
    };
  }
  return {
    ...payload,
    outcomeSha256: task.outcome.contentSha256,
    resultSha256: task.outcome.resultSha256,
    itemSetSha256: task.outcome.itemSetSha256,
    itemCount: task.outcome.itemCount,
    unknownCount: task.outcome.unknownCount,
    ...(task.outcome.schemaVersion === 2
      ? {
          evidenceSetSha256: task.outcome.evidenceSetSha256!,
          evidenceCount: task.outcome.evidenceCount!,
        }
      : {}),
  };
}

function threadImportProvenanceEventPayload(
  provenance: ThreadImportProvenance,
): JsonObject {
  return {
    kind: "napier.thread-import-provenance",
    sourceThreadId: provenance.sourceThreadId,
    sourceApiVersion: provenance.sourceApiVersion,
    sourceContentSha256: provenance.sourceContentSha256,
    sourceEventStreamSha256: provenance.sourceEventStreamSha256,
    sourceEventCount: provenance.sourceEventCount,
    localImportedThroughSeq: threadImportProvenanceLocalCutoff(provenance),
    sourceModelContextEnvelopeCount:
      provenance.sourceModelContextEnvelopeCount ?? 0,
    sourceEmbeddedModelContextEnvelopeCount:
      provenance.sourceEmbeddedModelContextEnvelopeCount ?? 0,
    importedAt: provenance.importedAt,
  };
}

function threadImportProvenanceLocalCutoff(
  provenance: ThreadImportProvenance,
): number {
  return provenance.localImportedThroughSeq ?? provenance.sourceEventCount;
}

export class ThreadReplayImportRepository {
  constructor(private readonly host: StoreRepositoryHost) {}

  async importThreadReplayBundle(
    input: ThreadReplayBundle,
    title?: string,
  ): Promise<ThreadDetail> {
    this.host.assertInitialized();
    const bundle = validateThreadReplayBundle(input);
    const bundleVerification = verifyThreadReplayBundle(bundle);
    if (bundleVerification.status !== "valid") {
      throw new Error(
        `Thread replay bundle verification failed: ${bundleVerification.diagnostics.join(", ")}`,
      );
    }
    const importedThreadId = await this.host.stateQueue.run(async () => {
      const importedAt = nowIso();
      const ids = createThreadReplayImportIds(bundle);
      const { agent, agentRevisions } = createImportedAgent(
        bundle,
        ids,
        importedAt,
      );
      const { runs, activeRunIds } = createImportedRuns(
        bundle,
        ids,
        agent,
        importedAt,
      );
      const plans = createImportedPlans(bundle, ids, importedAt);
      const {
        evaluations,
        evaluationAdjudications,
        evaluationReviewerBallots,
        evaluationConsensusResolutions,
        evaluationSuites,
        evaluationSuiteExecutions,
      } = createImportedEvaluationRecords(bundle, ids, runs);
      const {
        agentId,
        threadId,
        runIds,
        auxiliaryRunIds,
        automaticRecoveryAttemptIds,
        taskIds,
        eventIds,
        idMap,
      } = ids;
      const subagents: SubagentTask[] = bundle.subagents.map((source) => {
        const active =
          source.status === "pending" || source.status === "running";
        const { outcome: _outcome, ...sourceTask } = structuredClone(source);
        const taskId = taskIds.get(source.id)!;
        return {
          ...sourceTask,
          id: taskId,
          threadId,
          runId: runIds.get(source.runId)!,
          ...(!active && source.outcome
            ? {
                outcome: rebindSubagentOutcome(source.outcome, {
                  taskId,
                  prompt: source.prompt,
                }),
              }
            : {}),
          ...(active
            ? {
                status: "cancelled" as const,
                stopReason: "cancelled" as const,
                error:
                  "Imported fixture captured this subagent before it reached a terminal state.",
                finishedAt: importedAt,
                revision: source.revision + 1,
              }
            : {}),
        };
      });
      const subagentsById = new Map(
        subagents.map((task) => [task.id, task] as const),
      );
      const importedEvents = bundle.events.filter(dropPrivateImportedEvent);
      const events: RunEvent[] = importedEvents.map((source, index) => {
        const payload = rebindImportedSubagentEventPayload(
          source.type,
          source.payload,
          remapImportedEventPayload(source.type, source.payload, idMap),
          subagentsById,
          idMap,
        );
        return {
          id: eventIds.get(source.id)!,
          threadId,
          runId: runIds.get(source.runId) ?? auxiliaryRunIds.get(source.runId)!,
          seq: index + 1,
          type: source.type,
          category: source.category,
          visibility: source.visibility,
          createdAt: source.createdAt,
          payload,
          ...(source.schemaVersion !== undefined
            ? { schemaVersion: source.schemaVersion }
            : {}),
        };
      });
      const mappedAssessmentSha256 = new Map<string, string>();
      const automaticRecoveryAssessments: AutomaticRecoveryAssessment[] = (
        bundle.automaticRecoveryAssessments ?? []
      )
        .slice()
        .sort(
          (left, right) =>
            left.priorAttempts - right.priorAttempts ||
            left.assessedAt.localeCompare(right.assessedAt),
        )
        .map((source) => {
          for (const event of events) {
            event.payload = remapImportedEventPayload(
              event.type,
              event.payload,
              idMap,
            );
          }
          const mappedRunId = runIds.get(source.runId)!;
          const mappedRootRunId = runIds.get(source.rootRunId)!;
          const mappedRunEvents = events.filter(
            (event) => event.runId === mappedRunId,
          );
          const {
            contentSha256: _contentSha256,
            eventRange: _eventRange,
            ...sourceContent
          } = source;
          const content: Omit<AutomaticRecoveryAssessment, "contentSha256"> = {
            ...structuredClone(sourceContent),
            threadId,
            runId: mappedRunId,
            rootRunId: mappedRootRunId,
            agentId,
            eventRange: {
              fromSeq: mappedRunEvents[0]?.seq ?? 0,
              toSeq: mappedRunEvents.at(-1)?.seq ?? 0,
              eventCount: mappedRunEvents.length,
              eventStreamSha256:
                hashAutomaticRecoveryEventStream(mappedRunEvents),
            },
          };
          const mapped = validateAutomaticRecoveryAssessment({
            ...content,
            contentSha256: hashAutomaticRecoveryAssessment(content),
          });
          mappedAssessmentSha256.set(
            source.contentSha256,
            mapped.contentSha256,
          );
          idMap.set(source.contentSha256, mapped.contentSha256);
          return mapped;
        });
      const automaticRecoveryAttempts: PersistedAutomaticRecoveryAttempt[] = (
        bundle.automaticRecoveryAttempts ?? []
      ).map((source) => {
        const id = automaticRecoveryAttemptIds.get(source.id)!;
        const rootRunId = runIds.get(source.rootRunId)!;
        const interruptedRunId = runIds.get(source.interruptedRunId)!;
        const assessmentSha256 = mappedAssessmentSha256.get(
          source.assessmentSha256,
        )!;
        const mappedRecoveryRunId = source.recoveryRunId
          ? runIds.get(source.recoveryRunId)
          : undefined;
        const convertedClaimed = source.status === "claimed";
        const convertedRunning = source.status === "running";
        const status: AutomaticRecoveryAttempt["status"] = convertedClaimed
          ? "abandoned"
          : convertedRunning
            ? "interrupted"
            : source.status;
        const triggerId = `automatic-recovery:${rootRunId}:${source.attempt}`;
        const recoveryRun = mappedRecoveryRunId
          ? runs.find((run) => run.id === mappedRecoveryRunId)
          : undefined;
        if (recoveryRun) recoveryRun.triggerId = triggerId;
        const converted = convertedClaimed || convertedRunning;
        const content: Omit<AutomaticRecoveryAttempt, "contentSha256"> = {
          id,
          threadId,
          agentId,
          rootRunId,
          interruptedRunId,
          attempt: source.attempt,
          maxAttempts: source.maxAttempts,
          triggerId,
          assessmentSha256,
          status,
          ...(!convertedClaimed && mappedRecoveryRunId
            ? { recoveryRunId: mappedRecoveryRunId }
            : {}),
          ...(converted
            ? {
                error:
                  "Imported fixture closed an in-flight automatic recovery attempt.",
              }
            : source.error
              ? { error: source.error }
              : {}),
          createdAt: source.createdAt,
          updatedAt: converted ? importedAt : source.updatedAt,
          ...(!convertedClaimed && source.startedAt
            ? { startedAt: source.startedAt }
            : {}),
          ...(converted
            ? { finishedAt: importedAt }
            : source.finishedAt
              ? { finishedAt: source.finishedAt }
              : {}),
          revision: source.revision + (converted ? 1 : 0),
        };
        const mapped = validateAutomaticRecoveryAttempt({
          ...content,
          contentSha256: hashAutomaticRecoveryAttempt(content),
        });
        idMap.set(source.contentSha256, mapped.contentSha256);
        return mapped;
      });
      for (const event of events) {
        event.payload = remapImportedEventPayload(
          event.type,
          event.payload,
          idMap,
        );
      }
      const importedStatus: ThreadStatus =
        activeRunIds.size > 0 || bundle.thread.status === "waiting"
          ? "waiting"
          : bundle.thread.status === "failed"
            ? "failed"
            : "idle";
      const goal = bundle.thread.goal
        ? structuredClone(bundle.thread.goal)
        : undefined;
      if (goal?.lastEvaluatedRunId) {
        goal.lastEvaluatedRunId =
          runIds.get(goal.lastEvaluatedRunId) ?? goal.lastEvaluatedRunId;
      }
      const localImportedThroughSeq = events.length + 1;
      const importProvenance: ThreadImportProvenance = {
        sourceThreadId: bundle.thread.id,
        sourceApiVersion: bundle.apiVersion,
        sourceContentSha256: bundle.contentSha256,
        sourceEventStreamSha256: bundle.eventStreamSha256,
        sourceEventCount: bundle.events.length,
        localImportedThroughSeq,
        sourceModelContextEnvelopeCount:
          bundleVerification.modelContextEnvelopeCount,
        sourceEmbeddedModelContextEnvelopeCount:
          bundleVerification.embeddedModelContextEnvelopeCount,
        importedAt,
      };
      const thread: ThreadRecord = {
        id: threadId,
        title: normalizeImportedThreadTitle(
          title ?? `${bundle.thread.title} (imported)`,
        ),
        agentId,
        status: importedStatus,
        createdAt: importedAt,
        updatedAt: importedAt,
        lastMessage: bundle.thread.lastMessage,
        eventCount: events.length,
        ...(goal ? { goal } : {}),
        runIds: bundle.thread.runIds.map((runId) => runIds.get(runId)!),
        importProvenance,
      };
      events.push(
        ...this.host.appendEventsToThread(
          thread,
          [
            {
              threadId,
              runId: createId("runctl"),
              type: THREAD_IMPORTED_EVENT,
              category: "lifecycle",
              visibility: "debug",
              payload: threadImportProvenanceEventPayload(importProvenance),
            },
          ],
          { createdAt: importedAt },
        ),
      );
      this.host.state.agents.push(agent);
      this.host.state.agentRevisions.push(...agentRevisions);
      this.host.state.threads.push(thread);
      this.host.state.runs.push(...runs);
      this.host.state.plans.push(...plans);
      this.host.state.evaluations.push(...evaluations);
      this.host.state.evaluationAdjudications.push(...evaluationAdjudications);
      this.host.state.evaluationReviewerBallots.push(
        ...evaluationReviewerBallots,
      );
      this.host.state.evaluationConsensusResolutions.push(
        ...evaluationConsensusResolutions,
      );
      this.host.state.evaluationSuites.push(...evaluationSuites);
      this.host.state.evaluationSuiteExecutions.push(
        ...evaluationSuiteExecutions,
      );
      this.host.state.automaticRecoveryAssessments.push(
        ...automaticRecoveryAssessments,
      );
      this.host.state.automaticRecoveryAttempts.push(
        ...automaticRecoveryAttempts,
      );
      this.host.state.subagents.push(...subagents);
      await this.host.persistState(events);
      return threadId;
    });
    return this.host.getDetail(importedThreadId);
  }
}
