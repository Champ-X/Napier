import type {
  AnswerOperatorDecisionRequest,
  ExecutionPlanWorkflowApprovalNode,
  ExecutionPlanWorkflowManifest,
  ExecutionPlanWorkflowResult,
  JsonValue,
  OperatorDecision,
} from "@napier/contracts";

import type { EventSink } from "./agent-runtime.js";
import type { EmbeddedWorkflowExecution } from "./embedded-workflow-model.js";
import { validateExecutionPlanWorkflowManifest } from "./workflow-manifests.js";
import { createOperatorDecisionAnsweredPayload } from "./operator-decisions.js";
import type { LocalStore } from "./store.js";
import { workflowApprovalDecisionContractMatches } from "./workflow-approval-model.js";
import {
  WORKFLOW_APPROVAL_REQUESTED_EVENT,
  WORKFLOW_STARTED_EVENT,
} from "./workflow-ledger.js";
import { assertWorkflowPlanMatchesManifest } from "./workflow-runtime-model.js";
import type { ExecutionPlanWorkflowRuntime } from "./workflow-runtime.js";

export interface PendingEmbeddedWorkflowApprovalOptions {
  manifest: ExecutionPlanWorkflowManifest;
  threadId: string;
  planId: string;
}

export interface AnswerAndResumeEmbeddedWorkflowOptions extends PendingEmbeddedWorkflowApprovalOptions {
  decisionId: string;
  expectedDecisionSha256: string;
  answer: AnswerOperatorDecisionRequest;
  signal?: AbortSignal;
  onEvent?: EventSink;
}

export interface EmbeddedWorkflowApprovalExecution extends EmbeddedWorkflowExecution {
  decision: OperatorDecision;
}

export type EmbeddedWorkflowApprovalErrorCode =
  | "state_conflict"
  | "stale_decision"
  | "expired_decision"
  | "invalid_answer"
  | "evidence_mismatch";

export class EmbeddedWorkflowApprovalError extends Error {
  constructor(
    readonly code: EmbeddedWorkflowApprovalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EmbeddedWorkflowApprovalError";
  }
}

export class EmbeddedWorkflowApprovalService {
  constructor(
    private readonly store: LocalStore,
    private readonly workflows: ExecutionPlanWorkflowRuntime,
  ) {}

  async execution(
    threadId: string,
    manifest: ExecutionPlanWorkflowManifest,
    result: ExecutionPlanWorkflowResult,
  ): Promise<EmbeddedWorkflowExecution> {
    if (result.status !== "waiting") return { threadId, result };
    return {
      threadId,
      result,
      pendingDecision: await this.pendingApproval({
        manifest,
        threadId,
        planId: result.planId,
      }),
    };
  }

  async pendingApproval(
    options: PendingEmbeddedWorkflowApprovalOptions,
  ): Promise<OperatorDecision> {
    return (
      await this.approvalTarget(
        validateExecutionPlanWorkflowManifest(options.manifest),
        options.threadId,
        options.planId,
      )
    ).decision;
  }

  async answerAndResume(
    options: AnswerAndResumeEmbeddedWorkflowOptions,
  ): Promise<EmbeddedWorkflowApprovalExecution> {
    options.signal?.throwIfAborted();
    const manifest = validateExecutionPlanWorkflowManifest(options.manifest);
    const target = await this.approvalTarget(
      manifest,
      options.threadId,
      options.planId,
      options.decisionId,
    );
    if (target.decision.contentSha256 !== options.expectedDecisionSha256) {
      throw new EmbeddedWorkflowApprovalError(
        "stale_decision",
        "Workflow Approval decision has changed",
      );
    }
    try {
      assertWorkflowApprovalAnswer(options.answer);
      createOperatorDecisionAnsweredPayload({
        decision: target.decision,
        answer: options.answer,
      });
    } catch (error) {
      throw new EmbeddedWorkflowApprovalError(
        "invalid_answer",
        errorMessage(error),
      );
    }
    let mutation;
    try {
      mutation = await this.store.answerOperatorDecision(
        options.threadId,
        options.decisionId,
        options.answer,
      );
    } catch (error) {
      throw new EmbeddedWorkflowApprovalError(
        "state_conflict",
        errorMessage(error),
      );
    }
    for (const event of mutation.events) {
      await options.onEvent?.(event);
    }
    options.signal?.throwIfAborted();
    const result = await this.workflows.run({
      threadId: options.threadId,
      request: {
        manifest,
        planId: options.planId,
      },
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onEvent ? { onEvent: options.onEvent } : {}),
    });
    const execution = await this.execution(options.threadId, manifest, result);
    const decision = (
      await this.store.listOperatorDecisions(options.threadId)
    ).find((candidate) => candidate.id === options.decisionId);
    if (!decision) {
      throw new EmbeddedWorkflowApprovalError(
        "evidence_mismatch",
        "Workflow Approval decision evidence is unavailable",
      );
    }
    return { ...execution, decision };
  }

  private async approvalTarget(
    manifest: ExecutionPlanWorkflowManifest,
    threadId: string,
    planId: string,
    decisionId?: string,
  ): Promise<{
    node: ExecutionPlanWorkflowApprovalNode;
    decision: OperatorDecision;
  }> {
    const plan = this.store.getPlan(planId);
    if (plan.threadId !== threadId) {
      throw new EmbeddedWorkflowApprovalError(
        "evidence_mismatch",
        "Workflow Approval Plan does not belong to the Thread",
      );
    }
    try {
      assertWorkflowPlanMatchesManifest(plan, manifest);
    } catch (error) {
      throw new EmbeddedWorkflowApprovalError(
        "evidence_mismatch",
        errorMessage(error),
      );
    }
    const events = await this.store.listEvents(threadId);
    const started = events.filter(
      (event) =>
        event.type === WORKFLOW_STARTED_EVENT &&
        record(event.payload)?.["planId"] === planId,
    );
    if (
      started.length !== 1 ||
      record(started[0]!.payload)?.["manifestSha256"] !== manifest.contentSha256
    ) {
      throw new EmbeddedWorkflowApprovalError(
        "evidence_mismatch",
        "Workflow Approval start evidence is unavailable",
      );
    }
    const decisions = (await this.store.listOperatorDecisions(threadId)).filter(
      (decision) =>
        decision.status === "pending" &&
        (decisionId === undefined || decision.id === decisionId),
    );
    if (decisions.length !== 1) {
      throw new EmbeddedWorkflowApprovalError(
        "state_conflict",
        "Workflow has no single pending Approval decision",
      );
    }
    const decision = decisions[0]!;
    const targets = plan.steps.flatMap((step) => {
      const node = manifest.nodes.find((candidate) => candidate.id === step.id);
      return node?.type === "approval" &&
        step.status === "running" &&
        step.runId === decision.runId
        ? [node]
        : [];
    });
    const node = targets.length === 1 ? targets[0] : undefined;
    const requested = events.filter(
      (event) =>
        event.runId === decision.runId &&
        event.type === WORKFLOW_APPROVAL_REQUESTED_EVENT &&
        record(event.payload)?.["planId"] === planId &&
        record(event.payload)?.["decisionId"] === decision.id &&
        record(event.payload)?.["manifestSha256"] === manifest.contentSha256,
    );
    if (
      !node ||
      requested.length !== 1 ||
      !workflowApprovalDecisionContractMatches(node, decision)
    ) {
      throw new EmbeddedWorkflowApprovalError(
        "evidence_mismatch",
        "Workflow Approval request evidence is mismatched",
      );
    }
    const expiresAt = Date.parse(decision.requestedAt) + node.timeoutMs;
    if (!Number.isFinite(expiresAt) || Date.now() >= expiresAt) {
      throw new EmbeddedWorkflowApprovalError(
        "expired_decision",
        "Workflow Approval decision has expired",
      );
    }
    return { node, decision };
  }
}

function record(value: JsonValue): Record<string, JsonValue> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function assertWorkflowApprovalAnswer(
  answer: AnswerOperatorDecisionRequest,
): void {
  if (
    !Array.isArray(answer.selectedOptionIds) ||
    answer.selectedOptionIds.length !== 1 ||
    (answer.selectedOptionIds[0] !== "option_1" &&
      answer.selectedOptionIds[0] !== "option_2")
  ) {
    throw new Error(
      "Workflow Approval answer requires exactly one approve or reject selection",
    );
  }
}
