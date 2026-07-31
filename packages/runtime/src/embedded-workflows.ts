import {
  NAPIER_API_VERSION,
  type CreateExecutionPlanRequest,
  type ExecutionPlanArchive,
  type ExecutionPlanWorkflowManifest,
  type ExecutionPlanWorkflowResult,
  type JsonValue,
  type OperatorDecision,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import {
  EmbeddedWorkflowApprovalService,
  type AnswerAndResumeEmbeddedWorkflowOptions,
  type EmbeddedWorkflowApprovalExecution,
  type PendingEmbeddedWorkflowApprovalOptions,
} from "./embedded-workflow-approvals.js";
import { createExecutionPlan } from "./plans.js";
import {
  hashExecutionPlanArchiveContent,
  type ExecutionPlanArchiveContent,
} from "./plan-archives.js";
import { hashEventStream } from "./replay.js";
import type { LocalStore } from "./store.js";
import {
  createExecutionPlanBlueprint,
  createExecutionPlanBlueprintFromArchive,
} from "./workflow-blueprints.js";
import {
  defineExecutionPlanWorkflow,
  type DefineExecutionPlanWorkflowInput,
  validateExecutionPlanWorkflowManifest,
} from "./workflow-manifests.js";
import { assertWorkflowValue } from "./workflow-schemas.js";
import type { ExecutionPlanWorkflowRuntime } from "./workflow-runtime.js";

export {
  EmbeddedWorkflowApprovalError,
  type AnswerAndResumeEmbeddedWorkflowOptions,
  type EmbeddedWorkflowApprovalErrorCode,
  type EmbeddedWorkflowApprovalExecution,
  type PendingEmbeddedWorkflowApprovalOptions,
} from "./embedded-workflow-approvals.js";

const PREFLIGHT_THREAD_ID = "thread_embedded_workflow_preflight";
const PREFLIGHT_GENERATED_AT = "2000-01-01T00:00:00.000Z";

export interface DefineEmbeddedWorkflowInput extends Omit<
  DefineExecutionPlanWorkflowInput,
  "blueprint"
> {
  plan: CreateExecutionPlanRequest;
  agentId?: string;
  definitionTitle?: string;
}

export interface EmbeddedWorkflowDefinition {
  manifest: ExecutionPlanWorkflowManifest;
  sourceThreadId: string;
  sourcePlanId: string;
}

export interface RunEmbeddedWorkflowOptions {
  manifest: ExecutionPlanWorkflowManifest;
  input: JsonValue;
  threadId?: string;
  agentId?: string;
  title?: string;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface ResumeEmbeddedWorkflowOptions {
  manifest: ExecutionPlanWorkflowManifest;
  threadId: string;
  planId: string;
  retryBlocked?: boolean;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface EmbeddedWorkflowExecution {
  threadId: string;
  result: ExecutionPlanWorkflowResult;
  pendingDecision?: OperatorDecision;
}

export function validateRunEmbeddedWorkflowInput(
  manifestInput: ExecutionPlanWorkflowManifest,
  input: JsonValue,
): ExecutionPlanWorkflowManifest {
  const manifest = validateExecutionPlanWorkflowManifest(manifestInput);
  assertWorkflowValue(manifest.inputSchema, input, "Workflow input");
  return manifest;
}

export class EmbeddedWorkflowService {
  private readonly approvals: EmbeddedWorkflowApprovalService;

  constructor(
    private readonly store: LocalStore,
    private readonly workflows: ExecutionPlanWorkflowRuntime,
  ) {
    this.approvals = new EmbeddedWorkflowApprovalService(store, workflows);
  }

  async define(
    input: DefineEmbeddedWorkflowInput,
  ): Promise<EmbeddedWorkflowDefinition> {
    const preflight = defineExecutionPlanWorkflow({
      ...manifestDefinition(input),
      blueprint: preflightBlueprint(input.plan),
    });
    const agent = this.resolveAgent(input.agentId);
    const sourceThread = await this.store.createThread({
      title: normalizeTitle(
        input.definitionTitle,
        `Workflow definition: ${preflight.name}`,
      ),
      agentId: agent.id,
    });
    const sourcePlan = await this.store.createPlan(sourceThread.id, input.plan);
    const blueprint = await createExecutionPlanBlueprint(
      this.store,
      sourceThread.id,
      sourcePlan.id,
    );
    const manifest = defineExecutionPlanWorkflow({
      name: preflight.name,
      version: preflight.version,
      description: preflight.description,
      blueprint,
      inputSchema: preflight.inputSchema,
      outputSchema: preflight.outputSchema,
      outputNodeId: preflight.outputNodeId,
      nodes: preflight.nodes,
      ...(preflight.maxConcurrency !== undefined
        ? { maxConcurrency: preflight.maxConcurrency }
        : {}),
      generatedAt: preflight.generatedAt,
    });
    return {
      manifest,
      sourceThreadId: sourceThread.id,
      sourcePlanId: sourcePlan.id,
    };
  }

  async run(
    options: RunEmbeddedWorkflowOptions,
  ): Promise<EmbeddedWorkflowExecution> {
    options.signal?.throwIfAborted();
    const manifest = validateRunEmbeddedWorkflowInput(
      options.manifest,
      options.input,
    );
    const threadId =
      options.threadId ??
      (
        await this.store.createThread({
          title: normalizeTitle(options.title, `Workflow: ${manifest.name}`),
          agentId: this.resolveAgent(options.agentId).id,
        })
      ).id;
    if (options.threadId && options.agentId) {
      const thread = this.store.getThread(options.threadId);
      if (thread.agentId !== options.agentId) {
        throw new Error("Embedded Workflow Thread Agent does not match");
      }
    }
    const result = await this.workflows.run({
      threadId,
      request: {
        manifest,
        input: options.input,
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    return this.approvals.execution(threadId, manifest, result);
  }

  async resume(
    options: ResumeEmbeddedWorkflowOptions,
  ): Promise<EmbeddedWorkflowExecution> {
    options.signal?.throwIfAborted();
    const manifest = validateExecutionPlanWorkflowManifest(options.manifest);
    const result = await this.workflows.run({
      threadId: options.threadId,
      request: {
        manifest,
        planId: options.planId,
        ...(options.retryBlocked ? { retryBlocked: true } : {}),
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    return this.approvals.execution(options.threadId, manifest, result);
  }

  async pendingApproval(
    options: PendingEmbeddedWorkflowApprovalOptions,
  ): Promise<OperatorDecision> {
    return this.approvals.pendingApproval(options);
  }

  async answerAndResume(
    options: AnswerAndResumeEmbeddedWorkflowOptions,
  ): Promise<EmbeddedWorkflowApprovalExecution> {
    return this.approvals.answerAndResume(options);
  }

  private resolveAgent(agentId: string | undefined) {
    const agent = agentId
      ? this.store.getAgent(agentId)
      : this.store.listAgents()[0];
    if (!agent) throw new Error("No Agent profile is available");
    return agent;
  }
}

function manifestDefinition(
  input: DefineEmbeddedWorkflowInput,
): Omit<DefineExecutionPlanWorkflowInput, "blueprint"> {
  return {
    name: input.name,
    version: input.version,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    outputNodeId: input.outputNodeId,
    nodes: input.nodes,
    ...(input.maxConcurrency !== undefined
      ? { maxConcurrency: input.maxConcurrency }
      : {}),
    ...(input.generatedAt ? { generatedAt: input.generatedAt } : {}),
  };
}

function preflightBlueprint(planRequest: CreateExecutionPlanRequest) {
  const plan = createExecutionPlan(PREFLIGHT_THREAD_ID, planRequest);
  const eventStreamSha256 = hashEventStream([]);
  const content: ExecutionPlanArchiveContent = {
    kind: "napier.execution-plan-archive",
    schemaVersion: 1,
    apiVersion: NAPIER_API_VERSION,
    threadId: PREFLIGHT_THREAD_ID,
    plan,
    events: [],
    eventStreamSha256,
  };
  const archive: ExecutionPlanArchive = {
    ...content,
    generatedAt: PREFLIGHT_GENERATED_AT,
    contentSha256: hashExecutionPlanArchiveContent(content),
  };
  return createExecutionPlanBlueprintFromArchive(archive);
}

function normalizeTitle(input: string | undefined, fallback: string): string {
  const title = (input ?? fallback).replace(/\s+/gu, " ").trim();
  if (
    title.length < 1 ||
    title.length > 120 ||
    /[\u0000-\u001f\u007f<>]/u.test(title)
  ) {
    throw new Error("Embedded Workflow title is invalid");
  }
  return title;
}
