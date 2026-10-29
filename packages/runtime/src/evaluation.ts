import {
  contentText,
  type Api,
  type AssistantMessage,
  type Model,
  type Usage as PiUsage,
} from "@earendil-works/pi-ai";
import type {
  CreateRunEvaluationRequest,
  EvaluationRubricSnapshot,
  JsonObject,
  ModelContextEnvelopeReceipt,
  ModelRef,
  RunEvaluationRecord,
  RunRecord,
  RunReplaySnapshot,
  Usage,
} from "@napier/contracts";

import { sha256 } from "./ed25519.js";
import type { ModelCallAttributionV1 } from "@napier/contracts/model-accounting";
import { modelAccountingLinkage } from "./model-call-attribution.js";
import { createModelCallCaptureBinding } from "./model-call-capture.js";
import { completeModelInvocation } from "./model-complete-invocation.js";
import {
  buildRunEvaluationMessages,
  createRunEvaluationGovernanceBinding,
  DEFAULT_EVALUATION_RUBRIC,
  normalizeRubric,
  parseRunEvaluationResponse,
  type ParsedEvaluation,
  type RunEvaluationGovernanceEvidence,
  type RunEvaluationJudgment,
} from "./evaluation-protocol.js";
import { createId, nowIso } from "./ids.js";
import {
  createModelContextEnvelopeReceipt,
  MODEL_CONTEXT_ENVELOPE_EVENT,
} from "./model-context-envelope.js";
import type { ModelRegistry } from "./models.js";
import { compareRuns } from "./run-replay.js";
import type { RunEvaluationStorePort } from "./store-port.js";
import { createUsageAccounting } from "./token-accounting.js";

export {
  buildRunEvaluationMessages,
  createRunEvaluationGovernanceBinding,
  DEFAULT_EVALUATION_RUBRIC,
  normalizeRubric,
  parseRunEvaluationResponse,
  type RunEvaluationGovernanceEvidence,
  type RunEvaluationJudgment,
} from "./evaluation-protocol.js";

export class RunEvaluationService {
  constructor(
    private readonly store: RunEvaluationStorePort,
    private readonly models: ModelRegistry,
  ) {}

  async evaluate(
    threadId: string,
    request: CreateRunEvaluationRequest,
  ): Promise<RunEvaluationRecord> {
    const thread = this.store.getThread(threadId);
    const agent = this.store.getAgent(thread.agentId);
    const comparison = await compareRuns(
      this.store,
      threadId,
      request.leftRunId,
      request.rightRunId,
    );
    const rubric = normalizeRubric(request.rubric ?? DEFAULT_EVALUATION_RUBRIC);
    const evaluatorModel = request.model ?? agent.model;
    this.resolveEvaluatorModel(evaluatorModel);
    const comparisonGovernance = createRunEvaluationGovernanceBinding(
      comparison.contextCoverageDelta,
      comparison.traceSummaryBoundaryDelta,
    );
    const leased = await this.store.createLeasedRun({
      threadId,
      agentId: agent.id,
      model: evaluatorModel,
    }, { ownerId: `evaluation:${process.pid}:${createId("worker")}`, ttlMs: 60_000 });
    const evaluationRun = leased.run, controller = new AbortController();
    const heartbeat = setInterval(() => {
      void this.store.renewRunLease(evaluationRun.id, leased.token, 60_000)
        .catch((error: unknown) => controller.abort(error));
    }, 20_000);
    heartbeat.unref();
    let observedUsage: Usage | undefined;
    try {
      this.models.bindRunAccounting(evaluationRun.id, leased.token);
      const result = await this.judgeSnapshots(
        comparison.left,
        comparison.right,
        rubric,
        evaluatorModel,
        { ...comparison, comparisonGovernance },
        { run: evaluationRun, signal: controller.signal },
      );
      controller.signal.throwIfAborted();
      observedUsage = result.usage;
      const record: RunEvaluationRecord = {
        id: createId("evaluation"),
        threadId,
        leftRunId: comparison.left.run.id,
        rightRunId: comparison.right.run.id,
        leftSnapshotSha256: comparison.left.eventStreamSha256,
        rightSnapshotSha256: comparison.right.eventStreamSha256,
        rubric,
        scores: result.scores,
        verdict: result.verdict,
        reason: result.reason,
        evidence: result.evidence,
        evaluatorModel,
        comparisonGovernance,
        createdAt: nowIso(),
      };
      const saved = await this.store.saveRunEvaluation(record);
      await this.store.appendEvent({
        threadId,
        runId: evaluationRun.id,
        type: "evaluation.completed",
        category: "evaluation",
        visibility: "user",
        payload: {
          evaluationId: saved.id,
          leftRunId: saved.leftRunId,
          rightRunId: saved.rightRunId,
          verdict: saved.verdict,
          reason: saved.reason,
          evidence: saved.evidence,
          rubric: saved.rubric.name,
          leftSnapshotSha256: saved.leftSnapshotSha256,
          rightSnapshotSha256: saved.rightSnapshotSha256,
          comparisonGovernanceSha256: comparisonGovernance.contentSha256,
          contextCoverageStatus: comparisonGovernance.contextCoverageStatus,
          contextCoverageDiagnosticsSha256:
            comparisonGovernance.contextCoverageDiagnosticsSha256,
          ...(comparisonGovernance.traceSummaryBoundaryStatus &&
          comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256
            ? {
                traceSummaryBoundaryStatus:
                  comparisonGovernance.traceSummaryBoundaryStatus,
                traceSummaryBoundaryDiagnosticsSha256:
                  comparisonGovernance.traceSummaryBoundaryDiagnosticsSha256,
              }
            : {}),
        },
      });
      await this.store.finishRun(evaluationRun.id, "completed", {
        leaseToken: leased.token,
        ...(this.models.accountingRepository ? { terminalEvent: { payload: { status: "completed", purpose: "evaluation_judgment" } } } : {}),
        ...(observedUsage ? { usage: observedUsage } : {}),
      });
      return saved;
    } catch (error) {
      await this.store.finishRun(evaluationRun.id, "failed", {
        leaseToken: leased.token,
        ...(this.models.accountingRepository ? { terminalEvent: { payload: { status: "failed", purpose: "evaluation_judgment" } } } : {}),
        error: safeErrorMessage(error),
        ...(observedUsage ? { usage: observedUsage } : {}),
      });
      throw error;
    } finally {
      clearInterval(heartbeat);
      this.models.releaseRunAccounting(evaluationRun.id);
    }
  }

  async judgeSnapshots(
    left: RunReplaySnapshot,
    right: RunReplaySnapshot,
    rubric: EvaluationRubricSnapshot,
    evaluatorModel: ModelRef,
    governanceEvidence?: RunEvaluationGovernanceEvidence,
    trace?: RunEvaluationTraceOptions,
  ): Promise<RunEvaluationJudgment> {
    const model = this.resolveEvaluatorModel(evaluatorModel);
    if (!model) {
      return {
        verdict: "inconclusive",
        reason:
          "The deterministic demo model cannot independently compare run quality.",
        evidence: "",
        scores: [],
      };
    }
    return this.evaluateWithModel(
      model,
      left,
      right,
      rubric,
      governanceEvidence,
      trace,
      evaluatorModel,
    );
  }

  private resolveEvaluatorModel(
    evaluatorModel: ModelRef,
  ): Model<Api> | undefined {
    if (evaluatorModel.provider === "napier" && evaluatorModel.id === "demo") {
      return undefined;
    }
    const model = this.models.resolve(evaluatorModel);
    if (!model) {
      throw new Error(
        `Evaluator model not found: ${evaluatorModel.provider}/${evaluatorModel.id}`,
      );
    }
    return model;
  }

  private async evaluateWithModel(
    model: Model<Api>,
    left: RunReplaySnapshot,
    right: RunReplaySnapshot,
    rubric: EvaluationRubricSnapshot,
    governanceEvidence?: RunEvaluationGovernanceEvidence,
    trace?: RunEvaluationTraceOptions,
    evaluatorModel?: ModelRef,
  ): Promise<ParsedEvaluation> {
    const prompt = buildRunEvaluationMessages(
      left,
      right,
      rubric,
      governanceEvidence,
    );
    const messages = [
      {
        role: "user" as const,
        content: prompt.user,
        timestamp: Date.now(),
      },
    ];
    const requestContext = {
      systemPrompt: prompt.system,
      messages,
      tools: [],
    };
    const envelope = createModelContextEnvelopeReceipt({
        turnIndex: trace?.turnIndex ?? 0,
        systemPrompt: requestContext.systemPrompt,
        messages: requestContext.messages,
        tools: requestContext.tools,
      });
    if (trace) {
      await this.store.appendEvent({
        threadId: trace.run.threadId,
        runId: trace.run.id,
        type: MODEL_CONTEXT_ENVELOPE_EVENT,
        category: "model",
        visibility: "debug",
        payload: structuredClone(envelope) as unknown as JsonObject,
      });
    }
    const accounting = trace ? this.models.accountingForRun(trace.run.id) : this.models.accountingForOperation("evaluation_judgment");
    const options = { maxTokens: 1_500, temperature: 0, ...(trace?.signal ? { signal: trace.signal } : {}) };
    let attribution: ModelCallAttributionV1 | undefined;
    let response: AssistantMessage;
    try {
      response = await completeModelInvocation({ models: this.models.models, model, context: requestContext,
        options, phase: "evaluation_judgment", ...(accounting ? { accounting } : {}),
        capture: createModelCallCaptureBinding({ model, context: requestContext, options, envelope }),
        onAttribution: (value) => { attribution = value; } });
    } catch (error) {
      const usage = zeroUsage();
      if (trace && envelope && evaluatorModel) {
        await this.recordEvaluationModelResponse(trace.run, evaluatorModel, {
          envelope,
          error: safeErrorMessage(error),
          usage,
          ...(attribution ? { attribution } : {}),
          omitUsage: Boolean(accounting && !attribution),
        });
      }
      // Native dispatch and receipt failures remain failures of this operation.
      // An accounting retry may later debit usage, but cannot publish a judgment.
      if (accounting) throw error;
      return {
        verdict: "inconclusive",
        reason: `Evaluator failed closed: ${safeErrorMessage(error)}`,
        evidence: "",
        scores: [],
        usage,
      };
    }
    const text = contentText(response.content);
    const usage = mapEvaluationUsage(response.usage);
    if (trace && envelope && evaluatorModel) {
      await this.recordEvaluationModelResponse(trace.run, evaluatorModel, {
        envelope,
        text,
        usage,
        ...(attribution ? { attribution } : {}),
        ...(response.stopReason ? { stopReason: response.stopReason } : {}),
      });
    }
    try {
      return {
        ...parseRunEvaluationResponse(text, rubric),
        usage,
      };
    } catch (error) {
      return {
        verdict: "inconclusive",
        reason: `Evaluator failed closed: ${safeErrorMessage(error)}`,
        evidence: "",
        scores: [],
        usage,
      };
    }
  }

  private async recordEvaluationModelResponse(
    run: RunRecord,
    evaluatorModel: ModelRef,
    input: EvaluationModelResponseInput,
  ): Promise<void> {
    const usageAccounting = createUsageAccounting(evaluatorModel, input.usage);
    const text = input.text ?? "";
    const error = input.error ?? "";
    await this.store.appendEvent({
      threadId: run.threadId,
      runId: run.id,
      type: "model.response",
      category: "model",
      visibility: "debug",
      payload: {
        ...(input.text !== undefined
          ? {
              textSha256: sha256(text),
              textBytes: Buffer.byteLength(text, "utf8"),
            }
          : {
              errorSha256: sha256(error),
              errorBytes: Buffer.byteLength(error, "utf8"),
            }),
        contentRedacted: true,
        model: `${evaluatorModel.provider}/${evaluatorModel.id}`,
        ...(input.stopReason ? { stopReason: input.stopReason } : {}),
        modelContextEnvelopeSha256: input.envelope.contentSha256,
        modelContextEnvelopeTurnIndex: input.envelope.turnIndex,
        modelContextMessageSetSha256: input.envelope.messageSetSha256,
        modelContextToolDefinitionSetSha256:
          input.envelope.toolDefinitionSetSha256,
        ...(input.attribution ? modelAccountingLinkage(input.attribution) : {}),
        ...(!input.omitUsage ? { usage: input.usage, usageAccounting } : {}),
      },
    });
  }
}

export interface RunEvaluationTraceOptions {
  run: RunRecord;
  turnIndex?: number;
  signal?: AbortSignal;
}

interface EvaluationModelResponseInput {
  envelope: ModelContextEnvelopeReceipt;
  text?: string;
  error?: string;
  stopReason?: string;
  usage: Usage;
  attribution?: ModelCallAttributionV1;
  omitUsage?: boolean;
}

function mapEvaluationUsage(usage: PiUsage): Usage {
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    cacheReadTokens: usage.cacheRead,
    cacheWriteTokens: usage.cacheWrite,
    costUsd: usage.cost.total,
  };
}

function zeroUsage(): Usage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.slice(0, 700)
    : String(error).slice(0, 700);
}
