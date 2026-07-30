import type {
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  JsonValue,
  RunEvent,
  WorkflowValueSchema,
} from "@napier/contracts";
import {
  createLocalAgentRuntime,
  validateExecutionPlanWorkflowManifest,
  type DefineEmbeddedWorkflowInput,
  type LocalAgentRuntimeOptions,
  type LocalAgentRuntimeServices,
} from "@napier/runtime";

declare const workflowInputType: unique symbol;
declare const workflowOutputType: unique symbol;

export interface NapierWorkflow<
  TInput extends JsonValue = JsonValue,
  TOutput extends JsonValue = JsonValue,
> {
  readonly manifest: ExecutionPlanWorkflowManifest;
  readonly sourceThreadId: string;
  readonly sourcePlanId: string;
  readonly [workflowInputType]?: TInput;
  readonly [workflowOutputType]?: TOutput;
}

export type DefineNapierWorkflowInput<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> = Omit<DefineEmbeddedWorkflowInput, "inputSchema" | "outputSchema"> & {
  inputSchema: WorkflowValueSchema;
  outputSchema: WorkflowValueSchema;
  readonly [workflowInputType]?: TInput;
  readonly [workflowOutputType]?: TOutput;
};

export interface RunNapierWorkflowOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  workflow: NapierWorkflow<TInput, TOutput>;
  input: TInput;
  threadId?: string;
  agentId?: string;
  title?: string;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface ResumeNapierWorkflowOptions<
  TInput extends JsonValue,
  TOutput extends JsonValue,
> {
  workflow: NapierWorkflow<TInput, TOutput>;
  threadId: string;
  planId: string;
  retryBlocked?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: RunEvent) => Promise<void> | void;
}

export interface NapierWorkflowExecution<TOutput extends JsonValue> {
  threadId: string;
  planId: string;
  status: ExecutionPlanWorkflowResult["status"];
  output?: TOutput;
  result: ExecutionPlanWorkflowResult;
}

export type NapierClientOptions = LocalAgentRuntimeOptions;

export interface NapierClient {
  defineWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    definition: DefineNapierWorkflowInput<TInput, TOutput>,
  ): Promise<NapierWorkflow<TInput, TOutput>>;

  runWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    options: RunNapierWorkflowOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowExecution<TOutput>>;

  resumeWorkflow<TInput extends JsonValue, TOutput extends JsonValue>(
    options: ResumeNapierWorkflowOptions<TInput, TOutput>,
  ): Promise<NapierWorkflowExecution<TOutput>>;

  close(): Promise<void>;
}

export async function createNapierClient(
  options: NapierClientOptions = {},
): Promise<NapierClient> {
  return new LocalNapierClient(await createLocalAgentRuntime(options));
}

export function loadNapierWorkflow<
  TInput extends JsonValue,
  TOutput extends JsonValue,
>(input: unknown): NapierWorkflow<TInput, TOutput> {
  return workflowHandle<TInput, TOutput>(
    validateExecutionPlanWorkflowManifest(input),
  );
}

class LocalNapierClient implements NapierClient {
  private readonly closeController = new AbortController();
  private readonly activeOperations = new Set<Promise<unknown>>();
  private closing: Promise<void> | undefined;

  constructor(private readonly services: LocalAgentRuntimeServices) {}

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
        ...(options.threadId ? { threadId: options.threadId } : {}),
        ...(options.agentId ? { agentId: options.agentId } : {}),
        ...(options.title ? { title: options.title } : {}),
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return workflowExecution<TOutput>(execution.threadId, execution.result);
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
        signal: combinedSignal(options.signal, this.closeController.signal),
        ...(options.onEvent ? { onEvent: options.onEvent } : {}),
      }),
    );
    return workflowExecution<TOutput>(execution.threadId, execution.result);
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

function workflowHandle<TInput extends JsonValue, TOutput extends JsonValue>(
  manifest: ExecutionPlanWorkflowManifest,
): NapierWorkflow<TInput, TOutput> {
  return {
    manifest: structuredClone(manifest),
    sourceThreadId: manifest.blueprint.source.threadId,
    sourcePlanId: manifest.blueprint.source.planId,
  };
}

function workflowExecution<TOutput extends JsonValue>(
  threadId: string,
  result: ExecutionPlanWorkflowResult,
): NapierWorkflowExecution<TOutput> {
  return {
    threadId,
    planId: result.planId,
    status: result.status,
    ...(result.output !== undefined
      ? { output: structuredClone(result.output) as TOutput }
      : {}),
    result: structuredClone(result),
  };
}

function combinedSignal(
  caller: AbortSignal | undefined,
  closing: AbortSignal,
): AbortSignal {
  return caller ? AbortSignal.any([caller, closing]) : closing;
}
