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
  JsonValue,
  ModelContextEnvelopeReceipt,
  ModelRef,
  RunEvaluationRecord,
  RunRecord,
  RunReplaySnapshot,
  Usage,
} from "@napier/contracts";

import { sha256 } from "./ed25519.js";
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
    const evaluationRun = await this.store.createRun({
      threadId,
      agentId: agent.id,
      model: evaluatorModel,
    });
    let observedUsage: Usage | undefined;
    try {
      const result = await this.judgeSnapshots(
        comparison.left,
        comparison.right,
        rubric,
        evaluatorModel,
        { ...comparison, comparisonGovernance },
        { run: evaluationRun },
      );
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
        ...(observedUsage ? { usage: observedUsage } : {}),
      });
      return saved;
    } catch (error) {
      await this.store.finishRun(evaluationRun.id, "failed", {
        error: safeErrorMessage(error),
        ...(observedUsage ? { usage: observedUsage } : {}),
      });
      throw error;
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
    const envelope =
      trace &&
      createModelContextEnvelopeReceipt({
        turnIndex: trace.turnIndex ?? 0,
        systemPrompt: requestContext.systemPrompt,
        messages: requestContext.messages,
        tools: requestContext.tools,
      });
    if (trace && envelope) {
      await this.store.appendEvent({
        threadId: trace.run.threadId,
        runId: trace.run.id,
        type: MODEL_CONTEXT_ENVELOPE_EVENT,
        category: "model",
        visibility: "debug",
        payload: structuredClone(envelope) as unknown as JsonValue,
      });
    }
    let response: AssistantMessage;
    try {
      response = await this.models.models.completeSimple(
        model,
        requestContext,
        { maxTokens: 1_500, temperature: 0 },
      );
    } catch (error) {
      const usage = zeroUsage();
      if (trace && envelope && evaluatorModel) {
        await this.recordEvaluationModelResponse(trace.run, evaluatorModel, {
          envelope,
          error: safeErrorMessage(error),
          usage,
        });
      }
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
        usage: input.usage,
        usageAccounting,
      },
    });
  }
}

export interface RunEvaluationTraceOptions {
  run: RunRecord;
  turnIndex?: number;
}

interface EvaluationModelResponseInput {
  envelope: ModelContextEnvelopeReceipt;
  text?: string;
  error?: string;
  stopReason?: string;
  usage: Usage;
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
