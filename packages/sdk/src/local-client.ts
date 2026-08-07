import type {
  AgentMessageExperimentPreview,
  AgentMessageExperimentResult,
  ExecutionPlanWorkflowExperimentPreview,
  ExecutionPlanWorkflowExperimentResult,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  JsonValue,
  ModelInvocationExperimentPreview,
  ModelInvocationExperimentResult,
  OperatorDecision,
  RunRecord,
  ToolInvocationExperimentPreview,
  ToolInvocationExperimentResult,
} from "@napier/contracts";
import type { LocalAgentRuntimeServices } from "@napier/runtime";

import {
  previewNapierAgentMessageExperiment,
  runNapierAgentMessageExperiment,
  type PreviewNapierAgentMessageExperimentOptions,
  type RunNapierAgentMessageExperimentOptions,
} from "./agent-message-experiments.js";
import type {
  AnswerNapierWorkflowApprovalOptions,
  NapierAgentExecution,
  NapierClient,
  NapierWorkflowApprovalExecution,
  NapierWorkflowExecution,
  ResumeNapierAgentOptions,
  ResumeNapierWorkflowOptions,
  RunNapierAgentOptions,
  RunNapierWorkflowOptions,
} from "./client-types.js";
import {
  previewNapierModelInvocationExperiment,
  runNapierModelInvocationExperiment,
  type PreviewNapierModelInvocationExperimentOptions,
  type RunNapierModelInvocationExperimentOptions,
} from "./model-invocation-experiments.js";
import {
  previewNapierToolInvocationExperiment,
  runNapierToolInvocationExperiment,
  type PreviewNapierToolInvocationExperimentOptions,
  type RunNapierToolInvocationExperimentOptions,
} from "./tool-invocation-experiments.js";
import {
  previewNapierWorkflowExperiment,
  runNapierWorkflowExperiment,
  type PreviewNapierWorkflowExperimentOptions,
  type RunNapierWorkflowExperimentOptions,
} from "./workflow-experiments.js";
import type { DefineNapierWorkflowInput, NapierWorkflow } from "./workflow.js";

export class LocalNapierClient implements NapierClient {
  private readonly closeController = new AbortController();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(private readonly services: LocalAgentRuntimeServices) {}

  async runAgent(
    options: RunNapierAgentOptions,
  ): Promise<NapierAgentExecution> {
    const execution = await this.track(() =>
      this.services.embeddedAgents.run({
        prompt: options.prompt,
        ...(options.threadId !== undefined
          ? { threadId: options.threadId }
          : {}),
        ...(options.agentId !== undefined ? { agentId: options.agentId } : {}),
        ...(options.title !== undefined ? { title: options.title } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return agentExecution(
      execution.threadId,
      execution.run,
      execution.assistantText,
    );
  }

  async resumeAgent(
    options: ResumeNapierAgentOptions,
  ): Promise<NapierAgentExecution> {
    const execution = await this.track(() =>
      this.services.embeddedAgents.resume({
        threadId: options.threadId,
        ...(options.runId !== undefined ? { runId: options.runId } : {}),
        ...(options.model !== undefined ? { model: options.model } : {}),
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return agentExecution(
      execution.threadId,
      execution.run,
      execution.assistantText,
    );
  }

  async previewAgentMessageExperiment(
    options: PreviewNapierAgentMessageExperimentOptions,
  ): Promise<AgentMessageExperimentPreview> {
    return this.track(() =>
      previewNapierAgentMessageExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async runAgentMessageExperiment(
    options: RunNapierAgentMessageExperimentOptions,
  ): Promise<AgentMessageExperimentResult> {
    return this.track(() =>
      runNapierAgentMessageExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async previewModelInvocationExperiment(
    options: PreviewNapierModelInvocationExperimentOptions,
  ): Promise<ModelInvocationExperimentPreview> {
    return this.track(() =>
      previewNapierModelInvocationExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async runModelInvocationExperiment(
    options: RunNapierModelInvocationExperimentOptions,
  ): Promise<ModelInvocationExperimentResult> {
    return this.track(() =>
      runNapierModelInvocationExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async previewToolInvocationExperiment(
    options: PreviewNapierToolInvocationExperimentOptions,
  ): Promise<ToolInvocationExperimentPreview> {
    return this.track(() =>
      previewNapierToolInvocationExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async runToolInvocationExperiment(
    options: RunNapierToolInvocationExperimentOptions,
  ): Promise<ToolInvocationExperimentResult> {
    return this.track(() =>
      runNapierToolInvocationExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async defineWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    definition: DefineNapierWorkflowInput<TInput, TOutput>,
  ): Promise<NapierWorkflow<TInput, TOutput>> {
    const defined = await this.track(() =>
      this.services.embeddedWorkflows.define(definition),
    );
    return workflowHandle<TInput, TOutput>(defined.manifest);
  }

  async runWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    options: RunNapierWorkflowOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowExecution<TOutput>> {
    const execution = await this.track(() =>
      this.services.embeddedWorkflows.run({
        manifest: options.workflow.manifest,
        input: options.input,
        ...(options.breakBeforeNodeIds
          ? { breakBeforeNodeIds: options.breakBeforeNodeIds }
          : {}),
        ...(options.threadId ? { threadId: options.threadId } : {}),
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.title ? { title: options.title } : {}),
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return workflowExecution<TOutput>(
      execution.threadId,
      execution.result,
      execution.pendingDecision,
    );
  }

  async resumeWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    options: ResumeNapierWorkflowOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowExecution<TOutput>> {
    const execution = await this.track(() =>
      this.services.embeddedWorkflows.resume({
        manifest: options.workflow.manifest,
        threadId: options.threadId,
        planId: options.planId,
        ...(options.retryBlocked ? { retryBlocked: true } : {}),
        ...(options.continueBreakpoint ? { continueBreakpoint: true } : {}),
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return workflowExecution<TOutput>(
      execution.threadId,
      execution.result,
      execution.pendingDecision,
    );
  }

  async answerWorkflowApproval<
    TInput extends JsonValue,
    TOutput extends JsonValue,
  >(
    options: AnswerNapierWorkflowApprovalOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowApprovalExecution<TOutput>> {
    const execution = await this.track(() =>
      this.services.embeddedWorkflows.answerAndResume({
        manifest: options.workflow.manifest,
        threadId: options.threadId,
        planId: options.planId,
        decisionId: options.decisionId,
        expectedDecisionSha256: options.expectedDecisionSha256,
        answer: {
          selectedOptionIds: options.selectedOptionIds,
          ...(options.customText !== undefined
            ? { customText: options.customText }
            : {}),
        },
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return {
      ...workflowExecution<TOutput>(
        execution.threadId,
        execution.result,
        execution.pendingDecision,
      ),
      decision: structuredClone(execution.decision),
    };
  }

  async previewWorkflowExperiment<
    TInput extends JsonValue,
    TOutput extends JsonValue,
  >(
    options: PreviewNapierWorkflowExperimentOptions<TInput, TOutput>,
  ): Promise<ExecutionPlanWorkflowExperimentPreview> {
    return this.track(() =>
      previewNapierWorkflowExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  async runWorkflowExperiment<
    TInput extends JsonValue,
    TOutput extends JsonValue,
  >(
    options: RunNapierWorkflowExperimentOptions<TInput, TOutput>,
  ): Promise<ExecutionPlanWorkflowExperimentResult> {
    return this.track(() =>
      runNapierWorkflowExperiment(
        this.services,
        options,
        combinedSignal(options.signal, this.closeController.signal),
      ),
    );
  }

  close(): Promise<void> {
    if (!this.closing) this.closing = this.closeClient();
    return this.closing;
  }

  private assertOpen(): void {
    if (this.closing) throw new Error("Napier client is closed");
  }

  private async closeClient(): Promise<void> {
    this.closeController.abort();
    await Promise.allSettled([...this.activeOperations]);
    await this.services.shutdown();
  }

  private track<T>(operation: () => Promise<T>): Promise<T> {
    this.assertOpen();
    const pending = operation();
    this.activeOperations.add(pending);
    void pending.then(
      () => this.activeOperations.delete(pending),
      () => this.activeOperations.delete(pending),
    );
    return pending;
  }
}

export function workflowHandle<
  TInput extends JsonValue,
  TOutput extends JsonValue,
>(manifest: ExecutionPlanWorkflowManifest): NapierWorkflow<TInput, TOutput> {
  return {
    manifest: structuredClone(manifest),
    sourceThreadId: manifest.blueprint.source.threadId,
    sourcePlanId: manifest.blueprint.source.planId,
  };
}

function agentExecution(
  threadId: string,
  run: RunRecord,
  assistantText: string | undefined,
): NapierAgentExecution {
  return {
    threadId,
    runId: run.id,
    status: run.status,
    ...(assistantText !== undefined ? { assistantText } : {}),
    run: structuredClone(run),
  };
}

function workflowExecution<TOutput extends JsonValue>(
  threadId: string,
  result: ExecutionPlanWorkflowResult,
  pendingDecision?: OperatorDecision,
): NapierWorkflowExecution<TOutput> {
  return {
    threadId,
    planId: result.planId,
    status: result.status,
    ...(result.output !== undefined
      ? { output: structuredClone(result.output) as TOutput }
      : {}),
    ...(result.breakpoint
      ? { breakpoint: structuredClone(result.breakpoint) }
      : {}),
    result: structuredClone(result),
    ...(pendingDecision
      ? { pendingDecision: structuredClone(pendingDecision) }
      : {}),
  };
}

function combinedSignal(
  caller: AbortSignal | undefined,
  closing: AbortSignal,
): AbortSignal {
  return caller ? AbortSignal.any([caller, closing]) : closing;
}
